// G3: עמוד נחיתה ממותג /b/:slug + G3b: מעקב הזמנה ציבורי לפי קוד.
const { test } = require('node:test');
const assert = require('node:assert');
const { startApp } = require('./helpers');

test('G3: עמוד נחיתה ממותג עם OG, שעות, מחירון וכפתור הזמנה', async (t) => {
  const { base } = await startApp(t);
  const res = await fetch(base + '/b/achuza');
  assert.equal(res.status, 200);
  const html = await res.text();
  for (const needle of [
    'מכבסת האחוזה', 'property="og:title"', 'property="og:url"',
    'שעות פעילות', 'מחירון', 'אזור ותנאי שירות',
    '/b/achuza/app', // כפתור ההזמנה מוביל לאפליקציית המותג
    '/api/laundries/achuza/card', // קישור לכרטיס QR
    'utm_source=share', // קישור שיתוף עם utm
    'סביבת דמו', // דמו בלבד
  ]) assert.ok(html.includes(needle), 'חסר בעמוד: ' + needle);
  // האפליקציה ממשיכה לעבוד ב-/b/:slug/app
  const app = await fetch(base + '/b/achuza/app');
  assert.equal(app.status, 200);
  assert.ok((await app.text()).includes('מכבסה בקליק'));
  // מכבסה שלא קיימת — נפילה ל-SPA (200 של index.html), לא שגיאה
  const missing = await fetch(base + '/b/no-such-laundry');
  assert.equal(missing.status, 200);
});

test('G3b: מעקב הזמנה ציבורי לפי קוד — בלי התחברות ובלי PII', async (t) => {
  const { api } = await startApp(t);
  const customer = await api.login('+972500000002');
  const page = await api('/api/laundries/achuza');
  const bag = page.json.items.find(i => i.name.includes('שק'));
  const mk = await api('/api/orders', { method: 'POST', token: customer,
    body: { slug: 'achuza', items: [{ item_id: bag.id, qty: 5 }], address: 'מעקב 1' } });
  assert.equal(mk.status, 201, JSON.stringify(mk.json));
  const oid = mk.json.order.id;

  // קוד המעקב נוצר אוטומטית ומוחזר ללקוח בפרטי ההזמנה
  const mine = await api('/api/orders/' + oid, { token: customer });
  const code = mine.json.order.tracking_code;
  assert.ok(/^[0-9A-F]{8}$/.test(code || ''), 'tracking_code בפורמט תקין, קיבלתי: ' + code);

  // ציבורי: בלי טוקן
  const pub = await api('/api/track/' + code);
  assert.equal(pub.status, 200, JSON.stringify(pub.json));
  assert.equal(pub.json.status, 'new');
  assert.equal(pub.json.laundry_name, 'מכבסת האחוזה');
  assert.ok(Array.isArray(pub.json.events) && pub.json.events.length >= 1);
  assert.ok(!('address' in pub.json) && !('phone' in pub.json) && !('customer_id' in pub.json), 'אין PII במעקב הציבורי');

  // קוד שגוי/לא קיים → 404, לא דליפת מידע
  assert.equal((await api('/api/track/00000000')).status, 404);
  assert.equal((await api('/api/track/bad-code')).status, 404);

  // עדכון סטטוס משתקף במעקב
  const owner = await api.login('+972500000003');
  await api('/api/t/achuza/orders/' + oid + '/status', { method: 'POST', token: owner, body: { status: 'confirmed' } });
  const pub2 = await api('/api/track/' + code);
  assert.equal(pub2.json.status, 'confirmed');
  await api('/api/orders/' + oid + '/cancel', { method: 'POST', token: customer });
});

test('deep-link guard: route ממתין ל-load כש-view מאוחר-טעינה חסר (vTrack race)', () => {
  const fs = require('fs'), path = require('path');
  const router = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'router.js'), 'utf8');
  assert.ok(router.includes('__routeWaitLoad'), 'guard קיים ב-router.js');
  assert.ok(router.match(/ReferenceError&&document\.readyState!=='complete'/), 'retry רק על ReferenceError לפני load');
  // track.js נטען אחרי router.js ב-index.html — הבאג המקורי
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.ok(html.indexOf('/js/router.js') < html.indexOf('/js/track.js'), 'סדר טעינה משוחזר');
});
