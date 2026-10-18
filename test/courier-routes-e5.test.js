const { test } = require('node:test');
const assert = require('node:assert');
const { startApp } = require('./helpers');

async function makeOrder(api, token, slug) {
  const l = await api('/api/laundries/' + slug);
  const item = l.json.items[0];
  const r = await api('/api/orders', { method: 'POST', token, body: { slug, items: [{ item_id: item.id, qty: 1 }], address: 'רחוב הבדיקה 1, תל אביב' } });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return r.json.order.id;
}

test('E5.T3+T4: מסלול משולב רב-מכבסתי, פיצול תשלום ודוח רווחים', async (t) => {
  const { api } = await startApp(t);
  const admin = await api.login('+972500000001');
  const customer = await api.login('+972500000002');
  const platformCourier = await api.login('+972500000005');

  // שתי הזמנות בשתי מכבסות שונות באותה עיר
  const o1 = await makeOrder(api, customer, 'achuza');
  const o2 = await makeOrder(api, customer, 'express');
  for (const [slug, oid] of [['achuza', o1], ['express', o2]]) {
    const c = await api(`/api/t/${slug}/orders/${oid}/status`, { method: 'POST', token: admin, body: { status: 'confirmed' } });
    assert.equal(c.status, 200, JSON.stringify(c.json));
  }

  // בניית מסלולים אוטומטית → מסלול משולב אחד מ-2 מכבסות
  const build = await api('/api/admin/routes/auto-build', { method: 'POST', token: admin, body: {} });
  assert.equal(build.status, 200, JSON.stringify(build.json));
  const combined = build.json.routes.find(x => x.combined);
  assert.ok(combined, 'expected a combined route');
  assert.equal(combined.tenants, 2);
  assert.equal(combined.stops, 2);

  // רק אדמין יכול לבנות מסלולים
  const forbidden = await api('/api/admin/routes/auto-build', { method: 'POST', token: customer, body: {} });
  assert.equal(forbidden.status, 403);

  // השליח רואה רצף אחד מאוחד עם סדר נקודות
  const route = await api('/api/courier/route', { token: platformCourier });
  assert.equal(route.status, 200);
  const myStops = route.json.route.filter(x => [o1, o2].includes(x.id));
  assert.equal(myStops.length, 2);
  assert.ok(route.json.combined);
  assert.deepEqual(myStops.map(x => x.route_seq).sort(), [1, 2]);

  const today = await api('/api/courier/routes/today', { token: platformCourier });
  assert.equal(today.status, 200);
  assert.ok(today.json.route);
  assert.equal(today.json.route.stops.length, 2);
  assert.equal(today.json.route.combined, true);

  // מכבסה רואה רק את ההזמנות שלה
  const owner = await api.login('+972500000003');
  const tOrders = await api('/api/t/achuza/orders', { token: owner });
  assert.ok(tOrders.json.orders.find(x => x.id === o1));
  assert.ok(!tOrders.json.orders.find(x => x.id === o2));
  const noAccess = await api('/api/t/express/orders', { token: owner });
  assert.equal(noAccess.status, 403);

  // E5.T4: סימון איסוף → צבירת נקודה לכל מכבסה בנפרד
  for (const oid of [o1, o2]) {
    const m = await api(`/api/courier/orders/${oid}/mark`, { method: 'POST', token: platformCourier, body: { action: 'picked_up' } });
    assert.equal(m.status, 200, JSON.stringify(m.json));
  }
  let earn = await api('/api/courier/earnings', { token: platformCourier });
  assert.equal(earn.status, 200);
  assert.equal(earn.json.totals.stops, 2);
  assert.equal(Number(earn.json.totals.gross), 24);
  assert.equal(earn.json.by_tenant.length, 2); // פיצול לפי מכבסה
  for (const row of earn.json.by_tenant) {
    assert.equal(row.stops, 1);
    assert.equal(Number(row.gross), 12);
    assert.equal(Number(row.commission), 2.4);
    assert.equal(Number(row.net), 9.6);
  }

  // המשך זרימה: in_work → ready → out_for_delivery → delivered מוסיף נקודת מסירה
  for (const [slug, oid] of [['achuza', o1], ['express', o2]]) {
    await api(`/api/t/${slug}/orders/${oid}/status`, { method: 'POST', token: admin, body: { status: 'in_work' } });
    await api(`/api/t/${slug}/orders/${oid}/status`, { method: 'POST', token: admin, body: { status: 'ready' } });
    await api(`/api/courier/orders/${oid}/mark`, { method: 'POST', token: platformCourier, body: { action: 'out_for_delivery' } });
    const d = await api(`/api/courier/orders/${oid}/mark`, { method: 'POST', token: platformCourier, body: { action: 'delivered', cash: { outcome: 'collected' } } });
    assert.equal(d.status, 200);
  }
  earn = await api('/api/courier/earnings', { token: platformCourier });
  assert.equal(earn.json.totals.stops, 4);
  assert.equal(Number(earn.json.totals.gross), 48);
  assert.equal(Number(earn.json.totals.commission), 9.6);
  assert.equal(Number(earn.json.totals.net), 38.4);
  assert.equal(Number(earn.json.totals.accrued_net), 38.4);

  // אין צבירה כפולה על אותה נקודה (UNIQUE courier+order+kind)
  const again = await api(`/api/courier/earnings`, { token: platformCourier });
  assert.equal(again.json.rows.filter(r => r.kind === 'pickup').length, 2);

  // תשלום דמו שבועי
  const payout = await api('/api/courier/earnings/payout', { method: 'POST', token: platformCourier, body: {} });
  assert.equal(payout.status, 200);
  assert.equal(payout.json.paid, 4);
  assert.equal(payout.json.demo, true);
  earn = await api('/api/courier/earnings', { token: platformCourier });
  assert.equal(Number(earn.json.totals.accrued_net), 0);
  assert.equal(Number(earn.json.totals.paid_net), 38.4);
});

test('E5.T5: מסך ניהול שליחים למכבסה — ביצועים, עלות, תשלומים', async (t) => {
  const { api } = await startApp(t);
  const admin = await api.login('+972500000001');
  const customer = await api.login('+972500000002');
  const owner = await api.login('+972500000003');
  const platformCourier = await api.login('+972500000005');

  const ov0 = await api('/api/t/achuza/couriers/overview', { token: owner });
  assert.equal(ov0.status, 200, JSON.stringify(ov0.json));
  assert.ok(ov0.json.estimate.rate_per_stop > 0);
  assert.equal(ov0.json.estimate.per_order, ov0.json.estimate.rate_per_stop * ov0.json.estimate.stops_per_order);
  assert.ok(ov0.json.couriers.find(c => c.model === 'platform'));
  assert.ok(ov0.json.couriers.find(c => c.model === 'private'));

  // הרשאות: לקוח רגיל לא ניגש
  const forbidden = await api('/api/t/achuza/couriers/overview', { token: customer });
  assert.equal(forbidden.status, 403);

  // זרימה מלאה: הזמנה → אישור → שיבוץ אוטומטי → איסוף+מסירה → תשלומים וביצועים
  const l = await api('/api/laundries/achuza');
  const item = l.json.items[0];
  const o = await api('/api/orders', { method: 'POST', token: customer, body: { slug: 'achuza', items: [{ item_id: item.id, qty: 1 }], address: 'רחוב הבדיקה 5, תל אביב' } });
  const oid = o.json.order.id;
  await api(`/api/t/achuza/orders/${oid}/status`, { method: 'POST', token: admin, body: { status: 'confirmed' } });
  await api('/api/admin/routes/auto-build', { method: 'POST', token: admin, body: {} });
  await api(`/api/courier/orders/${oid}/mark`, { method: 'POST', token: platformCourier, body: { action: 'picked_up' } });
  await api(`/api/t/achuza/orders/${oid}/status`, { method: 'POST', token: admin, body: { status: 'in_work' } });
  await api(`/api/t/achuza/orders/${oid}/status`, { method: 'POST', token: admin, body: { status: 'ready' } });
  await api(`/api/courier/orders/${oid}/mark`, { method: 'POST', token: platformCourier, body: { action: 'out_for_delivery' } });
  await api(`/api/courier/orders/${oid}/mark`, { method: 'POST', token: platformCourier, body: { action: 'delivered', cash: { outcome: 'collected' } } });

  const ov = await api('/api/t/achuza/couriers/overview', { token: owner });
  const pc = ov.json.couriers.find(c => c.model === 'platform');
  assert.ok(pc.delivered_30d >= 1, 'delivered_30d counted');
  assert.ok(ov.json.payments.length >= 1, 'payment history exists');
  const wk = ov.json.payments[0];
  assert.ok(Number(wk.gross) >= 24, 'gross includes pickup+delivery'); // 2 נקודות × ₪12
  assert.ok(Number(wk.commission) > 0);
});
