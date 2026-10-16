const { test } = require('node:test');
const assert = require('node:assert');
const { startApp } = require('./helpers');

test('tenant: ניהול מחירון, חלונות, הגדרות, סטטיסטיקה', async (t) => {
  const { api } = await startApp(t);
  const owner = await api.login('+972500000003');

  // יצירת פריט
  const add = await api('/api/t/achuza/items', { method: 'POST', token: owner, body: { name: 'מגבת — כביסה', price: 5, category: 'כביסה' } });
  assert.equal(add.status, 201);
  const itemId = add.json.item.id;

  // עדכון מחיר
  const upd = await api('/api/t/achuza/items/' + itemId, { method: 'PATCH', token: owner, body: { price: 6 } });
  assert.equal(upd.status, 200);
  assert.equal(Number(upd.json.item.price), 6);

  // פריט ללא מחיר נדחה
  const bad = await api('/api/t/achuza/items', { method: 'POST', token: owner, body: { name: 'x' } });
  assert.equal(bad.status, 400);

  // מחיקה (רכה)
  const del = await api('/api/t/achuza/items/' + itemId, { method: 'DELETE', token: owner });
  assert.equal(del.status, 200);
  const list = await api('/api/t/achuza/items', { token: owner });
  assert.ok(!list.json.items.find(i => i.id === itemId && i.active));

  // חלונות
  const win = await api('/api/t/achuza/windows', { method: 'POST', token: owner, body: { weekday: 1, start_time: '20:00', end_time: '22:00', capacity: 3, kind: 'pickup' } });
  assert.equal(win.status, 201);
  const winDel = await api('/api/t/achuza/windows/' + win.json.window.id, { method: 'DELETE', token: owner });
  assert.equal(winDel.status, 200);

  // הגדרות: דמי משלוח ומינימום
  const set = await api('/api/t/achuza/settings', { method: 'PATCH', token: owner, body: { delivery_fee: 20, min_order: 55 } });
  assert.equal(set.status, 200);
  assert.equal(Number(set.json.tenant.delivery_fee), 20);
  assert.equal(set.json.tenant.api_key, undefined, 'api_key לא חושף');
  // שחזור
  await api('/api/t/achuza/settings', { method: 'PATCH', token: owner, body: { delivery_fee: 15, min_order: 50 } });

  // סטטיסטיקה
  const stats = await api('/api/t/achuza/stats', { token: owner });
  assert.equal(stats.status, 200);
  assert.ok(stats.json.revenue);
  assert.ok(Array.isArray(stats.json.byStatus));
});
