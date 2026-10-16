// E2.T1: מנויים — הצטרפות, שדרוג, השהיה, ביטול, רישום ניצול, חידוש תקופה.
const { test } = require('node:test');
const assert = require('node:assert');
const { startApp } = require('./helpers');

test('subscriptions: plans, join, upgrade, pause/resume, cancel, usage ledger', async (t) => {
  const { api } = await startApp(t);
  const token = await api.login('+972500000002', 'לקוחה לדמו');

  // תוכניות פעילות של המכבסה
  const plansRes = await api('/api/subscriptions/plans/achuza', { token });
  assert.equal(plansRes.status, 200);
  assert.ok(plansRes.json.plans.length >= 2, 'seed plans exist');
  const [basic, family] = plansRes.json.plans;
  assert.equal(basic.name, 'מנוי בסיסי');

  // הצטרפות יוצרת מנוי פעיל
  const join = await api('/api/subscriptions/join', { method: 'POST', token, body: { slug: 'achuza', plan_id: basic.id } });
  assert.equal(join.status, 201, JSON.stringify(join.json));
  assert.equal(join.json.subscription.status, 'active');
  assert.equal(join.json.subscription.auto_renew, true);
  assert.equal(join.json.subscription.payment_status, 'paid_demo');
  const subId = join.json.subscription.id;

  // הצטרפות כפולה נדחית
  const dup = await api('/api/subscriptions/join', { method: 'POST', token, body: { slug: 'achuza', plan_id: basic.id } });
  assert.equal(dup.status, 409);

  // mine מציג יתרה מלאה
  let mine = await api('/api/subscriptions/mine', { token });
  assert.equal(mine.status, 200);
  assert.equal(mine.json.subscriptions.length, 1);
  assert.equal(mine.json.subscriptions[0].bags_remaining, 4);
  assert.equal(mine.json.subscriptions[0].plan_name, 'מנוי בסיסי');

  // שדרוג לתוכנית משפחתית
  const up = await api(`/api/subscriptions/${subId}/upgrade`, { method: 'POST', token, body: { plan_id: family.id } });
  assert.equal(up.status, 200);
  mine = await api('/api/subscriptions/mine', { token });
  assert.equal(mine.json.subscriptions[0].bags_remaining, 8);

  // השהיה וחידוש
  const pause = await api(`/api/subscriptions/${subId}/pause`, { method: 'POST', token });
  assert.equal(pause.json.subscription.status, 'paused');
  const upPaused = await api(`/api/subscriptions/${subId}/upgrade`, { method: 'POST', token, body: { plan_id: basic.id } });
  assert.equal(upPaused.status, 409, 'שדרוג מנוי מושהה נדחה');
  const resume = await api(`/api/subscriptions/${subId}/resume`, { method: 'POST', token });
  assert.equal(resume.json.subscription.status, 'active');

  // ביטול עוצר חידוש
  const cancel = await api(`/api/subscriptions/${subId}/cancel`, { method: 'POST', token });
  assert.equal(cancel.status, 200);
  assert.equal(cancel.json.subscription.status, 'cancelled');
  assert.equal(cancel.json.subscription.auto_renew, false);

  // הצטרפות מחדש אחרי ביטול
  const rejoin = await api('/api/subscriptions/join', { method: 'POST', token, body: { slug: 'achuza', plan_id: basic.id } });
  assert.equal(rejoin.status, 201);
  assert.equal(rejoin.json.subscription.status, 'active');

  // ניצול נרשם בלדג'
  const usage = await api(`/api/subscriptions/${subId}/usage`, { token });
  assert.equal(usage.status, 200);
  assert.ok(usage.json.usage.length >= 4, 'join/upgrade/pause/resume/cancel recorded');
  assert.ok(usage.json.usage.some(u => u.note.includes('ביטול')));

  // הרשאות: לקוח אחר לא רואה/משנה את המנוי
  const other = await api.login('+972500000099', 'אחר');
  const forbid = await api(`/api/subscriptions/${rejoin.json.subscription.id}/cancel`, { method: 'POST', token: other });
  assert.equal(forbid.status, 404);
});
