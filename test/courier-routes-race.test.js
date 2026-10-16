// מסך שליח: רגרסיה למרוץ שיבוץ מקבילי ב-auto-build (נמצא בבדיקת עומס קצה).
// לפני התיקון (מיגרציה 045): N בניית מסלולים מקבילות שיבצו כל הזמנה ל-N מסלולים.
// אחרי התיקון: אינדקס ייחודי על courier_route_stops(order_id) — רק בניה אחת מנצחת,
// והמפסידות מתבטלות (500) בלי להשאיר שיבוץ כפול.
const { test } = require('node:test');
const assert = require('node:assert');
const { startApp, TEST_DB } = require('./helpers');
const { Client } = require('pg');

async function makeOrder(api, token, slug) {
  const l = await api('/api/laundries/' + slug);
  const item = l.json.items[0];
  const r = await api('/api/orders', { method: 'POST', token, body: { slug, items: [{ item_id: item.id, qty: 1 }], address: 'רחוב המרוץ 1, תל אביב' } });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return r.json.order.id;
}

test('auto-build מקבילי: הזמנה לא משובצת ליותר ממסלול אחד', async (t) => {
  const { api, schema } = await startApp(t);
  const admin = await api.login('+972500000001');
  const customer = await api.login('+972500000002');

  const orderIds = [];
  for (let i = 0; i < 6; i++) orderIds.push(await makeOrder(api, customer, 'achuza'));
  for (const oid of orderIds) {
    const c = await api(`/api/t/achuza/orders/${oid}/status`, { method: 'POST', token: admin, body: { status: 'confirmed' } });
    assert.equal(c.status, 200, JSON.stringify(c.json));
  }

  // 6 בניית מסלולים במקביל — הצד המפסיד במרוץ מתבטל (אינדקס ייחודי), בלי שיבוץ כפול
  const results = await Promise.all(Array.from({ length: 6 }, () =>
    api('/api/admin/routes/auto-build', { method: 'POST', token: admin, body: {} })));
  for (const r of results) assert.equal(r.status, 200, 'status בלתי צפוי: ' + r.status + ' ' + JSON.stringify(r.json));
  assert.ok(results.some(r => r.json.routes && r.json.routes.length), 'לפחות בניה אחת צריכה לשבץ');
  for (const r of results) if (!r.json.routes.length) assert.match(r.json.skipped || '', /parallel|no unassigned/, 'skipped בלתי צפוי: ' + r.json.skipped);

  const db = new Client({ connectionString: TEST_DB });
  await db.connect();
  await db.query(`SET search_path TO "${schema}"`);
  const { rows } = await db.query(
    `SELECT count(*) AS stops, count(DISTINCT order_id) AS distinct_orders
     FROM courier_route_stops WHERE order_id = ANY($1::uuid[])`, [orderIds]);
  assert.equal(Number(rows[0].stops), Number(rows[0].distinct_orders),
    `שיבוץ כפול: ${rows[0].stops} עצירות ל-${rows[0].distinct_orders} הזמנות`);
  assert.equal(Number(rows[0].distinct_orders), orderIds.length, 'לא כל ההזמנות שובצו');

  // ניסיון חוזר אחרי שהמרוץ הסתיים: לא נוצרות עצירות כפולות
  const again = await api('/api/admin/routes/auto-build', { method: 'POST', token: admin, body: {} });
  assert.equal(again.status, 200, JSON.stringify(again.json));
  const { rows: after } = await db.query(
    `SELECT count(*) AS stops FROM courier_route_stops WHERE order_id = ANY($1::uuid[])`, [orderIds]);
  assert.equal(Number(after[0].stops), orderIds.length, 'בניה חוזרת יצרה עצירות כפולות');
  await db.end();
});
