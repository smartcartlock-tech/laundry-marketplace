// 092: מסמכי הכנסה — טיוטה ממתינה להקצאה, הנפקה עם מספור רציף + פקודה, מורשה/פטור.
process.env.NODE_ENV = 'test';
const { test } = require('node:test');
const assert = require('node:assert');
const { startApp, TEST_DB } = require('./helpers');
const { Pool } = require('pg');

test('092: מסמכים — טיוטה/הקצאה/הנפקה', async (t) => {
  const { api, schema } = await startApp(t);
  const owner = await api.login('+972500000003');
  const B = '/api/t/achuza/bookkeeping';
  const pool = new Pool({ connectionString: TEST_DB, max: 1, options: `-c search_path=${schema},public` });
  await pool.query(`UPDATE tenants SET dealer_type='morasha' WHERE slug='achuza'`);
  await api(`${B}/init`, { method: 'POST', token: owner });

  let docId;
  await t.test('חשבונית מס נוצרת כטיוטה ממתינה להקצאה', async () => {
    const res = await api(`${B}/documents`, { method: 'POST', token: owner, body: {
      kind: 'tax_invoice', customer_name: 'לקוח בדיקה בע"מ', customer_tax_id: '511223344',
      amount_net: 1000, vat_amount: 180,
      lines: [{ description: 'כביסה חודשית', quantity: 10, unit_price: 100 }] } });
    assert.equal(res.status, 201, JSON.stringify(res.json));
    docId = res.json.document.id;
    assert.equal(res.json.document.status_he, 'טיוטה');
  });

  await t.test('T44: לקוח ללא סיווג מורשה אינו מקבל אזהרת הקצאה', async () => {
    const res = await api(`${B}/documents`, { token: owner });
    const d = res.json.documents.find(x=>x.id===docId);
    assert.equal(d.allocation_recommended,false);
    assert.equal(d.allocation_warning,null);
  });

  await t.test('מספר הקצאה לא תקין נדחה; תקין מתקבל', async () => {
    const bad = await api(`${B}/documents/${docId}/allocate`, { method: 'POST', token: owner, body: { allocation_number: '12345' } });
    assert.equal(bad.status, 400);
    const ok = await api(`${B}/documents/${docId}/allocate`, { method: 'POST', token: owner, body: { allocation_number: '123456789' } });
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
  });

  await t.test('הנפקה: מספר סידורי 1 + פקודה מאוזנת בספר', async () => {
    const res = await api(`${B}/documents/${docId}/issue`, { method: 'POST', token: owner });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal(res.json.doc_number, 1);
    const tb = await api(`${B}/trial-balance`, { token: owner });
    assert.equal(tb.json.totals.balanced, true);
    const cust = tb.json.accounts.find(a => a.code === '1020');
    const inc = tb.json.accounts.find(a => a.code === '4000');
    const vat = tb.json.accounts.find(a => a.code === '2010');
    assert.equal(cust.debit, '1180.00');
    assert.equal(inc.credit, '1000.00');
    assert.equal(vat.credit, '180.00');
  });

  await t.test('מספור רציף במסמך שני ואין חזרה על סטטוס', async () => {
    const d2 = await api(`${B}/documents`, { method: 'POST', token: owner, body: {
      kind: 'tax_invoice', customer_name: 'לקוח שני', amount_net: 50, vat_amount: 9 } });
    await api(`${B}/documents/${d2.json.document.id}/allocate`, { method: 'POST', token: owner, body: { allocation_number: '123456790' } });
    const i2 = await api(`${B}/documents/${d2.json.document.id}/issue`, { method: 'POST', token: owner });
    assert.equal(i2.json.doc_number, 2);
    const again = await api(`${B}/documents/${docId}/issue`, { method: 'POST', token: owner });
    assert.equal(again.status, 409);
  });

  await t.test('סכום שורות חייב להתאים למסמך', async () => {
    const res = await api(`${B}/documents`, { method: 'POST', token: owner, body: {
      kind: 'receipt', customer_name: 'לקוח שורות', amount_net: 100, lines: [{ description: 'y', quantity: 1, unit_price: 90 }] } });
    assert.equal(res.status, 400);
    assert.match(res.json.error, /לא תואם/);
  });

  await t.test('קבלה (400) מונפקת בלי הקצאה, לחובת הקופה', async () => {
    const res = await api(`${B}/documents`, { method: 'POST', token: owner, body: {
      kind: 'receipt', customer_name: 'לקוח מזומן', amount_net: 200, vat_amount: 0 } });
    assert.equal(res.status, 201);
    const issue = await api(`${B}/documents/${res.json.document.id}/issue`, { method: 'POST', token: owner });
    assert.equal(issue.status, 200, JSON.stringify(issue.json));
    const tb = await api(`${B}/trial-balance`, { token: owner });
    const cash = tb.json.accounts.find(a => a.code === '1000');
    assert.equal(cash.debit, '200.00');
  });

  await t.test('ביטול טיוטה מותר; מסמך מונפק לא', async () => {
    const d = await api(`${B}/documents`, { method: 'POST', token: owner, body: {
      kind: 'receipt', customer_name: 'לביטול', amount_net: 10 } });
    const cancel = await api(`${B}/documents/${d.json.document.id}/cancel`, { method: 'POST', token: owner });
    assert.equal(cancel.status, 200);
    const issuedCancel = await api(`${B}/documents/${docId}/cancel`, { method: 'POST', token: owner });
    assert.equal(issuedCancel.status, 409);
  });

  await t.test('עוסק פטור: חשבונית מס נדחית, חשבונית עסקה מונפקת בלי הקצאה', async () => {
    const { rows: exp } = await pool.query(`SELECT id FROM tenants WHERE slug='express'`);
    const { rows: usr } = await pool.query(`SELECT id FROM users WHERE phone='+972500000003'`);
    await pool.query(`INSERT INTO tenant_members(tenant_id, user_id, role) VALUES ($1,$2,'owner') ON CONFLICT DO NOTHING`, [exp[0].id, usr[0].id]);
    await pool.query(`UPDATE tenants SET dealer_type='patur' WHERE slug='express'`);
    const E = '/api/t/express/bookkeeping';
    await api(`${E}/init`, { method: 'POST', token: owner });
    const denied = await api(`${E}/documents`, { method: 'POST', token: owner, body: {
      kind: 'tax_invoice', customer_name: 'x', amount_net: 100 } });
    assert.equal(denied.status, 400);
    const ok = await api(`${E}/documents`, { method: 'POST', token: owner, body: {
      kind: 'invoice', customer_name: 'לקוח פטור', amount_net: 300, vat_amount: 0 } });
    assert.equal(ok.status, 201, JSON.stringify(ok.json));
    const issue = await api(`${E}/documents/${ok.json.document.id}/issue`, { method: 'POST', token: owner });
    assert.equal(issue.status, 200, JSON.stringify(issue.json));
    assert.equal(issue.json.doc_number, 1);
  });
});
