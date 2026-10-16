// E4.T3: חשבונית מרוכזת חודשית — צבירת הזמנות, PDF תקין עם כל ההזמנות והסכום, CSV עם BOM
const { test } = require('node:test');
const assert = require('node:assert');
const { startApp } = require('./helpers');

test('consolidated monthly invoice: PDF + CSV with all orders and total', async (t) => {
  const { base, api } = await startApp(t);
  const owner = await api.login('+972500000003', 'בעל מכבסה לדמו');
  const customer = await api.login('+972500000002', 'לקוח דמו');

  const acc = (await api('/api/t/achuza/business-accounts', { method: 'POST', token: owner, body: {
    name: 'מלון הים', company_id: '514000000', contact_name: 'דנה', contact_phone: '+972501234567', payment_terms: 'net30' } })).json.account;
  await api(`/api/t/achuza/business-accounts/${acc.id}/users`, { method: 'POST', token: owner, body: { phone: '+972500000002' } });
  const item = (await api('/api/laundries/achuza')).json.items[0];

  // שתי הזמנות עסקיות בחודש הנוכחי
  let sum = 0;
  for (let i = 0; i < 2; i++) {
    const o = await api('/api/orders', { method: 'POST', token: customer, body: {
      slug: 'achuza', items: [{ item_id: item.id, qty: i + 1 }], address: 'הרצל 1, תל אביב' } });
    assert.equal(o.status, 201, JSON.stringify(o.json));
    sum += Number(o.json.order.total);
  }

  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }));
  const y = now.getFullYear(), m = now.getMonth() + 1;
  const gen = await api(`/api/t/achuza/business-accounts/${acc.id}/invoices/generate`, { method: 'POST', token: owner, body: { year: y, month: m } });
  assert.equal(gen.status, 200, JSON.stringify(gen.json));
  assert.equal(gen.json.invoice.orders_count, 2);
  assert.ok(Math.abs(Number(gen.json.invoice.total) - sum) < 0.01, `${gen.json.invoice.total} vs ${sum}`);

  // PDF תקין
  const pdfRes = await fetch(`${base}/api/t/achuza/business-accounts/${acc.id}/invoices/${gen.json.invoice.id}/pdf`, { headers: { authorization: 'Bearer ' + owner } });
  assert.equal(pdfRes.status, 200);
  const pdfBuf = Buffer.from(await pdfRes.arrayBuffer());
  assert.ok(pdfBuf.slice(0, 5).toString() === '%PDF-', 'PDF header');
  assert.ok(pdfBuf.length > 1000, 'PDF has content');

  // CSV עם BOM וכל ההזמנות
  const csvRes = await fetch(`${base}/api/t/achuza/business-accounts/${acc.id}/invoices/${gen.json.invoice.id}/csv`, { headers: { authorization: 'Bearer ' + owner } });
  const csvBuf = Buffer.from(await csvRes.arrayBuffer());
  assert.ok(csvBuf[0] === 0xEF && csvBuf[1] === 0xBB && csvBuf[2] === 0xBF, 'BOM for Excel');
  const csv = csvBuf.toString('utf8');
  assert.equal(csv.trim().split('\r\n').length, 3, 'header + 2 orders');
  assert.ok(csv.includes('תאריך') && csv.includes('הזמנה'));

  // חודש בלי הזמנות → 404
  const empty = await api(`/api/t/achuza/business-accounts/${acc.id}/invoices/generate`, { method: 'POST', token: owner, body: { year: 2020, month: 1 } });
  assert.equal(empty.status, 404);

  // רשימת חשבוניות
  const list = await api(`/api/t/achuza/business-accounts/${acc.id}/invoices`, { token: owner });
  assert.equal(list.json.invoices.length, 1);

  // מצטבר חודשי (E4.T4)
  const summary = await api(`/api/t/achuza/business-accounts/${acc.id}/summary`, { token: owner });
  assert.equal(summary.json.summary.orders_count, 2);
  assert.ok(Math.abs(Number(summary.json.summary.month_total) - sum) < 0.01);
});

test('consolidated_billing toggle: default on, generate blocked when disabled', async (t) => {
  const { api } = await startApp(t);
  const owner = await api.login('+972500000003');
  const customer = await api.login('+972500000002');
  const acc = (await api('/api/t/achuza/business-accounts', { method: 'POST', token: owner, body: {
    name: 'קליניקת הדר', company_id: '514000001', payment_terms: 'net30' } })).json.account;
  assert.equal(acc.consolidated_billing, true, 'ברירת מחדל: מופעל לחשבון עסקי');
  await api(`/api/t/achuza/business-accounts/${acc.id}/users`, { method: 'POST', token: owner, body: { phone: '+972500000002' } });
  const item = (await api('/api/laundries/achuza')).json.items[0];
  await api('/api/orders', { method: 'POST', token: customer, body: { slug: 'achuza', items: [{ item_id: item.id, qty: 1 }], address: 'בדיקה 1' } });

  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }));
  const y = now.getFullYear(), m = now.getMonth() + 1;
  const off = await api(`/api/t/achuza/business-accounts/${acc.id}`, { method: 'PATCH', token: owner, body: { consolidated_billing: false } });
  assert.equal(off.status, 200);
  assert.equal(off.json.account.consolidated_billing, false);
  const blocked = await api(`/api/t/achuza/business-accounts/${acc.id}/invoices/generate`, { method: 'POST', token: owner, body: { year: y, month: m } });
  assert.equal(blocked.status, 409, JSON.stringify(blocked.json));
  const on = await api(`/api/t/achuza/business-accounts/${acc.id}`, { method: 'PATCH', token: owner, body: { consolidated_billing: true } });
  assert.equal(on.json.account.consolidated_billing, true);
  const ok = await api(`/api/t/achuza/business-accounts/${acc.id}/invoices/generate`, { method: 'POST', token: owner, body: { year: y, month: m } });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
});

test('QA: הפקה חוזרת של חשבונית מרכזת — סימון "הופק מחדש" + היסטוריה נשמרת', async (t) => {
  const { api, schema } = await startApp(t);
  const owner = await api.login('+972500000003');
  const customer = await api.login('+972500000002');
  const acc = (await api('/api/t/achuza/business-accounts', { method: 'POST', token: owner, body: {
    name: 'בית ספר הגליל', company_id: '514000002', payment_terms: 'net30' } })).json.account;
  await api(`/api/t/achuza/business-accounts/${acc.id}/users`, { method: 'POST', token: owner, body: { phone: '+972500000002' } });
  const item = (await api('/api/laundries/achuza')).json.items[0];
  await api('/api/orders', { method: 'POST', token: customer, body: { slug: 'achuza', items: [{ item_id: item.id, qty: 1 }], address: 'בדיקה 2' } });
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }));
  const y = now.getFullYear(), m = now.getMonth() + 1;
  const g1 = await api(`/api/t/achuza/business-accounts/${acc.id}/invoices/generate`, { method: 'POST', token: owner, body: { year: y, month: m } });
  assert.equal(g1.status, 200, JSON.stringify(g1.json));
  assert.equal(g1.json.invoice.regenerated_count || 0, 0);
  const g2 = await api(`/api/t/achuza/business-accounts/${acc.id}/invoices/generate`, { method: 'POST', token: owner, body: { year: y, month: m } });
  assert.equal(g2.status, 200);
  assert.equal(g2.json.invoice.regenerated_count, 1, 'סומן שהופק מחדש');
  // היסטוריה: הגרסה הקודמת נשמרה
  const { Pool } = require('pg');
  const { TEST_DB } = require('./helpers');
  const pool = new Pool({ connectionString: TEST_DB, max: 1, options: `-c search_path=${schema},public` });
  const { rows: hist } = await pool.query('SELECT * FROM business_invoice_history WHERE invoice_id=$1', [g2.json.invoice.id]);
  await pool.end();
  assert.equal(hist.length, 1, 'גרסה קודמת בהיסטוריה');
  assert.equal(Number(hist[0].total), Number(g1.json.invoice.total));
});

test('QA: לקוח משויך לחשבון עסקי רואה מחיר הסכם בקטלוג', async (t) => {
  const { api } = await startApp(t);
  const owner = await api.login('+972500000003');
  const customer = await api.login('+972500000002');
  const acc = (await api('/api/t/achuza/business-accounts', { method: 'POST', token: owner, body: {
    name: 'מסעדת הכרמל', company_id: '514000003', payment_terms: 'net30' } })).json.account;
  await api(`/api/t/achuza/business-accounts/${acc.id}/users`, { method: 'POST', token: owner, body: { phone: '+972500000002' } });
  const item = (await api('/api/laundries/achuza')).json.items[0];
  await api(`/api/t/achuza/business-accounts/${acc.id}/prices`, { method: 'PUT', token: owner, body: { prices: [{ item_id: item.id, price: 1.5 }] } });
  const linked = await api('/api/laundries/achuza', { token: customer });
  const li = linked.json.items.find(i => i.id === item.id);
  assert.equal(Number(li.price), 1.5, 'מחיר הסכם בקטלוג');
  assert.equal(li.agreement_price, true);
  // אורח רואה את המחיר הרגיל
  const guest = await api('/api/laundries/achuza');
  assert.notEqual(Number(guest.json.items.find(i => i.id === item.id).price), 1.5);
});
