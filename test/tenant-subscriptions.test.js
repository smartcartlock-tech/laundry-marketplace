// E2.T4: ניהול תוכניות ומנויים בצד מכבסה + הכנסה חוזרת בדוחות.
const { test } = require('node:test');
const assert = require('node:assert');
const { startApp } = require('./helpers');

test('tenant subscription management: plan CRUD, subscribers, MRR', async (t) => {
  const { api } = await startApp(t);
  const owner = await api.login('+972500000003', 'בעל מכבסה לדמו');
  const cust = await api.login('+972500000002', 'לקוחה לדמו');

  // יצירת תוכנית
  const bad = await api('/api/t/achuza/plans', { method: 'POST', token: owner, body: { name: 'x' } });
  assert.equal(bad.status, 400);
  const create = await api('/api/t/achuza/plans', { method: 'POST', token: owner, body: {
    name: 'מנוי עסקי', bags_per_month: 20, kg_per_bag: 10, price: 599, extra_bag_price: 40, perks: 'עדיפות' } });
  assert.equal(create.status, 201, JSON.stringify(create.json));
  const plan = create.json.plan;
  assert.equal(Number(plan.extra_bag_price), 40);

  // הרשאות: לקוח רגיל לא מנהל תוכניות
  const forbid = await api('/api/t/achuza/plans', { method: 'POST', token: cust, body: { name: 'y', bags_per_month: 1, price: 1 } });
  assert.equal(forbid.status, 403);

  // PATCH active-toggle לא מוחק extra_bag_price
  const tog = await api(`/api/t/achuza/plans/${plan.id}`, { method: 'PATCH', token: owner, body: { active: false } });
  assert.equal(tog.status, 200);
  assert.equal(tog.json.plan.active, false);
  assert.equal(Number(tog.json.plan.extra_bag_price), 40, 'extra_bag_price preserved');
  await api(`/api/t/achuza/plans/${plan.id}`, { method: 'PATCH', token: owner, body: { active: true } });

  // התוכנית מופיעה ללקוח בדף המכבסה
  const pub = await api('/api/laundries/achuza');
  assert.ok(pub.json.plans.some(p => p.name === 'מנוי עסקי'), 'plan public');

  // לקוח מצטרף → מופיע ברשימת המנויים של המכבסה
  const join = await api('/api/subscriptions/join', { method: 'POST', token: cust, body: { slug: 'achuza', plan_id: plan.id } });
  assert.equal(join.status, 201);
  const subs = await api('/api/t/achuza/subscriptions', { token: owner });
  assert.equal(subs.status, 200);
  const row = subs.json.subscriptions.find(x => x.plan_name === 'מנוי עסקי');
  assert.ok(row && row.customer_phone === '+972500000002', 'subscriber listed');

  // MRR בדוחות
  const stats = await api('/api/t/achuza/stats', { token: owner });
  assert.equal(stats.status, 200);
  assert.ok(Number(stats.json.subscriptions.mrr) >= 599, 'mrr includes plan price');
  assert.ok(stats.json.subscriptions.active >= 1);

  // סימון פריט כמכוסה במנוי דרך PATCH
  const items = (await api('/api/t/achuza/items', { token: owner })).json.items;
  const shirt = items.find(i => i.name.includes('חולצה'));
  const mark = await api(`/api/t/achuza/items/${shirt.id}`, { method: 'PATCH', token: owner, body: { subscription_eligible: true } });
  assert.equal(mark.status, 200);
  assert.equal(mark.json.item.subscription_eligible, true);
});
