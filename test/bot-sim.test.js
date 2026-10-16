// N3+N4: סימולציית צ'אט בוט + תיבת דואר יוצא מדומה (אין שליחה אמיתית)
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers');

test("N3: צ'אט בוט מדומה — ברכה, מכבסות, מחירון, שעות; מסומן כסימולציה", async (t) => {
  const { api } = await startApp(t);

  const hi = await api('/api/bot-sim/chat', { method: 'POST', body: { message: 'שלום' } });
  assert.equal(hi.status, 200);
  assert.equal(hi.json.simulated, true);
  assert.match(hi.json.reply, /סימולציה/);

  const laundries = await api('/api/bot-sim/chat', { method: 'POST', body: { message: 'אילו מכבסות יש?' } });
  assert.match(laundries.json.reply, /מכבסות|מכבסה/);

  const prices = await api('/api/bot-sim/chat', { method: 'POST', body: { message: 'מה המחירון?' } });
  assert.match(prices.json.reply, /₪|מחירון/);

  const unknown = await api('/api/bot-sim/chat', { method: 'POST', body: { message: 'בלבלבל שרשור אקראי' } });
  assert.match(unknown.json.reply, /לא הבנתי/);

  // סטטוס לאורח — מבקש התחברות; למחובר — מציין שאין הזמנות
  const stAnon = await api('/api/bot-sim/chat', { method: 'POST', body: { message: 'מה סטטוס ההזמנה שלי?' } });
  assert.match(stAnon.json.reply, /להתחבר/);
  const token = await api.login('+972500000002');
  const stUser = await api('/api/bot-sim/chat', { method: 'POST', token, body: { message: 'מה סטטוס ההזמנה שלי?' } });
  assert.match(stUser.json.reply, /הזמנ/);
});

test('N4: דוא"ל/וואטסאפ מדומה — נרשם בלבד, אימות קלט, הפרדת משתמשים', async (t) => {
  const { api } = await startApp(t);
  const anon = await api('/api/sim-outbox/send', { method: 'POST', body: {} });
  assert.equal(anon.status, 401);

  const token = await api.login('+972500000002', 'לקוח דמו');

  const badCh = await api('/api/sim-outbox/send', { method: 'POST', token, body: { channel: 'sms', recipient: 'x', body: 'y' } });
  assert.equal(badCh.status, 400);
  const badMail = await api('/api/sim-outbox/send', { method: 'POST', token, body: { channel: 'email', recipient: 'not-an-email', subject: 's', body: 'b' } });
  assert.equal(badMail.status, 400);
  const noSubj = await api('/api/sim-outbox/send', { method: 'POST', token, body: { channel: 'email', recipient: 'a@b.com', body: 'b' } });
  assert.equal(noSubj.status, 400);

  const wa = await api('/api/sim-outbox/send', { method: 'POST', token, body: { channel: 'whatsapp', recipient: '0501234567', body: 'הודעת דמו' } });
  assert.equal(wa.status, 201);
  assert.equal(wa.json.simulated, true);
  const em = await api('/api/sim-outbox/send', { method: 'POST', token, body: { channel: 'email', recipient: 'demo@example.com', subject: 'קבלה', body: 'מסמך דמו' } });
  assert.equal(em.status, 201);

  const list = await api('/api/sim-outbox', { token });
  assert.equal(list.json.simulated, true);
  assert.equal(list.json.messages.length, 2);

  const other = await api.login('+972500000003');
  const oList = await api('/api/sim-outbox', { token: other });
  assert.equal(oList.json.messages.length, 0);
});
