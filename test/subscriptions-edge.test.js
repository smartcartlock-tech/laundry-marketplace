// E2 קצה: ביטול מנוי באמצע חודש (הטבות נשמרות עד סוף התקופה, חידוש נעצר), מכסה שנגמרה (שק חורג בתשלום)
const { test } = require('node:test');
const assert = require('node:assert');
const { Pool } = require('pg');
const { startApp, TEST_DB } = require('./helpers');

async function joinAndGetSub(api, customer, planName) {
  const plans = (await api('/api/subscriptions/plans/achuza', { token: customer })).json.plans;
  const plan = plans.find(p => p.name.includes(planName)) || plans[0];
  const j = await api('/api/subscriptions/join', { method: 'POST', token: customer, body: { slug: 'achuza', plan_id: plan.id } });
  assert.ok([200,201].includes(j.status), JSON.stringify(j.json));
  return j.json.subscription;
}

test('edge: cancel mid-month keeps benefits to period end, stops renewal; exhausted quota charges extra bag', async (t) => {
  const { api, schema } = await startApp(t);
  const customer = await api.login('+972500000002', 'לקוחה לדמו');
  const pool = new Pool({ connectionString: TEST_DB, options: `-c search_path=${schema},public` });
  t.after(() => pool.end());

  const sub = await joinAndGetSub(api, customer, 'משפחתי');
  assert.equal(sub.status, 'active');
  const bagItem = (await api('/api/laundries/achuza')).json.items.find(i => i.subscription_eligible) ||
                    (await api('/api/laundries/achuza')).json.items.find(i => i.unit === 'bag');
  assert.ok(bagItem, 'bag item exists');

  // שימוש ראשון — שק אחד
  const o1 = await api('/api/orders', { method: 'POST', token: customer, body: {
    slug: 'achuza', items: [{ item_id: bagItem.id, qty: 1 }], address: 'הרצל 1', use_subscription: true } });
  assert.equal(o1.status, 201, JSON.stringify(o1.json));

  // ביטול באמצע החודש — עוצר חידוש
  const cancel = await api(`/api/subscriptions/${sub.id}/cancel`, { method: 'POST', token: customer });
  assert.equal(cancel.status, 200, JSON.stringify(cancel.json));
  assert.equal(cancel.json.subscription.status, 'cancelled');
  assert.equal(cancel.json.subscription.auto_renew, false);

  // ההטבות נשמרות עד סוף התקופה — עדיין אפשר להזמין במנוי
  const o2 = await api('/api/orders', { method: 'POST', token: customer, body: {
    slug: 'achuza', items: [{ item_id: bagItem.id, qty: 1 }], address: 'הרצל 1', use_subscription: true } });
  assert.equal(o2.status, 201, JSON.stringify(o2.json));
  const covered = o2.json.order && (await api(`/api/orders/${o2.json.order.id}`, { token: customer })).json;
  assert.equal(Number(o2.json.order.subtotal), 0, 'שק מכוסה אחרי ביטול בתוך התקופה');

  // אחרי סוף התקופה — אין חידוש ואין שימוש
  await pool.query(`UPDATE subscriptions SET period_end=CURRENT_DATE - 1 WHERE id=$1`, [sub.id]);
  const o3 = await api('/api/orders', { method: 'POST', token: customer, body: {
    slug: 'achuza', items: [{ item_id: bagItem.id, qty: 1 }], address: 'הרצל 1', use_subscription: true } });
  assert.equal(o3.status, 409, 'אחרי סוף התקופה המנוי המבוטל לא שמיש');
});

test('edge: quota exhaustion — extra bag charged at extra_bag_price, then 409', async (t) => {
  const { api } = await startApp(t);
  const owner = await api.login('+972500000003', 'בעל מכבסה');
  const customer = await api.login('+972500000002', 'לקוחה לדמו');

  // תוכנית זעירה: שק אחד בחודש, שק חורג ₪45
  const plan = (await api('/api/t/achuza/plans', { method: 'POST', token: owner, body: {
    name: 'מנוי בודק קצה', bags_per_month: 1, kg_per_bag: 8, price: 50, extra_bag_price: 45 } })).json.plan;
  assert.ok(plan && plan.id, 'plan created');
  const jres = await api('/api/subscriptions/join', { method: 'POST', token: customer, body: { slug: 'achuza', plan_id: plan.id } });
  assert.ok([200,201].includes(jres.status), JSON.stringify(jres.json));

  const laundry = (await api('/api/laundries/achuza')).json;
  const bagItem = laundry.items.find(i => i.subscription_eligible && i.unit === 'bag') || laundry.items.find(i => i.unit === 'bag');

  // הזמנה של 2 שקים: אחד מכוסה, אחד חורג ב-₪45
  const o1 = await api('/api/orders', { method: 'POST', token: customer, body: {
    slug: 'achuza', items: [{ item_id: bagItem.id, qty: 2 }], address: 'הרצל 1', use_subscription: true } });
  if (o1.status !== 201) console.log('O1 FAIL', JSON.stringify(o1.json));
  assert.equal(o1.status, 201, JSON.stringify(o1.json));
  assert.equal(Number(o1.json.order.subtotal), 45, 'שק חורג בלבד מחויב');

  // המכסה נגמרה — הזמנה נוספת במנוי נדחית
  const o2 = await api('/api/orders', { method: 'POST', token: customer, body: {
    slug: 'achuza', items: [{ item_id: bagItem.id, qty: 1 }], address: 'הרצל 1', use_subscription: true } });
  assert.equal(o2.status, 409);
  assert.match(o2.json.error, /מכסת/);
});
