// C5: סיכום יום תפעולי — מוני היום, הרשאות
const { test } = require('node:test');
const assert = require('node:assert');
const { startApp, TEST_DB } = require('./helpers');
const { Client } = require('pg');

test('ops daily-summary: מונים, הרשאות', async (t) => {
  const { api, schema } = await startApp(t);
  const owner = await api.login('+972500000003');
  const customer = await api.login('+972500000002');

  const it = await api('/api/t/achuza/items', { method: 'POST', token: owner, body: { name: 'שק סיכום', price: 30, unit: 'bag', category: 'כביסה' } });
  assert.equal(it.status, 201);
  const o = await api('/api/orders', { method: 'POST', token: customer, body: { slug: 'achuza', items: [{ item_id: it.json.item.id, qty: 2 }], address: 'רחוב הסיכום 7, תל אביב' } });
  assert.equal(o.status, 201, JSON.stringify(o.json));
  const id = o.json.order.id;

  // confirmed דרך ה-API; picked_up דורש שיבוץ שליח, לכן האירוע מוזן ישירות (בודק את ספירת אירועי היום)
  const st = await api(`/api/t/achuza/orders/${id}/status`, { method: 'POST', token: owner, body: { status: 'confirmed' } });
  assert.ok([200, 204].includes(st.status), JSON.stringify(st.json));
  const pg = new Client({ connectionString: TEST_DB });
  await pg.connect();
  await pg.query(`INSERT INTO "${schema}".order_events(order_id, status) VALUES ($1, 'picked_up')`, [id]);
  await pg.end();

  // הרשאות
  assert.equal((await api('/api/t/achuza/ops/daily-summary')).status, 401);
  assert.ok([401, 403].includes((await api('/api/t/achuza/ops/daily-summary', { token: customer })).status));

  const s = await api('/api/t/achuza/ops/daily-summary', { token: owner });
  assert.equal(s.status, 200, JSON.stringify(s.json));
  assert.ok(s.json.created_today >= 1);
  assert.ok(s.json.picked_today >= 1, 'איסוף היום נספר');
  assert.equal(typeof s.json.delivered_today, 'number');
  assert.ok(Array.isArray(s.json.late) && Array.isArray(s.json.couriers));
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(s.json.date));
});
