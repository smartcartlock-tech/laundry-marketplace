const { test } = require('node:test');
const assert = require('node:assert');
const { startApp } = require('./helpers');

// QA2.T8: יחידת 'שק' נתמכת מקצה לקצה (סכימה, API, סיד)
test('bag-unit: יצירה, עדכון יחידה וסיד עם שק', async (t) => {
  const { api } = await startApp(t);
  const owner = await api.login('+972500000003');

  const c = await api('/api/t/achuza/items', { method: 'POST', token: owner, body: { name: 'שק ג׳ינסים', price: 60, unit: 'bag', category: 'כביסה' } });
  assert.equal(c.status, 201, JSON.stringify(c.json));
  assert.equal(c.json.item.unit, 'bag');

  const bad = await api('/api/t/achuza/items', { method: 'POST', token: owner, body: { name: 'יחידה לא חוקית', price: 1, unit: 'ton' } });
  assert.equal(bad.json.item.unit, 'item', 'יחידה לא מוכרת נופלת ל-item');

  const p = await api(`/api/t/achuza/items/${bad.json.item.id}`, { method: 'PATCH', token: owner, body: { unit: 'kg' } });
  assert.equal(p.json.item.unit, 'kg', 'ניתן לתקן יחידה לפריט קיים');

  const l = await api('/api/laundries/achuza');
  assert.ok(l.json.items.some(i => i.unit === 'bag'), 'פריט שק מהסיד נחשף בדף המכבסה');
});
