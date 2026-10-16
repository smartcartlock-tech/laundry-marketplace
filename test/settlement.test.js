// התחשבנות (דמו): דוח תשלומים, עמלה ציפייה-מול-בפועל + הפרש, ייצוא רו"ח, בדיקת רצף מספור.
const { test } = require('node:test');
const assert = require('node:assert');
const { startApp, TEST_DB } = require('./helpers');
const { Pool } = require('pg');

async function deliverOrder(api, { owner, customer, courierUser, slug, items, address, payMethod }) {
  const created = await api('/api/orders', { method: 'POST', token: customer, body: { slug, items, address, payment_method: payMethod || 'cash' } });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const order = created.json.order;
  await api(`/api/t/${slug}/orders/${order.id}/status`, { method: 'POST', token: owner, body: { status: 'confirmed' } });
  const couriers = await api(`/api/t/${slug}/couriers`, { token: owner });
  const priv = couriers.json.couriers.find(c => c.model === 'private');
  await api(`/api/t/${slug}/orders/${order.id}/assign`, { method: 'POST', token: owner, body: { courier_id: priv.id } });
  await api(`/api/courier/orders/${order.id}/mark`, { method: 'POST', token: courierUser, body: { action: 'picked_up' } });
  for (const st of ['in_work', 'ready']) await api(`/api/t/${slug}/orders/${order.id}/status`, { method: 'POST', token: owner, body: { status: st } });
  for (const act of ['out_for_delivery', 'delivered']) await api(`/api/courier/orders/${order.id}/mark`, { method: 'POST', token: courierUser, body: { action: act } });
  return order;
}

test('settlement: דוח תשלומים, עמלה + הפרש, ייצוא רו"ח, רצף מספור, הרשאות', async (t) => {
  const { api, base, schema } = await startApp(t);
  const owner = await api.login('+972500000003');
  const customer = await api.login('+972500000002');
  const courierUser = await api.login('+972500000004');
  const outsider = await api.login('+972500000099');
  await api('/api/t/achuza/settings', { method: 'PATCH', token: owner, body: { dealer_type: 'morasha', dealer_id: '512345678' } });
  const page = await api('/api/laundries/achuza');
  const bag = page.json.items.find(i => i.name.includes('שק'));
  const raw = async (p, token) => {
    const r = await fetch(base + p, { headers: token ? { authorization: 'Bearer ' + token } : {} });
    const buf = Buffer.from(await r.arrayBuffer());
    return { status: r.status, buf, text: buf.toString('utf8'), ct: r.headers.get('content-type') || '' };
  };

  // קו בסיס: סיד הדמו כבר מכיל הזמנות ומסמכים — כל הבדיקות בדלתא מול המצב ההתחלתי
  const pay0 = await api('/api/t/achuza/settlement/payments', { token: owner });
  assert.equal(pay0.status, 200, JSON.stringify(pay0.json));
  const docs0 = await api('/api/t/achuza/documents', { token: owner });
  const seqBase = await api('/api/t/achuza/settlement/sequence-check', { token: owner });
  assert.equal(seqBase.status, 200);
  const invBase = seqBase.json.kinds.find(k => k.kind === 'invoice');
  const recBase = seqBase.json.kinds.find(k => k.kind === 'receipt');

  // שתי הזמנות: מזומן (ממתין לגבייה) + אונליין דמו (שולם)
  const o1 = await deliverOrder(api, { owner, customer, courierUser, slug: 'achuza', items: [{ item_id: bag.id, qty: 2 }], address: 'התחשבנות 1', payMethod: 'cash' });
  const o2 = await deliverOrder(api, { owner, customer, courierUser, slug: 'achuza', items: [{ item_id: bag.id, qty: 1 }], address: 'התחשבנות 2', payMethod: 'demo_online' });
  // הזמנה שלישית שנשארת פתוחה — מזומן בממתין לגבייה
  const o3 = await api('/api/orders', { method: 'POST', token: customer, body: { slug: 'achuza', items: [{ item_id: bag.id, qty: 1 }], address: 'התחשבנות 3', payment_method: 'cash' } });
  assert.equal(o3.status, 201, JSON.stringify(o3.json));
  const cashTotal = Number(o1.total), onlineTotal = Number(o2.total), openTotal = Number(o3.json.order.total);

  // --- הרשאות ---
  assert.equal((await api('/api/t/achuza/settlement/payments')).status, 401);
  assert.equal((await api('/api/t/achuza/settlement/payments', { token: outsider })).status, 403);

  // --- דוח תשלומים (ברירת מחדל: החודש הנוכחי) ---
  const pay = await api('/api/t/achuza/settlement/payments', { token: owner });
  assert.equal(pay.status, 200, JSON.stringify(pay.json));
  assert.equal(pay.json.demo, true);
  // מזומן שסומן delivered נגבה כ-paid_cash; ההזמנה הפתוחה נשארת pending
  assert.equal(pay.json.kpis.orders, pay0.json.kpis.orders + 3);
  assert.equal(Number(pay.json.kpis.revenue), Number(pay0.json.kpis.revenue) + cashTotal + onlineTotal + openTotal);
  assert.equal(Number(pay.json.kpis.collected), Number(pay0.json.kpis.collected) + cashTotal + onlineTotal);
  assert.equal(Number(pay.json.kpis.pending), Number(pay0.json.kpis.pending) + openTotal);
  const cashRow = pay.json.by_method.find(x => x.payment_method === 'cash' && x.payment_status === 'pending');
  assert.equal(cashRow.status_he, 'ממתין לגבייה');
  assert.ok(Number(cashRow.total) >= openTotal);
  const cashPaidRow = pay.json.by_method.find(x => x.payment_method === 'cash' && x.payment_status === 'paid_cash');
  assert.ok(Number(cashPaidRow.total) >= cashTotal, 'גביית מזומן במסירה');
  assert.ok(pay.json.by_day.length >= 1, 'פילוח יומי');
  assert.equal((await api('/api/t/achuza/settlement/payments?from=2026-13-01', { token: owner })).status, 400);

  // --- CSV תשלומים: BOM + סימון דמו + שורות ---
  const payCsv = await raw('/api/t/achuza/settlement/payments.csv', owner);
  assert.equal(payCsv.status, 200);
  assert.match(payCsv.ct, /text\/csv/);
  assert.deepEqual([...payCsv.buf.subarray(0, 3)], [0xEF, 0xBB, 0xBF], 'BOM לאקסל');
  assert.match(payCsv.text, /מסמך דמו/);
  assert.match(payCsv.text, new RegExp(o1.id.slice(0, 8)));

  // --- עמלה: ציפייה מחושבת, רישום בפועל, הפרש, upsert ---
  const nowIL = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }));
  const Y = nowIL.getFullYear(), M = nowIL.getMonth() + 1;
  const revenue = cashTotal + onlineTotal + openTotal;
  const expectedTotal = Math.round(revenue * 12) / 100; // ערוץ מרקטפלייס 12%
  const comm0 = await api(`/api/t/achuza/settlement/commission?year=${Y}&month=${M}`, { token: owner });
  assert.equal(comm0.status, 200, JSON.stringify(comm0.json));
  assert.ok(comm0.json.expected.marketplace.orders >= 3);
  assert.ok(Number(comm0.json.expected.total) >= expectedTotal);
  const exactExpected = Number(comm0.json.expected.total);
  assert.equal(comm0.json.statement, null, 'טרם נרשמה התחשבנות');
  assert.equal((await api('/api/t/achuza/settlement/commission', { method: 'POST', token: owner, body: { year: Y, month: 13, actual_total: 5 } })).status, 400);
  assert.equal((await api('/api/t/achuza/settlement/commission', { method: 'POST', token: owner, body: { year: Y, month: M, actual_total: -5 } })).status, 400);
  const withDiff = await api('/api/t/achuza/settlement/commission', { method: 'POST', token: owner, body: { year: Y, month: M, actual_total: exactExpected + 10, note: 'הערת בדיקה' } });
  assert.equal(withDiff.status, 200, JSON.stringify(withDiff.json));
  assert.equal(Number(withDiff.json.statement.diff), 10, 'הפרש = בפועל פחות ציפייה');
  const noDiff = await api('/api/t/achuza/settlement/commission', { method: 'POST', token: owner, body: { year: Y, month: M, actual_total: exactExpected } });
  assert.equal(Number(noDiff.json.statement.diff), 0, 'upsert מעדכן את אותה שורה');
  const comm1 = await api(`/api/t/achuza/settlement/commission?year=${Y}&month=${M}`, { token: owner });
  assert.equal(comm1.json.history.length, 1, 'שורה אחת בלבד לחודש (upsert)');
  assert.equal(comm1.json.statement.note, null, 'הערה מתעדכנת גם ל-null');

  // --- ייצוא רואה חשבון: כל המסמכים בתקופה, סימון דמו, שורת סיכום ---
  const docs = await api('/api/t/achuza/documents', { token: owner });
  // שתי הזמנות delivered לעוסק מורשה ששולמו: חשבונית + קבלה לכל אחת; ההזמנה הפתוחה בלי מסמך
  assert.equal(docs.json.documents.length, docs0.json.documents.length + 4, 'חשבונית+קבלה לכל הזמנה ששולמה');
  const accCsv = await raw('/api/t/achuza/settlement/accountant-export.csv', owner);
  assert.equal(accCsv.status, 200);
  assert.deepEqual([...accCsv.buf.subarray(0, 3)], [0xEF, 0xBB, 0xBF], 'BOM לאקסל');
  assert.match(accCsv.text, /מסמך דמו — ייצוא לרואה חשבון/);
  assert.match(accCsv.text, /לא חשבונית מס/);
  assert.match(accCsv.text, /חשבונית עסקה,\d+,/);
  assert.match(accCsv.text, /קבלה,\d+,/);
  assert.match(accCsv.text, /סיכום/);

  // --- בדיקת רצף: תקין, ואז פער מוזרק ישירות ל-DB מזוהה ---
  const seq0 = await api('/api/t/achuza/settlement/sequence-check', { token: owner });
  assert.equal(seq0.status, 200, JSON.stringify(seq0.json));
  assert.equal(seq0.json.ok, true, JSON.stringify(seq0.json));
  const inv = seq0.json.kinds.find(k => k.kind === 'invoice');
  assert.equal(inv.docs, invBase.docs + 2);
  const rec = seq0.json.kinds.find(k => k.kind === 'receipt');
  assert.equal(rec.docs, recBase.docs + 2);
  assert.deepEqual(inv.missing, invBase.missing);
  const pool = new Pool({ connectionString: TEST_DB, max: 1, options: `-c search_path=${schema},public` });
  const { rows: ten } = await pool.query(`SELECT id FROM tenants WHERE slug='achuza'`);
  const { rows: maxN } = await pool.query(`SELECT max(doc_number) AS m FROM documents WHERE tenant_id=$1 AND kind='invoice'`, [ten[0].id]);
  const gapNum = Number(maxN[0].m) + 2; // מדלגים על מספר אחד
  await pool.query(
    `INSERT INTO documents(tenant_id, kind, doc_year, doc_number, amount, vat, total) VALUES ($1,'invoice',2026,$2,10,0,10)`,
    [ten[0].id, gapNum]);
  const seq1 = await api('/api/t/achuza/settlement/sequence-check', { token: owner });
  const inv1 = seq1.json.kinds.find(k => k.kind === 'invoice');
  assert.equal(seq1.json.ok, false);
  assert.ok(inv1.missing.includes(gapNum - 1), 'הפער זוהה: ' + JSON.stringify(inv1));
  assert.ok(inv1.missing.length > inv.missing.length || inv1.counter_next !== inv1.max + 1 || inv1.ok === false, 'ok=false מוצדק');
  await pool.end();
});

test('settlement: מנויים בדוח, סיכום חודשי PDF, עקביות כללית', async (t) => {
  const { api, base } = await startApp(t);
  const owner = await api.login('+972500000003');
  const customer = await api.login('+972500000002');
  const courierUser = await api.login('+972500000004');
  await api('/api/t/achuza/settings', { method: 'PATCH', token: owner, body: { dealer_type: 'morasha', dealer_id: '512345678' } });
  const page = await api('/api/laundries/achuza');
  const bag = page.json.items.find(i => i.name.includes('שק'));
  const plan = (page.json.plans || [])[0];
  const raw = async (p, token) => {
    const r = await fetch(base + p, { headers: token ? { authorization: 'Bearer ' + token } : {} });
    const buf = Buffer.from(await r.arrayBuffer());
    return { status: r.status, buf, text: buf.toString('utf8'), ct: r.headers.get('content-type') || '' };
  };

  // הרשאות: סיכום/עקביות סגורים לחברי מכבסה בלבד
  assert.equal((await raw('/api/t/achuza/settlement/monthly-summary.pdf', customer)).status, 403);
  assert.equal((await api('/api/t/achuza/settlement/consistency', { token: customer })).status, 403);

  // מנוי דמו חדש נספר בדוח התשלומים
  const pay0 = await api('/api/t/achuza/settlement/payments', { token: owner });
  if (plan) {
    const join = await api('/api/subscriptions/join', { method: 'POST', token: customer, body: { slug: 'achuza', plan_id: plan.id } });
    assert.equal(join.status, 201, JSON.stringify(join.json));
    const pay1 = await api('/api/t/achuza/settlement/payments', { token: owner });
    assert.equal(pay1.json.subscriptions.count, pay0.json.subscriptions.count + 1, 'מנוי נספר בדוח');
    assert.ok(Number(pay1.json.subscriptions.total) - Number(pay0.json.subscriptions.total) >= Number(plan.price), 'הכנסת מנוי');
  }

  // סיכום חודשי PDF: מסמך תקין עם סימון דמו בתוכן
  const pdf = await raw('/api/t/achuza/settlement/monthly-summary.pdf', owner);
  assert.equal(pdf.status, 200);
  assert.match(pdf.ct, /application\/pdf/);
  assert.equal(pdf.buf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(pdf.buf.length > 3000, 'PDF לא ריק');

  // עקביות: בסיס (הסיד עשוי להכיל הזמנות ישנות בלי מסמכים) — דלתא חייבת להישאר מאוזנת
  const cons0 = await api('/api/t/achuza/settlement/consistency', { token: owner });
  assert.equal(cons0.status, 200, JSON.stringify(cons0.json));
  await deliverOrder(api, { owner, customer, courierUser, slug: 'achuza', items: [{ item_id: bag.id, qty: 1 }], address: 'עקביות 1', payMethod: 'cash' });
  const cons1 = await api('/api/t/achuza/settlement/consistency', { token: owner });
  const dd0 = cons0.json.checks.find(c => c.key === 'delivered_vs_docs');
  const dd1 = cons1.json.checks.find(c => c.key === 'delivered_vs_docs');
  assert.equal(dd1.a - dd1.b, dd0.a - dd0.b, 'הזמנה שהוחזרה + מסמכיה שומרים על האיזון');
  const un0 = cons0.json.checks.find(c => c.key === 'undocumented');
  const un1 = cons1.json.checks.find(c => c.key === 'undocumented');
  assert.equal(un1.a, un0.a, 'לא נוספה הזמנה ללא מסמך');
  if (cons0.json.ok) assert.equal(cons1.json.ok, true, 'אם הבסיס מאוזן — גם אחרי ההזמנה');
});
