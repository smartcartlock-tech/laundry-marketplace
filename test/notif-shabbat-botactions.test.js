// N7: הגדרות התראות (כולל שקט שבת/חגים), ביטול/שינוי חלון בבוט באישור מפורש, סיכום יומי לבעל מכבסה
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers');
const { isQuietTime } = require('../src/shabbat');

test('N7: isQuietTime — שבת וחגים מחושבים נכון', () => {
  assert.equal(isQuietTime(new Date(2026, 9, 16, 17, 0)).quiet, true);   // שישי 17:00
  assert.equal(isQuietTime(new Date(2026, 9, 16, 15, 0)).quiet, false);  // שישי 15:00
  assert.equal(isQuietTime(new Date(2026, 9, 17, 19, 0)).quiet, true);   // שבת 19:00
  assert.equal(isQuietTime(new Date(2026, 9, 17, 21, 0)).quiet, false);  // מוצאי שבת 21:00
  assert.equal(isQuietTime(new Date(2026, 8, 21, 10, 0)).quiet, true);   // יום כיפור תשפ"ז
  assert.equal(isQuietTime(new Date(2026, 8, 20, 17, 0)).quiet, true);   // ערב כיפור אחרי 16:00
  assert.equal(isQuietTime(new Date(2026, 8, 20, 10, 0)).quiet, false);  // ערב כיפור בבוקר
  assert.equal(isQuietTime(new Date(2026, 9, 19, 12, 0)).quiet, false);  // יום חול רגיל
});

test('N7: הגדרות התראות — ברירות מחדל, שמירה, וכיבוי order_messages מונע העתקה למרכז ההודעות', async (t) => {
  const { api } = await startApp(t);
  const customer = await api.login('+972500000002');

  const d = await api('/api/me/notification-settings', { token: customer });
  assert.equal(d.status, 200);
  assert.deepEqual(d.json.prefs, { status_updates: true, order_messages: true, marketing: true, quiet_shabbat: false });
  assert.equal(typeof d.json.quiet_now, 'boolean');

  const bad = await api('/api/me/notification-settings', { method: 'PUT', token: customer, body: { quiet_shabbat: 'כן' } });
  assert.equal(bad.status, 400);

  const put = await api('/api/me/notification-settings', { method: 'PUT', token: customer, body: { quiet_shabbat: true, order_messages: false } });
  assert.equal(put.json.prefs.quiet_shabbat, true);
  assert.equal(put.json.prefs.order_messages, false);
  assert.equal(put.json.prefs.status_updates, true); // לא נדרס

  // order_messages=false: ההודעה יוצאת (נרשמת ב-notifications) אבל לא מועתקת למרכז ההודעות
  const page = await api('/api/laundries/achuza');
  const bag = page.json.items.find(i => i.name.includes('שק'));
  const created = await api('/api/orders', { method: 'POST', token: customer, body: { slug: 'achuza', items: [{ item_id: bag.id, qty: 1 }], address: 'הרצל 12' } });
  assert.equal(created.status, 201);
  await new Promise(r => setTimeout(r, 1500));
  const msgs = await api('/api/messages', { token: customer });
  assert.equal(msgs.json.messages.length, 0, 'no message-center copy when order_messages off');

  const anon = await api('/api/me/notification-settings');
  assert.equal(anon.status, 401);
});

test('N7: בוט — ביטול הזמנה ושינוי חלון איסוף רק באישור מפורש ולפי קוד מעקב', async (t) => {
  const { api } = await startApp(t);
  const customer = await api.login('+972500000002');
  const page = await api('/api/laundries/achuza');
  const bag = page.json.items.find(i => i.name.includes('שק'));
  const created = await api('/api/orders', { method: 'POST', token: customer, body: { slug: 'achuza', items: [{ item_id: bag.id, qty: 1 }], address: 'הרצל 12' } });
  const code = created.json.order.tracking_code;
  const oid = created.json.order.id;

  // ביטול בלי אישור קודם — נדחה
  const noPend = await api('/api/bot-sim/chat', { method: 'POST', body: { message: `אישור ביטול ${code}` } });
  assert.match(noPend.json.reply, /אין בקשת ביטול ממתינה/);

  // בקשת ביטול — מבקש אישור מפורש, לא מבטל עדיין
  const ask = await api('/api/bot-sim/chat', { method: 'POST', body: { message: `בטל הזמנה ${code}` } });
  assert.match(ask.json.reply, /אישור מפורש/);
  let ord = await api('/api/track/' + code);
  assert.notEqual(ord.json.status, 'cancelled');

  // אישור מפורש — מבטל בפועל
  const yes = await api('/api/bot-sim/chat', { method: 'POST', body: { message: `אישור ביטול ${code}` } });
  assert.match(yes.json.reply, /בוטלה/);
  ord = await api('/api/track/' + code);
  assert.equal(ord.json.status, 'cancelled');

  // ביטול נוסף של הזמנה מבוטלת — נדחה
  const again = await api('/api/bot-sim/chat', { method: 'POST', body: { message: `בטל הזמנה ${code}` } });
  assert.match(again.json.reply, /אי אפשר לבטל/);

  // שינוי חלון איסוף — הזמנה חדשה
  const c2 = await api('/api/orders', { method: 'POST', token: customer, body: { slug: 'achuza', items: [{ item_id: bag.id, qty: 1 }], address: 'הרצל 12' } });
  const code2 = c2.json.order.tracking_code;
  const opts = await api('/api/bot-sim/chat', { method: 'POST', body: { message: `שנה חלון איסוף ${code2}` } });
  assert.match(opts.json.reply, /1\).*\n2\).*\n3\)/);
  const ok2 = await api('/api/bot-sim/chat', { method: 'POST', body: { message: `אישור שינוי ${code2} 2` } });
  assert.match(ok2.json.reply, /עודכן/);
  const ord2 = await api('/api/track/' + code2);
  assert.ok(ord2.json.pickup_at, 'pickup_at set');

  // קוד לא קיים
  const ghost = await api('/api/bot-sim/chat', { method: 'POST', body: { message: 'בטל הזמנה ABCDEF12' } });
  assert.match(ghost.json.reply, /לא מצאתי/);
});

test('N7: סיכום יומי לבעל מכבסה — תבנית, נשמר במרכז ההודעות, סימולציה', async (t) => {
  const { api } = await startApp(t);
  const owner = await api.login('+972500000003');
  const customer = await api.login('+972500000002');

  // יוצרים הזמנה כדי שיהיה תוכן לסיכום
  const page = await api('/api/laundries/achuza');
  const bag = page.json.items.find(i => i.name.includes('שק'));
  await api('/api/orders', { method: 'POST', token: customer, body: { slug: 'achuza', items: [{ item_id: bag.id, qty: 1 }], address: 'הרצל 12' } });

  // לקוח רגיל — אין סיכום
  const denied = await api('/api/bot-sim/chat', { method: 'POST', token: customer, body: { message: 'סיכום יומי' } });
  assert.match(denied.json.reply, /לא משויך למכבסה/);

  // בעל מכבסה — מקבל סיכום מהתבנית
  const sum = await api('/api/bot-sim/chat', { method: 'POST', token: owner, body: { message: 'סיכום יומי' } });
  assert.match(sum.json.reply, /סיכום יומי/);
  assert.match(sum.json.reply, /הזמנות/);
  assert.match(sum.json.reply, /סימולציה/);
  assert.match(sum.json.reply, /מסמך דמו/);

  await new Promise(r => setTimeout(r, 800));
  const msgs = await api('/api/messages', { token: owner });
  const m = msgs.json.messages.find(x => x.kind === 'template' && x.title.includes('סיכום יומי'));
  assert.ok(m, 'summary saved to message center');
  assert.match(m.body, /חריגים/);
});

test('N7: שעון מוזרק — שקט מושתת בשעת חול, נאכף בשבת ובחג (notifyUser אמיתי)', async (t) => {
  const app = await startApp(t); const { api } = app;
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://postgres@127.0.0.1:5433/laundry_test';
  process.env.PGSCHEMA = app.schema;
  const { notifyUser } = require('../src/notify');
  const { __setClock } = require('../src/shabbat');
  const db = require('../src/db');

  const customer = await api.login('+972500000002');
  const { rows: u } = await db.q("SELECT id FROM users WHERE phone='+972500000002'");
  const uid = u[0].id;
  await api('/api/me/notification-settings', { method: 'PUT', token: customer, body: { quiet_shabbat: true } });

  t.after(() => __setClock(null));

  // שעת חול (שני 12:00) — נשלח רגיל, לא shabbat-muted
  __setClock(() => new Date(2026, 9, 19, 12, 0));
  await notifyUser(uid, null, 'בדיקת שעת חול', null);
  let { rows } = await db.q("SELECT channel FROM notifications WHERE user_id=$1 AND body='בדיקת שעת חול'", [uid]);
  assert.equal(rows[0].channel, 'log');

  // חג (יום כיפור) בצהריים — מושתת
  __setClock(() => new Date(2026, 8, 21, 12, 0));
  await notifyUser(uid, null, 'בדיקת חג', null);
  ({ rows } = await db.q("SELECT channel, sent FROM notifications WHERE user_id=$1 AND body='בדיקת חג'", [uid]));
  assert.equal(rows[0].channel, 'shabbat-muted');
  assert.equal(rows[0].sent, false);

  // שבת — מושתת
  __setClock(() => new Date(2026, 9, 17, 10, 0));
  await notifyUser(uid, null, 'בדיקת שבת', null);
  ({ rows } = await db.q("SELECT channel FROM notifications WHERE user_id=$1 AND body='בדיקת שבת'", [uid]));
  assert.equal(rows[0].channel, 'shabbat-muted');

  __setClock(null);
  // אחרי איפוס השעון — חוזר לזמן אמת (לא מושתת בכוח)
  await notifyUser(uid, null, 'בדיקת איפוס', null);
  ({ rows } = await db.q("SELECT channel FROM notifications WHERE user_id=$1 AND body='בדיקת איפוס'", [uid]));
  assert.notEqual(rows[0].channel, undefined);
});

test('N7: race — שני משתמשים מאשרים ביטול של אותה הזמנה במקביל; מנצח אחד בלבד', async (t) => {
  const { api } = await startApp(t);
  const customer = await api.login('+972500000002');
  const other = await api.login('+972500000099');
  const page = await api('/api/laundries/achuza');
  const bag = page.json.items.find(i => i.name.includes('שק'));
  const created = await api('/api/orders', { method: 'POST', token: customer, body: { slug: 'achuza', items: [{ item_id: bag.id, qty: 1 }], address: 'הרצל 12' } });
  const code = created.json.order.tracking_code;

  // שניהם מבקשים ביטול (שני pending נפרדים — מחובר ואורח)
  const r1 = await api('/api/bot-sim/chat', { method: 'POST', token: customer, body: { message: `בטל הזמנה ${code}` } });
  const r2 = await api('/api/bot-sim/chat', { method: 'POST', token: other, body: { message: `בטל הזמנה ${code}` } });
  assert.match(r1.json.reply, /אישור מפורש/);
  assert.match(r2.json.reply, /אישור מפורש/);

  // אישור בו-זמנית — רק אחד מצליח
  const [c1, c2] = await Promise.all([
    api('/api/bot-sim/chat', { method: 'POST', token: customer, body: { message: `אישור ביטול ${code}` } }),
    api('/api/bot-sim/chat', { method: 'POST', token: other, body: { message: `אישור ביטול ${code}` } }),
  ]);
  const wins = [c1, c2].filter(c => /בוטלה ✅/.test(c.json.reply)).length;
  const loses = [c1, c2].filter(c => /לא בוצע/.test(c.json.reply)).length;
  assert.equal(wins, 1, 'exactly one winner');
  assert.equal(loses, 1, 'loser got graceful message');

  const track = await api('/api/track/' + code);
  assert.equal(track.json.status, 'cancelled');
  assert.equal(track.json.events.filter(e => e.status === 'cancelled').length, 1, 'single cancelled event');
});

test('N7: חוזה לקוח — דף ההגדרות שולח PUT כ-JSON מומחרז (רגרסיה לטוסט [object Object])', () => {
  const fs = require('fs');
  const js = fs.readFileSync(require('path').join(__dirname, '..', 'public', 'js', 'notif-settings.js'), 'utf8');
  assert.match(js, /method: 'PUT', body: JSON\.stringify\(/, 'PUT body is JSON.stringify-ed');
  assert.ok(!/method: 'PUT', body: next/.test(js), 'no raw-object body regression');
});
