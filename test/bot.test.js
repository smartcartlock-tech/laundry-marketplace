const { test } = require('node:test');
const assert = require('node:assert');
const { startApp, TEST_DB } = require('./helpers');
const { Client } = require('pg');

test('bot API: אימות מפתח, מחירון, יצירת הזמנה מזוהה-טלפון', async (t) => {
  const { api, schema } = await startApp(t);

  const noKey = await api('/api/bot/pricelist');
  assert.equal(noKey.status, 401);
  const badKey = await api('/api/bot/pricelist', { apiKey: 'nope' });
  assert.equal(badKey.status, 401);

  // B3: המפתח לא נשמר גלוי — מקבלים אותו פעם אחת ברוטציית אדמין
  const admin = await api.login('+972500000001');
  const { rows: tidRows } = await (async () => { const db = new Client({ connectionString: TEST_DB, options: `-c search_path=${schema}` }); await db.connect(); const r = await db.query(`SELECT id FROM tenants WHERE slug='achuza'`); await db.end(); return r; })();
  const rot = await api('/api/admin/tenants/' + tidRows[0].id + '/apikey/rotate', { method: 'POST', token: admin });
  assert.equal(rot.status, 200, JSON.stringify(rot.json));
  const key = rot.json.api_key;
  assert.ok(key);

  const pl = await api('/api/bot/pricelist', { apiKey: key });
  assert.equal(pl.status, 200);
  assert.equal(pl.json.tenant.slug, 'achuza');
  const bag = pl.json.items.find(i => i.name.includes('שק'));
  assert.ok(bag);

  const windows = await api('/api/bot/windows', { apiKey: key });
  assert.equal(windows.status, 200);
  assert.ok(windows.json.windows.length > 0);

  const created = await api('/api/bot/orders', { method: 'POST', apiKey: key, body: { phone: '0521234567', name: 'לקוח בוט', items: [{ item_id: bag.id, qty: 2 }], address: 'דיזנגוף 5, תל אביב' } });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  assert.equal(Number(created.json.total), 112 + 15);
  const oid = created.json.order_id;
  assert.ok(oid);
  const fetched = await api('/api/bot/orders/' + oid, { apiKey: key });
  assert.equal(fetched.status, 200);
  const order = fetched.json.order;

  // אותו לקוח מזוהה לפי טלפון — ההזמנה מופיעה בחשבון האפליקציה שלו
  const token = await api.login('0521234567');
  const mine = await api('/api/orders/mine', { token });
  assert.ok(mine.json.orders.find(o => o.id === oid));

  const latest = await api('/api/bot/customers/+972521234567/latest-order', { apiKey: key });
  assert.equal(latest.status, 200);
  assert.equal(latest.json.order.id, oid);
});
