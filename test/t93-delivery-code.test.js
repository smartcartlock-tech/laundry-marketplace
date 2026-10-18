// T93: קוד מסירה חד-פעמי אצל הלקוח — במעקב ובהודעה, לא גלוי לשליח מראש; מסלול 4-ספרות מבוטל.
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

test('T93: קוד מסירה 6 ספרות — חשיפה ללקוח בלבד, אימות מול קוד לקוח, ביטול מסלול 4 ספרות', async (t) => {
  const { api } = await startApp(t);
  const admin = await api.login('+972500000001');
  const customer = await api.login('+972500000002');
  const courier = await api.login('+972500000005');

  const oid = await makeOrder(api, customer, 'achuza');

  // הלקוח רואה את הקוד בפרטי ההזמנה ובמעקב הציבורי
  const oc = await api('/api/orders/' + oid, { token: customer });
  assert.equal(oc.status, 200);
  assert.match(oc.json.order.delivery_code, /^\d{6}$/, 'קוד 6 ספרות');
  const code = oc.json.order.delivery_code;
  const tr = await api('/api/track/' + oc.json.order.tracking_code);
  assert.equal(tr.status, 200, JSON.stringify(tr.json));
  assert.equal(tr.json.delivery_code, code, 'הקוד נחשף בדף המעקב של הלקוח');

  // שיבוץ שליח + קידום ל-out_for_delivery
  assert.equal((await api('/api/t/achuza/orders/' + oid + '/status', { method: 'POST', token: admin, body: { status: 'confirmed' } })).status, 200);
  assert.equal((await api('/api/admin/routes/auto-build', { method: 'POST', token: admin, body: {} })).status, 200);
  await api(`/api/courier/orders/${oid}/mark`, { method: 'POST', token: courier, body: { action: 'picked_up' } });
  await api(`/api/t/achuza/orders/${oid}/status`, { method: 'POST', token: admin, body: { status: 'in_work' } });
  await api(`/api/t/achuza/orders/${oid}/status`, { method: 'POST', token: admin, body: { status: 'ready' } });
  await api(`/api/courier/orders/${oid}/mark`, { method: 'POST', token: courier, body: { action: 'out_for_delivery' } });

  // השליח לא רואה את הקוד מראש — לא בפרטי ההזמנה ולא במשימות
  const oq = await api('/api/orders/' + oid, { token: courier });
  assert.equal(oq.status, 200);
  assert.equal(oq.json.order.delivery_code, undefined, 'הקוד לא נחשף לשליח בפרטי הזמנה');
  const tasks = await api('/api/courier/tasks', { token: courier });
  assert.ok(!JSON.stringify(tasks.json).includes(code), 'הקוד לא נחשף במשימות השליח');

  // אימות מול קוד לקוח: שגוי נדחה, 4 ספרות טלפון נדחות, הקוד הנכון מאשר
  const wrong = await api(`/api/courier/orders/${oid}/confirm-delivery`, { method: 'POST', token: courier, body: { method: 'code', code: '999999' } });
  assert.equal(wrong.status, 400);
  const last4 = await api(`/api/courier/orders/${oid}/confirm-delivery`, { method: 'POST', token: courier, body: { method: 'code', code: '0002' } });
  assert.equal(last4.status, 400, 'מסלול 4 ספרות בוטל');
  const okRes = await api(`/api/courier/orders/${oid}/confirm-delivery`, { method: 'POST', token: courier, body: { method: 'code', code } });
  assert.equal(okRes.status, 200, JSON.stringify(okRes.json));
});
