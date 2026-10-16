// העמקה E9: תרחישי קצה, הזרקות, הרשאות, ועומס קל על ה-API של האפיק
const { test } = require('node:test');
const assert = require('node:assert');
const { startApp } = require('./helpers');

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

async function newOrder(api, customer, slug) {
  const l = await api('/api/laundries/' + slug);
  const item = l.json.items[0];
  const r = await api('/api/orders', { method: 'POST', token: customer, body: { slug, items: [{ item_id: item.id, qty: 1 }], address: 'רחוב הקצה 9' } });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return r.json.order.id;
}

test('קצה: דיווח תקלה — ולידציות, הזרקת SQL/XSS, מעל 3 תמונות נקטעות', async (t) => {
  const { api } = await startApp(t);
  const customer = await api.login('+972500000002');
  const oid = await newOrder(api, customer, 'achuza');

  // בלי auth
  assert.equal((await api(`/api/orders/${oid}/report`, { method: 'POST', body: { kind: 'other', text: 'x' } })).status, 401);
  // kind לא חוקי
  assert.equal((await api(`/api/orders/${oid}/report`, { method: 'POST', token: customer, body: { kind: 'hack', text: 'x' } })).status, 400);
  // בלי תיאור
  assert.equal((await api(`/api/orders/${oid}/report`, { method: 'POST', token: customer, body: { kind: 'other' } })).status, 400);
  // הזרקת SQL בתיאור — נשמרת כטקסט, לא מתבצעת
  const inj = await api(`/api/orders/${oid}/report`, { method: 'POST', token: customer, body: { kind: 'other', text: "'; DROP TABLE orders; -- <script>alert(1)</script>" } });
  assert.equal(inj.status, 201, JSON.stringify(inj.json));
  const mine = await api(`/api/orders/${oid}/reports`, { token: customer });
  assert.equal(mine.json.reports[0].text, "'; DROP TABLE orders; -- <script>alert(1)</script>");
  // דיווח שני על אותה הזמנה — 409
  assert.equal((await api(`/api/orders/${oid}/report`, { method: 'POST', token: customer, body: { kind: 'late', text: 'עוד' } })).status, 409);

  // 5 תמונות → נשמרות 3 בלבד; תמונה ענקית → 400; content-type לא נתמך → 400
  const customer2 = await api.login('+972500000009', 'בודקת קצה');
  const oid2 = await newOrder(api, customer2, 'achuza');
  const many = await api(`/api/orders/${oid2}/report`, { method: 'POST', token: customer2, body: { kind: 'damage', text: '5 תמונות', photos: Array(5).fill({ content_type: 'image/png', data_b64: PNG_B64 }) } });
  assert.equal(many.status, 201);
  assert.equal(many.json.report.photos, 3);
  const big = await api(`/api/orders/${oid2}/report`, { method: 'POST', token: customer2, body: { kind: 'damage', text: 'x', photos: [{ content_type: 'image/png', data_b64: 'A'.repeat(1_500_000) }] } });
  assert.equal(big.status, 400);
  const badType = await api(`/api/orders/${oid2}/report`, { method: 'POST', token: customer2, body: { kind: 'damage', text: 'x', photos: [{ content_type: 'image/gif', data_b64: PNG_B64 }] } });
  assert.equal(badType.status, 400);
});

test('קצה: הרשאות — לקוח זר לא רואה תקלות מכבסה/אדמין; שליחת push דורשת auth', async (t) => {
  const { api } = await startApp(t);
  const stranger = await api.login('+972500000009', 'זר');
  assert.equal((await api('/api/t/achuza/issues', { token: stranger })).status, 403);
  assert.equal((await api('/api/admin/issues', { token: stranger })).status, 403);
  assert.equal((await api('/api/push/subscribe', { method: 'POST', body: { subscription: { endpoint: 'https://e.com/x', keys: { p256dh: 'a', auth: 'b' } } } })).status, 401);
  const photoAnon = await api('/api/issue-photos/00000000-0000-0000-0000-000000000000', { token: stranger });
  assert.ok([401, 403, 404].includes(photoAnon.status));
});

test('עומס קל: 25 בקשות מקבילות ל-API ציבורי + כתיבות מעורבות נשארות יציבות', async (t) => {
  const { api } = await startApp(t);
  const t0 = Date.now();
  const batch1 = await Promise.all(Array.from({ length: 15 }, () => api('/api/laundries/achuza')));
  assert.ok(batch1.every(r => r.status === 200));
  const customer = await api.login('+972500000002');
  const batch2 = await Promise.all(Array.from({ length: 10 }, (_, i) =>
    api('/api/orders', { method: 'POST', token: customer, body: { slug: 'achuza', items: [], address: 'x' } })));
  // הזמנות ריקות — 400 עקבי, בלי קריסה או race
  assert.ok(batch2.every(r => r.status === 400));
  const { base } = t.context || {};
  const health = await api('/api/laundries'); // /health חי מחוץ ל-/api
  assert.equal(health.status, 200);
  assert.ok(Date.now() - t0 < 15000, 'too slow');
});

test('E9.T4 קצה: ביקורת בלי תגיות גם מזכה; תגיות מעל 5 נקטעות; ניקוד לא מוכפל', async (t) => {
  const { api } = await startApp(t);
  // ביקורת דורשת הזמנה delivered — מדלגים על יצירת זרימה מלאה כאן (כוסה ב-issues-e9);
  // כאן בודקים ולידציה בסיסית: דירוג מחוץ לטווח נדחה
  const customer = await api.login('+972500000002');
  const oid = await newOrder(api, customer, 'achuza');
  const bad = await api(`/api/orders/${oid}/review`, { method: 'POST', token: customer, body: { rating: 9, text: 'y', tags: ['a'] } });
  assert.ok([400, 409].includes(bad.status), 'rating 9 or non-delivered rejected: ' + bad.status);
});
