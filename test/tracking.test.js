// T82: מעקב שליח חי — ping נשמר ומוגבל, GET חושף רק שדות מותרים, בידוד שליח/טננט,
// retention 24h, ואין מיקום אחרי מסירה.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Client } = require('pg');
const { startApp, TEST_DB } = require('./helpers');

async function setupDeliveringOrder(api, db) {
  const customer = await api.login('+972500000002');
  const owner = await api.login('+972500000003');
  const item = (await api('/api/laundries/achuza')).json.items[0];
  const made = await api('/api/orders', { method: 'POST', token: customer, body: { slug: 'achuza', items: [{ item_id: item.id, qty: 2 }], address: 'רחוב הבדיקה 1, תל אביב' } });
  assert.equal(made.status, 201);
  const orderId = made.json.order.id;
  const { rows: cr } = await db.query('SELECT id FROM couriers LIMIT 1');
  const asg = await api(`/api/t/achuza/orders/${orderId}/assign`, { method: 'POST', token: owner, body: { courier_id: cr[0].id } });
  assert.equal(asg.status, 200);
  for (const st of ['confirmed', 'picked_up', 'in_work', 'ready']) {
    const r = await api(`/api/t/achuza/orders/${orderId}/status`, { method: 'POST', token: owner, body: { status: st } });
    assert.equal(r.status, 200, 'status ' + st);
  }
  const { rows: oc } = await db.query('SELECT user_id FROM couriers WHERE id=$1', [cr[0].id]);
  const { rows: cu } = await db.query('SELECT phone FROM users WHERE id=$1', [oc[0].user_id]);
  const courier = await api.login(cu[0].phone);
  const mark = await api(`/api/courier/orders/${orderId}/mark`, { method: 'POST', token: courier, body: { action: 'out_for_delivery' } });
  assert.equal(mark.status, 200);
  const { rows: tc } = await db.query('SELECT tracking_code FROM orders WHERE id=$1', [orderId]);
  return { orderId, courier, code: tc[0].tracking_code };
}

test('T82: ping נשמר, GET חושף רק שדות מותרים, בידוד, אין מיקום אחרי מסירה, retention', async t => {
  const { api, schema } = await startApp(t);
  const db = new Client({ connectionString: TEST_DB });
  await db.connect();
  t.after(() => db.end());
  await db.query(`SET search_path TO ${schema}, public`);
  const { orderId, courier, code } = await setupDeliveringOrder(api, db);

  // ping נשמר
  const ping = await api('/api/tracking/ping', { method: 'POST', token: courier, body: { order_id: orderId, lat: 32.085, lon: 34.781, accuracy: 14 } });
  assert.equal(ping.status, 200);
  assert.equal(ping.json.ok, true);
  const { rows: saved } = await db.query('SELECT lat, lon, accuracy FROM courier_pings WHERE order_id=$1', [orderId]);
  assert.equal(saved.length, 1);
  assert.ok(Math.abs(saved[0].lat - 32.085) < 1e-9);

  // GET מחזיר רק שדות מותרים (בלי PII של השליח מעבר לשם פרטי)
  const st = await api(`/api/tracking/${code}/state`);
  assert.equal(st.status, 200);
  assert.equal(st.json.status, 'out_for_delivery');
  assert.ok(st.json.position && Math.abs(st.json.position.lat - 32.085) < 1e-9);
  assert.equal(typeof st.json.courier_first_name, 'string');
  assert.ok(!/\s/.test(st.json.courier_first_name), 'שם פרטי בלבד');
  const flat = JSON.stringify(st.json);
  assert.ok(!flat.includes('phone') && !flat.includes('@') && !flat.includes('tenant_id'), 'אין PII/טננט ב-GET');

  // שליח אחר (לא משובץ) — 403
  const other = await api.login('+972500000005');
  const denied = await api('/api/tracking/ping', { method: 'POST', token: other, body: { order_id: orderId, lat: 32.1, lon: 34.8 } });
  assert.equal(denied.status, 403);

  // אין מיקום אחרי מסירה + pings נמחקים
  const del = await api(`/api/courier/orders/${orderId}/mark`, { method: 'POST', token: courier, body: { action: 'delivered', cash: { outcome: 'collected' } } });
  assert.equal(del.status, 200);
  const after = await api(`/api/tracking/${code}/state`);
  assert.equal(after.json.status, 'delivered');
  assert.equal(after.json.position, null);
  const { rows: gone } = await db.query('SELECT 1 FROM courier_pings WHERE order_id=$1', [orderId]);
  assert.equal(gone.length, 0, 'pings נמחקים אחרי מסירה');

  // retention: ping מעל 24 שעות נמחק בקריאה הבאה
  const { rows: tn } = await db.query('SELECT tenant_id, courier_id FROM orders WHERE id=$1', [orderId]);
  await db.query(`INSERT INTO courier_pings (tenant_id, courier_id, order_id, lat, lon, ts) VALUES ($1,$2,$3,32.0,34.7, now() - interval '25 hours')`, [tn[0].tenant_id, tn[0].courier_id, orderId]);
  await api(`/api/tracking/${code}/state`); // טריגר prune
  const { rows: old } = await db.query(`SELECT 1 FROM courier_pings WHERE order_id=$1 AND ts < now() - interval '24 hours'`, [orderId]);
  assert.equal(old.length, 0, 'retention 24 שעות');

  // ping כשההזמנה כבר נמסרה — נדחה
  const late = await api('/api/tracking/ping', { method: 'POST', token: courier, body: { order_id: orderId, lat: 32.0, lon: 34.7 } });
  assert.equal(late.status, 409);

  // הגבלת קצב: הזמנה שנייה בדרך אל הלקוח — 20 pings מותרים בחלון, אחר כך 429
  const o2 = await setupDeliveringOrder(api, db);
  let got429 = false;
  for (let i = 0; i < 25; i++) {
    const p = await api('/api/tracking/ping', { method: 'POST', token: o2.courier, body: { order_id: o2.orderId, lat: 32.0 + i / 1000, lon: 34.7 } });
    if (p.status === 429) { got429 = true; break; }
  }
  assert.ok(got429, 'rate limit על ping');
});
