const { test } = require('node:test');
const assert = require('node:assert');
const { startApp } = require('./helpers');

async function makeOrder(api, token, slug, extra = {}) {
  const l = await api('/api/laundries/' + slug);
  const item = l.json.items[0];
  const r = await api('/api/orders', { method: 'POST', token, body: { slug, items: [{ item_id: item.id, qty: 1 }], address: 'רחוב הבדיקה 7, תל אביב', ...extra } });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return r.json.order.id;
}

test('E5.T6: קלאסטר, מסלול קבוע משבץ אוטומטית ביומו, הצטרפות/עזיבה', async (t) => {
  const { api } = await startApp(t);
  const admin = await api.login('+972500000001');
  const customer = await api.login('+972500000002');
  const owner = await api.login('+972500000003');

  // יצירת קלאסטר
  const cl = await api('/api/admin/clusters', { method: 'POST', token: admin, body: { name: 'מרכז תל אביב', area: 'תל אביב', mgmt_fee_monthly: 120 } });
  assert.equal(cl.status, 201, JSON.stringify(cl.json));
  const clid = cl.json.cluster.id;
  assert.equal(Number(cl.json.cluster.mgmt_fee_monthly), 120);

  // מסלול קבוע: שליח הפלטפורמה ביום הנוכחי
  const { rows: c } = await (async () => { const p = await api('/api/admin/couriers', { token: admin }); return { rows: p.json.couriers }; })();
  const platform = c.find(x => x.model === 'platform');
  const wd = new Date().getDay();
  const fr = await api(`/api/admin/clusters/${clid}/fixed-routes`, { method: 'POST', token: admin, body: { courier_id: platform.id, weekday: wd } });
  assert.equal(fr.status, 201, JSON.stringify(fr.json));

  // שתי מכבסות מצטרפות (אחוזה ע״י הבעלים, אקספרס ע״י אדמין)
  const j1 = await api(`/api/t/achuza/clusters/${clid}/join`, { method: 'POST', token: owner, body: {} });
  assert.equal(j1.status, 200);
  const j2 = await api(`/api/t/express/clusters/${clid}/join`, { method: 'POST', token: admin, body: {} });
  assert.equal(j2.status, 200);
  const list = await api('/api/t/achuza/clusters', { token: owner });
  const mine = list.json.clusters.find(x => x.id === clid);
  assert.equal(mine.joined, true);
  assert.equal(mine.members, 2);

  // הזמנות בשתי המכבסות → בנייה אוטומטית → מסלול קבוע לשליח הקבוע
  const o1 = await makeOrder(api, customer, 'achuza');
  const o2 = await makeOrder(api, customer, 'express');
  for (const [slug, oid] of [['achuza', o1], ['express', o2]]) {
    await api(`/api/t/${slug}/orders/${oid}/status`, { method: 'POST', token: admin, body: { status: 'confirmed' } });
  }
  const build = await api('/api/admin/routes/auto-build', { method: 'POST', token: admin, body: {} });
  assert.equal(build.status, 200, JSON.stringify(build.json));
  const fixed = build.json.routes.find(x => x.fixed);
  assert.ok(fixed, 'expected a fixed-route assignment');
  assert.equal(fixed.stops, 2);
  assert.equal(fixed.combined, true);

  // עזיבה
  const leave = await api(`/api/t/express/clusters/${clid}/leave`, { method: 'POST', token: admin, body: {} });
  assert.equal(leave.status, 200);
  const list2 = await api('/api/t/achuza/clusters', { token: owner });
  assert.equal(list2.json.clusters.find(x => x.id === clid).members, 1);
});

test('E5.T7: דירוג דו-כיווני — לקוח ומכבסה מדרגים שליח, שליח מדרג מכבסה, קדימות מושפעת', async (t) => {
  const { api } = await startApp(t);
  const admin = await api.login('+972500000001');
  const customer = await api.login('+972500000002');
  const owner = await api.login('+972500000003');
  const platformCourier = await api.login('+972500000005');

  const oid = await makeOrder(api, customer, 'achuza');
  await api(`/api/t/achuza/orders/${oid}/status`, { method: 'POST', token: admin, body: { status: 'confirmed' } });
  const build = await api('/api/admin/routes/auto-build', { method: 'POST', token: admin, body: {} });
  assert.equal(build.status, 200);
  const prof0 = await api('/api/courier/profile', { token: platformCourier });
  const courierId = prof0.json.courier.id;
  const pr0 = Number(prof0.json.courier.priority ?? 1);

  // עד delivered
  await api(`/api/courier/orders/${oid}/mark`, { method: 'POST', token: platformCourier, body: { action: 'picked_up' } });
  await api(`/api/t/achuza/orders/${oid}/status`, { method: 'POST', token: admin, body: { status: 'in_work' } });
  await api(`/api/t/achuza/orders/${oid}/status`, { method: 'POST', token: admin, body: { status: 'ready' } });
  await api(`/api/courier/orders/${oid}/mark`, { method: 'POST', token: platformCourier, body: { action: 'out_for_delivery' } });
  await api(`/api/courier/orders/${oid}/mark`, { method: 'POST', token: platformCourier, body: { action: 'delivered', cash: { outcome: 'collected' } } });

  // לקוח מדרג מכבסה + שליח
  const rv = await api(`/api/orders/${oid}/review`, { method: 'POST', token: customer, body: { rating: 5, text: 'מעולה', courier_rating: 5, courier_tags: ['בזמן', 'אדיב'] } });
  assert.equal(rv.status, 200, JSON.stringify(rv.json));
  let prof = await api('/api/courier/profile', { token: platformCourier });
  assert.equal(Number(prof.json.courier.rating), 5);
  assert.ok(Number(prof.json.courier.priority) > pr0, 'priority rose on high rating');

  // מכבסה מדרגת שליח נמוך → קדימות יורדת
  const before = Number(prof.json.courier.priority);
  const tr = await api(`/api/t/achuza/couriers/${courierId}/rate`, { method: 'POST', token: owner, body: { order_id: oid, rating: 2, tags: ['איחור'] } });
  assert.equal(tr.status, 200, JSON.stringify(tr.json));
  prof = await api('/api/courier/profile', { token: platformCourier });
  assert.equal(Number(prof.json.courier.rating), 3.5); // (5+2)/2
  assert.ok(Number(prof.json.courier.priority) < before, 'priority dropped on low rating');

  // דירוג כפול של אותה הזמנה נחסם
  const dup = await api(`/api/t/achuza/couriers/${courierId}/rate`, { method: 'POST', token: owner, body: { order_id: oid, rating: 4 } });
  assert.equal(dup.status, 409);

  // שליח מדרג מכבסה
  const rt = await api('/api/courier/rate-tenant', { method: 'POST', token: platformCourier, body: { order_id: oid, rating: 5, text: 'שקים מוכנים בזמן' } });
  assert.equal(rt.status, 200, JSON.stringify(rt.json));
  const rtDup = await api('/api/courier/rate-tenant', { method: 'POST', token: platformCourier, body: { order_id: oid, rating: 4 } });
  assert.equal(rtDup.status, 409);
});

test('E5.T8: דשבורד רשת שליחים — כיסוי, SLA, התראת איחור, מחלוקת', async (t) => {
  const { api } = await startApp(t);
  const admin = await api.login('+972500000001');
  const customer = await api.login('+972500000002');
  const platformCourier = await api.login('+972500000005');

  // הרשאות: לקוח לא ניגש
  const forbidden = await api('/api/admin/couriers/network', { token: customer });
  assert.equal(forbidden.status, 403);

  // הזמנה עם איסוף שכבר עבר בשעתיים+ ולא נאספה → התראת איחור
  const past = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
  const oid = await makeOrder(api, customer, 'achuza', { pickup_at: past });
  await api(`/api/t/achuza/orders/${oid}/status`, { method: 'POST', token: admin, body: { status: 'confirmed' } });

  // מחלוקת תשלום: זרימה מלאה קצרה על הזמנה נוספת
  const o2 = await makeOrder(api, customer, 'achuza');
  await api(`/api/t/achuza/orders/${o2}/status`, { method: 'POST', token: admin, body: { status: 'confirmed' } });
  await api('/api/admin/routes/auto-build', { method: 'POST', token: admin, body: {} });
  await api(`/api/courier/orders/${o2}/mark`, { method: 'POST', token: platformCourier, body: { action: 'picked_up' } });
  const earn = await api('/api/courier/earnings', { token: platformCourier });
  const rowId = earn.json.rows[0].id;
  await api(`/api/courier/earnings/${rowId}/dispute`, { method: 'POST', token: platformCourier, body: {} });

  const net = await api('/api/admin/couriers/network', { token: admin });
  assert.equal(net.status, 200, JSON.stringify(net.json));
  assert.ok(net.json.counts.active >= 2);
  assert.ok(net.json.coverage.find(x => x.area === 'תל אביב'));
  assert.ok(net.json.late_alerts.find(x => x.id === oid), 'late alert raised');
  assert.equal(net.json.disputes.length, 1);
  assert.ok(net.json.routes_30d.total >= 1);
  assert.ok(net.json.sla.on_time_pct !== undefined);

  // טיפול במחלוקת: אישור מחזיר לנצבר; דחייה מוחקת
  const res1 = await api(`/api/admin/earnings/${rowId}/resolve`, { method: 'POST', token: admin, body: { action: 'approve' } });
  assert.equal(res1.status, 200);
  const net2 = await api('/api/admin/couriers/network', { token: admin });
  assert.equal(net2.json.disputes.length, 0);
});
