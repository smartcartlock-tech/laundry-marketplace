// הרשאות בוט: סשן בוט מרכזי רואה רק הזמנות של הטלפון שאיתו נוצר
const { test } = require('node:test');
const assert = require('node:assert');
const { startApp, TEST_DB } = require('./helpers');
const { Client } = require('pg');

async function dbQuery(schema, sql, params = []) {
  const db = new Client({ connectionString: TEST_DB, options: `-c search_path=${schema}` });
  await db.connect();
  try { return (await db.query(sql, params)).rows; } finally { await db.end(); }
}

test('סשן בוט מבודד: הזמנה של לקוח אחר → 404/403, שלו → 200', async (t) => {
  const { api, schema } = await startApp(t);
  const admin = await api.login('+972500000001');
  const [tid] = await dbQuery(schema, `SELECT id FROM tenants WHERE slug='achuza'`);
  const rot = await api(`/api/admin/tenants/${tid.id}/apikey/rotate`, { method: 'POST', token: admin });
  const key = rot.json.api_key;

  // שתי הזמנות לשני לקוחות דרך מפתח המכבסה
  const pl = await api('/api/bot/pricelist', { apiKey: key });
  const bag = pl.json.items.find(i => i.name.includes('שק'));
  const mk = (phone) => api('/api/bot/orders', { method: 'POST', apiKey: key, body: { phone, items: [{ item_id: bag.id, qty: 1 }], address: 'רחוב בדיקה 5, תל אביב' } });
  const oA = await mk('+972500000201');
  const oB = await mk('+972500000202');
  assert.equal(oA.status, 201, JSON.stringify(oA.json));
  assert.equal(oB.status, 201);

  // סשן בוט מרכזי ללקוח A
  const [sess] = await dbQuery(schema, 'INSERT INTO bot_sessions(phone, tenant_id) VALUES ($1,$2) RETURNING token', ['+972500000201', tid.id]);
  const sKey = sess.token;

  // ההזמנה של A נגישה
  const mine = await api('/api/bot/orders/' + oA.json.order_id, { apiKey: sKey });
  assert.equal(mine.status, 200, JSON.stringify(mine.json));
  // ההזמנה של B חסומה — 404 בלי חשיפת קיום
  const other = await api('/api/bot/orders/' + oB.json.order_id, { apiKey: sKey });
  assert.equal(other.status, 404);
  // latest-order של טלפון אחר — 403
  const latestOther = await api('/api/bot/customers/+972500000202/latest-order', { apiKey: sKey });
  assert.equal(latestOther.status, 403);
  // שלו — 200 עם ההזמנה שלו
  const latestMine = await api('/api/bot/customers/+972500000201/latest-order', { apiKey: sKey });
  assert.equal(latestMine.status, 200);
  assert.equal(latestMine.json.order.id, oA.json.order_id);
  // מפתח מכבסה קבוע (לא סשן) — לא מושפע מההגבלה
  const tenantView = await api('/api/bot/orders/' + oB.json.order_id, { apiKey: key });
  assert.equal(tenantView.status, 200);
});
