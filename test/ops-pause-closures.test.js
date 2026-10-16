// C1 + C3: השהיית הזמנות וימי סגירה — API, חסימת הזמנה, נקודה ציבורית
const { test } = require('node:test');
const assert = require('node:assert');
const { startApp } = require('./helpers');

test('ops: pause/resume, closures, חסימת הזמנה, ops-state ציבורי', async (t) => {
  const { api } = await startApp(t);
  const owner = await api.login('+972500000003');
  const customer = await api.login('+972500000002');

  const it = await api('/api/t/achuza/items', { method: 'POST', token: owner, body: { name: 'שק השהיה', price: 30, unit: 'bag', category: 'כביסה' } });
  assert.equal(it.status, 201);
  const mk = () => api('/api/orders', { method: 'POST', token: customer, body: { slug: 'achuza', items: [{ item_id: it.json.item.id, qty: 2 }], address: 'רחוב ההשהיה 3, תל אביב' } });

  // הרשאות לניהול
  assert.equal((await api('/api/t/achuza/ops/pause', { method: 'POST', token: customer, body: {} })).status, 403);

  // pause → הזמנה נחסמת עם הודעה ידידותית; resume → מותר שוב
  const p = await api('/api/t/achuza/ops/pause', { method: 'POST', token: owner, body: { minutes: 60 } });
  assert.equal(p.status, 200);
  assert.ok(p.json.paused_until);
  const blocked = await mk();
  assert.equal(blocked.status, 409);
  assert.match(blocked.json.error, /הפסקה זמנית/);
  const pub = await api('/api/public-ops/laundry/achuza/ops-state');
  assert.equal(pub.status, 200);
  assert.ok(pub.json.paused_until);
  assert.equal((await api('/api/t/achuza/ops/resume', { method: 'POST', token: owner, body: {} })).status, 200);
  assert.equal((await mk()).status, 201, 'אחרי חידוש אפשר להזמין');

  // closures: הוספה, הופיע בציבורי, חסימת pickup_at באותו יום, מחיקה
  const day = new Date(Date.now() + 3 * 864e5).toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
  assert.equal((await api('/api/t/achuza/ops/closures', { method: 'POST', token: owner, body: { day, note: 'חג' } })).status, 201);
  assert.equal((await api('/api/t/achuza/ops/closures', { method: 'POST', token: owner, body: { day: '31/12/2027' } })).status, 400);
  const pub2 = await api('/api/public-ops/laundry/achuza/ops-state');
  assert.ok(pub2.json.closures.some(c => c.day.startsWith(day)));
  const pickupAt = new Date(day + 'T09:30:00+03:00').toISOString();
  const blocked2 = await api('/api/orders', { method: 'POST', token: customer, body: { slug: 'achuza', items: [{ item_id: it.json.item.id, qty: 2 }], address: 'רחוב ההשהיה 3, תל אביב', pickup_at: pickupAt } });
  assert.equal(blocked2.status, 409);
  assert.match(blocked2.json.error, /סגורה ביום האיסוף/);
  assert.equal((await api(`/api/t/achuza/ops/closures/${day}`, { method: 'DELETE', token: owner })).status, 200);
  const pub3 = await api('/api/public-ops/laundry/achuza/ops-state');
  assert.ok(!pub3.json.closures.some(c => c.day.startsWith(day)));
});
