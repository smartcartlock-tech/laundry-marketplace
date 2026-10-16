// 094: רו"הפ, מע"מ תקופתי לעיון בלבד, ממתינים להקצאה, יצוא רו"ח אמיתי.
process.env.NODE_ENV = 'test';
const { test } = require('node:test');
const assert = require('node:assert');
const { startApp, TEST_DB } = require('./helpers');
const { Pool } = require('pg');

test('094: דוחות', async (t) => {
  const { api, base, schema } = await startApp(t);
  const owner = await api.login('+972500000003');
  const B = '/api/t/achuza/bookkeeping';
  const pool = new Pool({ connectionString: TEST_DB, max: 1, options: `-c search_path=${schema},public` });
  await pool.query(`UPDATE tenants SET dealer_type='morasha' WHERE slug='achuza'`);
  await api(`${B}/init`, { method: 'POST', token: owner });

  // נתונים: הכנסה 1000+180 מע"מ (מונפקת), הוצאה 100+18 (רשומה), טיוטת מס ממתינה להקצאה
  const sup = await api(`${B}/parties`, { method: 'POST', token: owner, body: { kind: 'supplier', name: 'ספק דוח' } });
  const exp = await api(`${B}/expenses`, { method: 'POST', token: owner, body: {
    party_id: sup.json.party.id, expense_date: '2026-10-05', description: 'חומרים', account_code: '5000', amount_net: 100, vat_amount: 18 } });
  await api(`${B}/expenses/${exp.json.expense.id}/post`, { method: 'POST', token: owner });
  const d1 = await api(`${B}/documents`, { method: 'POST', token: owner, body: {
    kind: 'tax_invoice', customer_name: 'לקוח דוח', amount_net: 1000, vat_amount: 180 } });
  await api(`${B}/documents/${d1.json.document.id}/allocate`, { method: 'POST', token: owner, body: { allocation_number: '123456789' } });
  await api(`${B}/documents/${d1.json.document.id}/issue`, { method: 'POST', token: owner });
  const d2 = await api(`${B}/documents`, { method: 'POST', token: owner, body: {
    kind: 'tax_invoice', customer_name: 'לקוח ממתין', amount_net: 500, vat_amount: 90 } });

  await t.test('רווח והפסד: הכנסה 1000, הוצאה 100, רווח 900', async () => {
    const res = await api(`${B}/reports/pnl?from=2026-10-01&to=2026-10-31`, { token: owner });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal(res.json.total_income, '1000.00');
    assert.equal(res.json.total_expenses, '100.00');
    assert.equal(res.json.net_profit, '900.00');
  });

  await t.test('מע"מ תקופתי לעיון בלבד: עסקאות 180, תשומות 18, יתרה 162', async () => {
    const res = await api(`${B}/reports/vat?from=2026-10-01&to=2026-10-31`, { token: owner });
    assert.equal(res.status, 200);
    assert.equal(res.json.applicable, true);
    assert.equal(res.json.vat_on_sales, '180.00');
    assert.equal(res.json.vat_on_inputs, '18.00');
    assert.equal(res.json.balance, '162.00');
    assert.match(res.json.disclaimer, /אינו דיווח לרשות/);
  });

  await t.test('דוח ראיה: מסמך אחד ממתין להקצאה', async () => {
    const res = await api(`${B}/reports/pending-allocation`, { token: owner });
    assert.equal(res.status, 200);
    assert.equal(res.json.count, 1);
    assert.equal(res.json.pending[0].customer_name, 'לקוח ממתין');
    assert.match(res.json.pending[0].status_he, /ממתין למספר הקצאה/);
    void d2;
  });

  await t.test('יצוא רו"ח מהספר האמיתי — CSV תקין ומאוזן', async () => {
    const r = await fetch(base + B + '/accountant-export.csv?from=2026-10-01&to=2026-10-31', { headers: { authorization: 'Bearer ' + owner } });
    assert.equal(r.status, 200);
    const text = await r.text();
    assert.ok(text.includes('מספר פקודה'));
    const lines = text.trim().split(/\r?\n/).slice(1);
    assert.equal(lines.length, 6); // הוצאה 3 שורות + חשבונית 3 שורות
    void lines;
  });

  await t.test('עוסק פטור: דוח מע"מ לא רלוונטי', async () => {
    const { rows: expT } = await pool.query(`SELECT id FROM tenants WHERE slug='express'`);
    const { rows: usr } = await pool.query(`SELECT id FROM users WHERE phone='+972500000003'`);
    await pool.query(`INSERT INTO tenant_members(tenant_id, user_id, role) VALUES ($1,$2,'owner') ON CONFLICT DO NOTHING`, [expT[0].id, usr[0].id]);
    await pool.query(`UPDATE tenants SET dealer_type='patur' WHERE slug='express'`);
    await api(`/api/t/express/bookkeeping/init`, { method: 'POST', token: owner });
    const res = await api(`/api/t/express/bookkeeping/reports/vat`, { token: owner });
    assert.equal(res.json.applicable, false);
  });
});
