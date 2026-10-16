// E2.T2: הזמנה במנוי — ניכוי מכסה, חריגה מתומחרת, סימון, שחזור בביטול.
const { test } = require('node:test');
const assert = require('node:assert');
const { startApp } = require('./helpers');

test('subscription orders: quota deduction, overage charge, cancel restores', async (t) => {
  const { api } = await startApp(t);
  const token = await api.login('+972500000002', 'לקוחה לדמו');
  const owner = await api.login('+972500000003', 'בעל מכבסה לדמו');

  const plans = (await api('/api/subscriptions/plans/achuza', { token })).json.plans;
  const family = plans.find(p => p.name === 'מנוי משפחתי'); // 8 שקים, שק חורג ₪45
  const join = await api('/api/subscriptions/join', { method: 'POST', token, body: { slug: 'achuza', plan_id: family.id } });
  assert.equal(join.status, 201);

  const laundry = (await api('/api/laundries/achuza')).json;
  const bag = laundry.items.find(i => i.name.startsWith('שק כביסה')); // ₪56, eligible
  const shirt = laundry.items.find(i => i.name.includes('חולצה'));   // ₪8, not eligible
  assert.ok(bag.subscription_eligible === true || bag.subscription_eligible === undefined, 'bag item visible');

  // הזמנת מנוי: 2 שקים מכוסים + חולצה רגילה. דמי משלוח מתאפסים במנוי.
  let res = await api('/api/orders', { method: 'POST', token, body: {
    slug: 'achuza', address: 'הרצל 1, תל אביב', use_subscription: true,
    items: [{ item_id: bag.id, qty: 2 }, { item_id: shirt.id, qty: 1 }] } });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  let o = res.json.order;
  assert.equal(Number(o.subtotal), 8, 'covered bags priced 0, shirt charged');
  assert.equal(Number(o.delivery_fee), 0, 'free pickup in subscription');
  assert.equal(Number(o.total), 8);
  assert.ok(o.subscription_id, 'order marked with subscription');

  const detail = await api(`/api/orders/${o.id}`, { token });
  const covered = detail.json.items.find(i => i.name.includes('(מנוי)'));
  assert.ok(covered && Number(covered.price) === 0 && Number(covered.qty) === 2, 'covered line marked: ' + JSON.stringify(detail.json.items));

  let mine = (await api('/api/subscriptions/mine', { token })).json.subscriptions[0];
  assert.equal(Number(mine.bags_used), 2);
  assert.equal(mine.bags_remaining, 6);

  // חריגה: 7 שקים כשבמכסה 6 — 6 מכוסים, 1 חורג ב־₪45 (מחיר שק חורג בתוכנית)
  res = await api('/api/orders', { method: 'POST', token, body: {
    slug: 'achuza', address: 'הרצל 1, תל אביב', use_subscription: true,
    items: [{ item_id: bag.id, qty: 7 }] } });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  o = res.json.order;
  assert.equal(Number(o.subtotal), 45, 'one over bag at extra_bag_price');
  mine = (await api('/api/subscriptions/mine', { token })).json.subscriptions[0];
  assert.equal(mine.bags_remaining, 0);

  // מכסה מוצתה — הזמנה נוספת במנוי נדחית
  res = await api('/api/orders', { method: 'POST', token, body: {
    slug: 'achuza', address: 'הרצל 1, תל אביב', use_subscription: true,
    items: [{ item_id: bag.id, qty: 1 }] } });
  assert.equal(res.status, 409);

  // ביטול הזמנת המנוי הראשונה משחזר 2 שקים למכסה
  const orders = (await api('/api/orders/mine', { token })).json.orders;
  const first = orders.find(x => x.subscription_id && Number(x.subtotal) === 8);
  const cancel = await api(`/api/orders/${first.id}/cancel`, { method: 'POST', token });
  assert.equal(cancel.status, 200);
  mine = (await api('/api/subscriptions/mine', { token })).json.subscriptions[0];
  assert.equal(mine.bags_remaining, 2, 'quota restored after cancel');

  // פריט ק״ג מכוסה: בעל המכבסה מוסיף פריט ק״ג eligible
  const kgItem = await api('/api/t/achuza/items', { method: 'POST', token: owner, body: {
    name: 'כביסה במשקל (מנוי)', price: 20, unit: 'kg', subscription_eligible: true } });
  assert.equal(kgItem.status, 201, JSON.stringify(kgItem.json));
  // 10 ק״ג כשבמכסה 2 שקים × 8 ק״ג — הכל מכוסה, ניצול 1.3 שקים (מעוגל)
  res = await api('/api/orders', { method: 'POST', token, body: {
    slug: 'achuza', address: 'הרצל 1, תל אביב', use_subscription: true,
    items: [{ item_id: kgItem.json.item.id, qty: 10 }] } });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  assert.equal(Number(res.json.order.subtotal), 0, 'kg within quota covered');
  mine = (await api('/api/subscriptions/mine', { token })).json.subscriptions[0];
  assert.ok(Math.abs(mine.bags_remaining - 0.7) < 0.01, 'fractional kg usage: ' + mine.bags_remaining);

  // חריגת ק״ג: 20 ק״ג — 5.6 ק״ג מכוסים (0.7 שק × 8), השאר ב־₪20/ק״ג
  res = await api('/api/orders', { method: 'POST', token, body: {
    slug: 'achuza', address: 'הרצל 1, תל אביב', use_subscription: true,
    items: [{ item_id: kgItem.json.item.id, qty: 20 }] } });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  const charged = Math.round((20 - 5.6) * 20);
  assert.equal(Number(res.json.order.subtotal), charged, 'kg overage charged: ' + res.json.order.subtotal);

  // ללא מנוי פעיל — נדחה
  const noSub = await api.login('+972500000099', 'אחר');
  res = await api('/api/orders', { method: 'POST', token: noSub, body: {
    slug: 'achuza', address: 'הרצל 1', use_subscription: true, items: [{ item_id: bag.id, qty: 1 }] } });
  assert.equal(res.status, 409);
});
