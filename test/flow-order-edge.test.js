// QA זרימת הזמנה: מקרי קצה, ביטולים ותחרות. בדיקות עם todo = ליקוי מאומת שטרם תוקן
// (הן לא מכשילות את הסוויטה; כשהליקוי יתוקן יש להסיר את todo).
const { test } = require('node:test');
const assert = require('node:assert');
const { startApp } = require('./helpers');

async function setup(t) {
  const { api } = await startApp(t);
  const customer = await api.login('+972500000002');
  const owner = await api.login('+972500000003');
  const courierUser = await api.login('+972500000004');
  const page = await api('/api/laundries/achuza');
  const bag = page.json.items.find(i => i.name.includes('שק'));
  const couriers = await api('/api/t/achuza/couriers', { token: owner });
  const priv = couriers.json.couriers.find(c => c.model === 'private');
  const mk = (body = {}, token = customer) => api('/api/orders', { method: 'POST', token,
    body: { slug: 'achuza', items: [{ item_id: bag.id, qty: 1 }], address: 'בדיקה 1', ...body } });
  const st = (id, status) => api('/api/t/achuza/orders/' + id + '/status', { method: 'POST', token: owner, body: { status } });
  const mark = (id, action) => api('/api/courier/orders/' + id + '/mark', { method: 'POST', token: courierUser, body: { action } });
  const assign = (id) => api('/api/t/achuza/orders/' + id + '/assign', { method: 'POST', token: owner, body: { courier_id: priv.id } });
  const bal = async () => (await api('/api/orders/club/summary', { token: customer })).json.balances.find(b => b.slug === 'achuza')?.balance ?? 0;
  return { api, customer, owner, courierUser, bag, priv, mk, st, mark, assign, bal };
}

test('flow-edge: ביטול לקוח מחזיר נקודות שמומשו', async (t) => {
  const s = await setup(t);
  const b0 = await s.bal();
  const o = await s.mk({ redeem_points: true });
  assert.equal(o.status, 201);
  assert.ok(Number(o.json.order.points_redeemed) > 0);
  const c = await s.api('/api/orders/' + o.json.order.id + '/cancel', { method: 'POST', token: s.customer });
  assert.equal(c.status, 200);
  assert.equal(await s.bal(), b0);
});

test('flow-edge: מכבסה לא יכולה לבטל הזמנה שנמסרה / כבר בוטלה', async (t) => {
  const s = await setup(t);
  const o = (await s.mk()).json.order;
  await s.st(o.id, 'confirmed'); await s.assign(o.id);
  await s.mark(o.id, 'picked_up');
  for (const x of ['in_work', 'ready']) await s.st(o.id, x);
  await s.mark(o.id, 'out_for_delivery'); await s.mark(o.id, 'delivered');
  const r = await s.st(o.id, 'cancelled');
  assert.equal(r.status, 409, 'ביטול הזמנה שנמסרה צריך להידחות');
});

test('flow-edge: ביטול כפול אינו מחזיר מכסת מנוי פעמיים', async (t) => {
  const s = await setup(t);
  const o = (await s.mk()).json.order;
  const r1 = await s.st(o.id, 'cancelled');
  const r2 = await s.st(o.id, 'cancelled');
  assert.equal(r1.status, 200);
  assert.equal(r2.status, 409, 'ביטול חוזר של הזמנה מבוטלת צריך להידחות');
});

test('flow-edge: שיבוץ שליח להזמנה מבוטלת נדחה', async (t) => {
  const s = await setup(t);
  const o = (await s.mk()).json.order;
  await s.st(o.id, 'cancelled');
  const r = await s.assign(o.id);
  assert.equal(r.status, 409);
});

test('flow-edge: שליח לא מדלג על out_for_delivery', async (t) => {
  const s = await setup(t);
  const o = (await s.mk()).json.order;
  await s.st(o.id, 'confirmed'); await s.assign(o.id);
  await s.mark(o.id, 'picked_up');
  for (const x of ['in_work', 'ready']) await s.st(o.id, x);
  const r = await s.mark(o.id, 'delivered');
  assert.equal(r.status, 409);
});

test('race: סימון delivered כפול במקביל לא מזכה נקודות פעמיים', async (t) => {
  const s = await setup(t);
  const o = (await s.mk()).json.order;
  await s.st(o.id, 'confirmed'); await s.assign(o.id);
  await s.mark(o.id, 'picked_up');
  for (const x of ['in_work', 'ready']) await s.st(o.id, x);
  await s.mark(o.id, 'out_for_delivery');
  const b0 = await s.bal();
  const rs = await Promise.all([1, 2, 3, 4, 5].map(() => s.mark(o.id, 'delivered')));
  assert.equal(rs.filter(r => r.status === 200).length, 1, JSON.stringify(rs.map(r => r.status)));
  assert.equal(await s.bal(), b0 + Number(o.points_earned));
});

test('race: מימוש נקודות במקביל לא חורג מהיתרה', async (t) => {
  const s = await setup(t);
  const b0 = await s.bal();
  const rs = await Promise.all([1, 2, 3, 4, 5, 6].map(() => s.mk({ items: [{ item_id: s.bag.id, qty: 5 }], redeem_points: true })));
  const redeemed = rs.filter(r => r.status === 201).reduce((a, r) => a + Number(r.json.order.points_redeemed), 0);
  assert.ok(redeemed <= b0, `מומשו ${redeemed} מתוך יתרה ${b0}`);
});

test('race: קופון עם usage_limit=1 לא נוצל פעמיים במקביל', async (t) => {
  const s = await setup(t);
  const mk = await s.api('/api/t/achuza/coupons', { method: 'POST', token: s.owner,
    body: { code: 'RACE1', kind: 'amount', value: 5, usage_limit: 1 } });
  assert.equal(mk.status, 201, JSON.stringify(mk.json));
  const rs = await Promise.all([1, 2, 3, 4, 5].map(() => s.mk({ coupon_code: 'RACE1' })));
  assert.equal(rs.filter(r => r.status === 201).length, 1, JSON.stringify(rs.map(r => r.status)));
});

test('race: ביקורת כפולה במקביל לא מזכה בונוס כפול', async (t) => {
  const s = await setup(t);
  const o = (await s.mk()).json.order;
  await s.st(o.id, 'confirmed'); await s.assign(o.id);
  await s.mark(o.id, 'picked_up');
  for (const x of ['in_work', 'ready']) await s.st(o.id, x);
  await s.mark(o.id, 'out_for_delivery'); await s.mark(o.id, 'delivered');
  const b0 = await s.bal();
  const rs = await Promise.all([1, 2, 3, 4].map(() => s.api('/api/orders/' + o.id + '/review', { method: 'POST', token: s.customer, body: { rating: 5 } })));
  assert.equal(rs.filter(r => r.status === 200).length, 1, JSON.stringify(rs.map(r => r.status)));
  assert.equal(await s.bal(), b0 + 20);
});

test('race: ביטול לקוח מול איסוף שליח - לא מצב מבוטל אחרי איסוף', async (t) => {
  const s = await setup(t);
  for (let i = 0; i < 6; i++) {
    const o = (await s.mk()).json.order;
    await s.st(o.id, 'confirmed'); await s.assign(o.id);
    const [c, m] = await Promise.all([
      s.api('/api/orders/' + o.id + '/cancel', { method: 'POST', token: s.customer }),
      s.mark(o.id, 'picked_up')]);
    // לפחות אחד נדחה; אסור ששניהם יצליחו
    assert.ok(!(c.status === 200 && m.status === 200), `iter ${i}: שניהם הצליחו`);
  }
});
