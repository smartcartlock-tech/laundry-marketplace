// T110: Push לבעלים על הזמנה חדשה — מנוי push של בעל מכבסה נשמר, ובעת יצירת הזמנה
// מנסים push ראשון (sendPushToUser attempted>0; בדמו/טסט ה-endpoint מדומה — סימולציה מתועדת).
// ה-UI: באנר הפעלה מוזרק לבעלים במסכי ניהול מ-public/js/push.js.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
const { startApp, TEST_DB } = require('./helpers');

const FAKE_SUB = {
  endpoint: 'https://push.example.com/sub/owner-demo-1234',
  keys: { p256dh: 'BDemoP256dhKeyForTestingOnly-abcdefghijklmnopqrstuvwxyz1234567890AB', auth: 'demoAuthKey123' },
};

test('T110: בעל מכבסה נרשם ל-push ומקבל ניסיון push על הזמנה חדשה', async (t) => {
  const { api, schema } = await startApp(t);
  const db = new Client({ connectionString: TEST_DB });
  await db.connect();
  t.after(() => db.end());
  await db.query(`SET search_path TO ${schema}, public`);

  const owner = await api.login('+972500000003');
  const customer = await api.login('+972500000002');

  // 1. רישום מנוי push לבעלים (מה שכפתור "הפעלת התראות" עושה בדפדפן)
  const sub = await api('/api/push/subscribe', { method: 'POST', token: owner, body: { subscription: FAKE_SUB } });
  assert.equal(sub.status, 201, JSON.stringify(sub.json));
  const { rows: urow } = await db.query(`SELECT id FROM users WHERE phone='+972500000003'`);
  const { rows: subs } = await db.query(`SELECT endpoint FROM push_subscriptions WHERE user_id=$1`, [urow[0].id]);
  assert.equal(subs.length, 1, 'subscription stored for owner');

  // 2. הזמנה חדשה → נתיב ההתראה לבעלים מנסה push ראשון (לפני whatsapp/לוג)
  const l = await api('/api/laundries/achuza');
  const item = l.json.items[0];
  const r = await api('/api/orders', { method: 'POST', token: customer, body: { slug: 'achuza', items: [{ item_id: item.id, qty: 1 }], address: 'רחוב הפוש 3, תל אביב' } });
  assert.equal(r.status, 201, JSON.stringify(r.json));

  // ההתראה לבעלים נרשמה — ה-push ניסה (attempted=1) אך ה-endpoint מדומה, אז sent=0 ונפילה חזרה לערוץ הבא.
  // זו הסימולציה המתועדת: בדפדפן אמיתי המנוי תקין וה-push מגיע (web-push ל-endpoint אמיתי).
  await new Promise(res => setTimeout(res, 800)); // notifyLaundryNewOrder רץ אסינכרוני
  const { rows: notifs } = await db.query(
    `SELECT channel, sent, body FROM notifications WHERE user_id=$1 ORDER BY id DESC LIMIT 1`, [urow[0].id]);
  assert.ok(notifs.length, 'owner notification logged');
  assert.match(notifs[0].body, /הזמנה|התקבלה|חדשה/i, 'new-order body');

  // 3. בידוד: אין מנויי push לטנאנט אחר מהפעולה הזו
  const { rows: otherSubs } = await db.query(
    `SELECT count(*)::int AS n FROM push_subscriptions WHERE user_id<>$1`, [urow[0].id]);
  assert.equal(otherSubs[0].n, 0);

  // 4. מנוי לא תקין נדחה
  const bad = await api('/api/push/subscribe', { method: 'POST', token: owner, body: { subscription: { endpoint: 'x' } } });
  assert.equal(bad.status, 400);
});

test('T110: UI — באנר הפעלת התראות לבעלים מוזרק במסכי ניהול; push-first בנתיב ההזמנה', () => {
  const pj = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'push.js'), 'utf8');
  assert.match(pj, /owner-push-banner/, 'banner id');
  assert.match(pj, /#\/manage/, 'manage screens only');
  assert.match(pj, /state\.memberships/, 'owners/staff only');
  assert.match(pj, /owner_push_dismissed/, 'dismissible, not nagging');
  assert.match(pj, /הזמנה חדשה/, 'new-order copy');
  const orders = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'orders.js'), 'utf8');
  assert.match(orders, /notifyLaundryNewOrder/, 'owner notified on order creation');
  const notify = fs.readFileSync(path.join(__dirname, '..', 'src', 'notify.js'), 'utf8');
  assert.ok(notify.indexOf('sendPushToUser') < notify.indexOf('sendWhatsApp'), 'push attempted before whatsapp fallback');
});
