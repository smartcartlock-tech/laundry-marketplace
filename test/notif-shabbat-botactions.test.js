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
