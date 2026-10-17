// T11+T10: שירות ביטול משותף (אפליקציה/בוט — אותן החזרות) + התראת ביטול לבעלים עם קוד מעקב והחזרים
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp, TEST_DB } = require('./helpers');
const { Client } = require('pg');

async function dbRefund(schema, orderId) {
  const c = new Client({ connectionString: TEST_DB, options: `-c search_path=${schema}` });
  await c.connect();
  try {
    const { rows } = await c.query('SELECT delta, reason FROM points_ledger WHERE order_id=$1', [orderId]);
    return rows;
  } finally { await c.end(); }
}

async function newBagOrder(api, customer, extra = {}) {
  const page = await api('/api/laundries/achuza');
  const bag = page.json.items.find(i => i.name.includes('שק'));
  const created = await api('/api/orders', { method: 'POST', token: customer, body: { slug: 'achuza', items: [{ item_id: bag.id, qty: 1 }], address: 'הרצל 12', ...extra } });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  return created.json.order;
}

test('T11+T10: ביטול לקוח באפליקציה — החזר נקודות וקופון + הודעה לבעלים עם קוד מעקב והחזרים', async (t) => {
  const { api, schema } = await startApp(t);
  const customer = await api.login('+972500000002');
  const owner = await api.login('+972500000003');

  const coupon = await api('/api/t/achuza/coupons', { method: 'POST', token: owner, body: { code: 'CANCELTEST', kind: 'amount', value: 5 } });
  assert.equal(coupon.status, 201);

  const order = await newBagOrder(api, customer, { redeem_points: true, coupon_code: 'CANCELTEST' });
  assert.ok(Number(order.points_redeemed) > 0, 'points redeemed on order');
  assert.ok(order.tracking_code, 'tracking code exists');

  const cancel = await api(`/api/orders/${order.id}/cancel`, { method: 'POST', token: customer });
  assert.equal(cancel.status, 200, JSON.stringify(cancel.json));
  await new Promise(r => setTimeout(r, 1200));

  // החזר נקודות בפנקס
  const ledger = await dbRefund(schema, order.id);
  assert.ok(ledger.some(p => Number(p.delta) === Number(order.points_redeemed) && String(p.reason || '').includes('החזר נקודות')), 'points refund in ledger');

  // קופון שוחרר
  const coupons = await api('/api/t/achuza/coupons', { token: owner });
  const c = coupons.json.coupons.find(x => x.code === 'CANCELTEST');
  assert.equal(Number(c.used_count), 0, 'coupon released');

  // T10: הבעלים קיבל הודעת ביטול עם קוד המעקב ופירוט ההחזרים
  const msgs = await api('/api/messages', { token: owner });
  const m = msgs.json.messages.find(x => x.body.includes(order.tracking_code) && x.body.includes('בוטלה'));
  assert.ok(m, 'owner cancel message exists');
  assert.ok(m.body.includes('הוחזרו') && m.body.includes('הקופון שוחרר'), 'refund details in message');
});

test('T11: ביטול דרך הבוט — אותן החזרות כמו באפליקציה + התראה לבעלים', async (t) => {
  const { api, schema: schema2 } = await startApp(t);
  const customer = await api.login('+972500000002');
  const owner = await api.login('+972500000003');

  const order = await newBagOrder(api, customer, { redeem_points: true });
  assert.ok(Number(order.points_redeemed) > 0);

  const ask = await api('/api/bot-sim/chat', { method: 'POST', token: customer, body: { message: `בטל הזמנה ${order.tracking_code}` } });
  assert.ok(ask.json.reply.includes('אישור ביטול'), 'two-step confirm requested');
  const confirm = await api('/api/bot-sim/chat', { method: 'POST', token: customer, body: { message: `אישור ביטול ${order.tracking_code}` } });
  assert.ok(confirm.json.reply.includes('בוטלה'), JSON.stringify(confirm.json));
  assert.ok(confirm.json.reply.includes('הוחזרו'), 'refund summary in bot reply');
  await new Promise(r => setTimeout(r, 1200));

  const ledger2 = await dbRefund(schema2, order.id);
  assert.ok(ledger2.some(p => Number(p.delta) === Number(order.points_redeemed) && String(p.reason || '').includes('החזר נקודות')), 'bot path refunds points too');

  const msgs = await api('/api/messages', { token: owner });
  assert.ok(msgs.json.messages.some(x => x.body.includes(order.tracking_code) && x.body.includes('בוטלה')), 'owner notified on bot cancel');

  const check = await api(`/api/orders/${order.id}`, { token: customer });
  assert.equal(check.json.order.status, 'cancelled');
});

test('T11 המשך: ביטול בעלים דרך סטטוס — אותן החזרות דרך השירות המשותף', async (t) => {
  const { api, schema } = await startApp(t);
  const customer = await api.login('+972500000002');
  const owner = await api.login('+972500000003');

  const coupon = await api('/api/t/achuza/coupons', { method: 'POST', token: owner, body: { code: 'OWNERCANCEL', kind: 'amount', value: 5 } });
  assert.equal(coupon.status, 201);
  const order = await newBagOrder(api, customer, { redeem_points: true, coupon_code: 'OWNERCANCEL' });
  assert.ok(Number(order.points_redeemed) > 0);

  const cancel = await api(`/api/t/achuza/orders/${order.id}/status`, { method: 'POST', token: owner, body: { status: 'cancelled' } });
  assert.equal(cancel.status, 200, JSON.stringify(cancel.json));

  const ledger = await dbRefund(schema, order.id);
  assert.ok(ledger.some(p => Number(p.delta) === Number(order.points_redeemed)), 'owner cancel refunds points');
  const coupons = await api('/api/t/achuza/coupons', { token: owner });
  assert.equal(Number(coupons.json.coupons.find(x => x.code === 'OWNERCANCEL').used_count), 0, 'owner cancel releases coupon');
});

test('T24: אישור ביטול בכתב ללקוח — באפליקציה ובבוט', async (t) => {
  const { api } = await startApp(t);
  const customer = await api.login('+972500000002');

  const o1 = await newBagOrder(api, customer, { redeem_points: true });
  await api(`/api/orders/${o1.id}/cancel`, { method: 'POST', token: customer });
  await new Promise(r => setTimeout(r, 1200));
  let msgs = await api('/api/messages', { token: customer });
  const m1 = msgs.json.messages.find(x => x.body.includes(o1.tracking_code) && x.body.includes('ביטלת'));
  assert.ok(m1, 'written cancel confirmation for app cancel');
  assert.ok(m1.body.includes('הוחזרו'), 'refund details in customer confirmation');

  const o2 = await newBagOrder(api, customer, { redeem_points: true });
  await api('/api/bot-sim/chat', { method: 'POST', token: customer, body: { message: `בטל הזמנה ${o2.tracking_code}` } });
  await api('/api/bot-sim/chat', { method: 'POST', token: customer, body: { message: `אישור ביטול ${o2.tracking_code}` } });
  await new Promise(r => setTimeout(r, 1200));
  msgs = await api('/api/messages', { token: customer });
  assert.ok(msgs.json.messages.some(x => x.body.includes(o2.tracking_code) && x.body.includes('ביטלת')), 'written confirmation for bot cancel');
});
