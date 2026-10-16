// בידוד טננטים בנתיבי הנה"ח החדשים (091/092): לא-בעלים 403, חוצה-טננט 404, אנונימי 401
const { test } = require('node:test');
const assert = require('node:assert');
const { startApp, TEST_DB } = require('./helpers');
const { Client } = require('pg');

async function sql(schema, text, params = []) {
  const db = new Client({ connectionString: TEST_DB, options: `-c search_path=${schema}` });
  await db.connect();
  try { return (await db.query(text, params)).rows; } finally { await db.end(); }
}

test('הרשאות: אנונימי 401, לקוח/שליח 403, בעלים של טננט אחר 403', async (t) => {
  const { api } = await startApp(t);
  const anon = await api('/api/t/achuza/bookkeeping/accounts');
  assert.equal(anon.status, 401);
  const customer = await api.login('+972500000002');
  const courier = await api.login('+972500000004');
  for (const p of ['/bookkeeping/accounts', '/bookkeeping/entries', '/bookkeeping/expenses', '/bookkeeping/trial-balance', '/bookkeeping/periods']) {
    const r1 = await api('/api/t/achuza' + p, { token: customer });
    assert.equal(r1.status, 403, 'customer ' + p + ' got ' + r1.status);
    const r2 = await api('/api/t/achuza' + p, { token: courier });
    assert.equal(r2.status, 403, 'courier ' + p + ' got ' + r2.status);
  }
  // בעלים של achuza — לא בעלים של express
  const owner = await api.login('+972500000003');
  const crossOwner = await api('/api/t/express/bookkeeping/accounts', { token: owner });
  assert.equal(crossOwner.status, 403);
  const ok = await api('/api/t/achuza/bookkeeping/accounts', { token: owner });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
});

test('חוצה טננט: reverse/expense של טננט אחר — 404, בלי חשיפת קיום', async (t) => {
  const { api, schema } = await startApp(t);
  const owner = await api.login('+972500000003');
  // פקודה והוצאה שייכות ל-express
  const [express] = await sql(schema, `SELECT id FROM tenants WHERE slug='express'`);
  const [entry] = await sql(schema,
    `INSERT INTO bk_entries (tenant_id, entry_no, entry_date, description, source) VALUES ($1, 9001, '2026-10-16', 'בדיקה', 'manual') RETURNING id`, [express.id]);
  const [party] = await sql(schema,
    `INSERT INTO bk_parties (tenant_id, kind, name) VALUES ($1, 'supplier', 'ספק בדיקה') RETURNING id`, [express.id]);
  const [expense] = await sql(schema,
    `INSERT INTO bk_expenses (tenant_id, party_id, expense_date, description, account_code, amount_net)
     VALUES ($1, $2, '2026-10-16', 'בדיקה', '5090', 100) RETURNING id`, [express.id, party.id]);
  // בעל achuza מנסה לגשת דרך הנתיב שלו למזהים של express
  const rev = await api(`/api/t/achuza/bookkeeping/entries/${entry.id}/reverse`, { method: 'POST', token: owner, body: {} });
  assert.equal(rev.status, 404, 'reverse cross-tenant');
  const file = await api(`/api/t/achuza/bookkeeping/expenses/${expense.id}/file`, { token: owner });
  assert.equal(file.status, 404, 'expense file cross-tenant');
  const post = await api(`/api/t/achuza/bookkeeping/expenses/${expense.id}/post`, { method: 'POST', token: owner, body: {} });
  assert.equal(post.status, 404, 'expense post cross-tenant');
});
