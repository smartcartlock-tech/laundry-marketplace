// deep-link ב-push: notifyUser מעביר opts.url ל-payload של sendPushToUser (רק אם קיים)
const test = require('node:test');
const assert = require('node:assert/strict');

// מוקים לתלויות DB לפני טעינת notify.js (תהליך נפרד לכל קובץ טסט)
let captured = null;
for (const [mod, exp] of [
  ['../src/db', { q: async () => ({ rows: [] }) }],
  ['../src/notification-prefs', { statusMuted: async () => false }],
  ['../src/shabbat', { shabbatMuted: async () => false }],
  ['../src/usermessages', { postOrderMessage: async () => ({}) }],
]) {
  const r = require.resolve(mod);
  require.cache[r] = { id: r, filename: r, loaded: true, exports: exp };
}
const pushMod = require('../src/push');
pushMod.sendPushToUser = async (uid, payload) => { captured = payload; return { sent: 1 }; };
const { notifyUser } = require('../src/notify');

test('notifyUser: opts.url מגיע ל-payload של ה-push', async () => {
  captured = null;
  await notifyUser('u1', 't1', 'גוף', '+972500000004', 'כותרת', { url: './#/courier' });
  assert.ok(captured, 'push נשלח');
  assert.equal(captured.url, './#/courier');
  assert.equal(captured.title, 'כותרת');
  assert.equal(captured.body, 'גוף');
});

test('notifyUser: בלי opts.url אין שדה url ב-payload', async () => {
  captured = null;
  await notifyUser('u1', 't1', 'גוף', '+972500000004');
  assert.ok(captured, 'push נשלח');
  assert.ok(!('url' in captured), 'אין url כשלא הועבר');
});
