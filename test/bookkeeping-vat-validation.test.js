// T41: ולידציית מע"מ — חסימת שיעור מעל התקרה החוקית (18%) במסמכים ובתשומות.
process.env.NODE_ENV = 'test';
const { test } = require('node:test');
const assert = require('node:assert');
const { startApp, TEST_DB } = require('./helpers');
const { Pool } = require('pg');

test('T41: מע"מ מעל 18% מהנטו נחסם במסמכים ובהוצאות; שיעור חוקי ועיגול עוברים', async (t) => {
  const { api, schema } = await startApp(t);
  const owner = await api.login('+972500000003');
  const B = '/api/t/achuza/bookkeeping';
  const pool = new Pool({ connectionString: TEST_DB, max: 1, options: `-c search_path=${schema},public` });
  await pool.query(`UPDATE tenants SET dealer_type='morasha' WHERE slug='achuza'`);
  await api(`${B}/init`, { method: 'POST', token: owner });

  await t.test('מסמך: מע"מ 18% בדיוק עובר', async () => {
    const r = await api(`${B}/documents`, { method: 'POST', token: owner, body: { kind: 'invoice', customer_name: 'לקוח א', amount_net: 1000, vat_amount: 180 } });
    assert.equal(r.status, 201, JSON.stringify(r.json));
  });

  await t.test('מסמך: מע"מ בתוך מרווח העיגול (18% + אגורה) עובר', async () => {
    const r = await api(`${B}/documents`, { method: 'POST', token: owner, body: { kind: 'invoice', customer_name: 'לקוח ב', amount_net: 100, vat_amount: 18.01 } });
    assert.equal(r.status, 201, JSON.stringify(r.json));
  });

  await t.test('מסמך: מע"מ מעל התקרה (19%) נחסם עם הודעה ברורה', async () => {
    const r = await api(`${B}/documents`, { method: 'POST', token: owner, body: { kind: 'invoice', customer_name: 'לקוח ג', amount_net: 1000, vat_amount: 190 } });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /מע"מ מעל השיעור החוקי/);
    assert.match(r.json.error, /180\.00/);
  });

  await t.test('מסמך: מע"מ 0 (סל פטור) עובר', async () => {
    const r = await api(`${B}/documents`, { method: 'POST', token: owner, body: { kind: 'invoice', customer_name: 'לקוח ד', amount_net: 500, vat_amount: 0 } });
    assert.equal(r.status, 201, JSON.stringify(r.json));
  });

  let supId;
  await t.test('הכנה: כרטיס ספק', async () => {
    const r = await api(`${B}/parties`, { method: 'POST', token: owner, body: { kind: 'supplier', name: 'ספק מע"מ' } });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    supId = r.json.party.id;
  });

  await t.test('הוצאה: מע"מ תשומות 18% עובר', async () => {
    const r = await api(`${B}/expenses`, { method: 'POST', token: owner, body: { party_id: supId, expense_date: '2026-10-17', description: 'חומרים', account_code: '5000', amount_net: 200, vat_amount: 36 } });
    assert.equal(r.status, 201, JSON.stringify(r.json));
  });

  await t.test('הוצאה: מע"מ תשומות מעל התקרה נחסם', async () => {
    const r = await api(`${B}/expenses`, { method: 'POST', token: owner, body: { party_id: supId, expense_date: '2026-10-17', description: 'חומרים', account_code: '5000', amount_net: 200, vat_amount: 40 } });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /תשומות: מע"מ מעל השיעור החוקי/);
  });

  await pool.end();
});
