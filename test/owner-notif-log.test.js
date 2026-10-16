// N8: לוג התראות מדומות לבעל מכבסה + איחוד טון תבניות + ניסוחי fallback של הבוט
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers');

test('N8: לוג התראות — בעלים בלבד, מראה מה היה נשלח ולמי', async (t) => {
  const { api } = await startApp(t);
  const customer = await api.login('+972500000002');
  const owner = await api.login('+972500000003');
  const stranger = await api.login('+972500000099');

  const anon = await api('/api/t/achuza/notif-log');
  assert.equal(anon.status, 401);
  const denied = await api('/api/t/achuza/notif-log', { token: stranger });
  assert.equal(denied.status, 403);

  // יוצרים פעילות שמייצרת התראות: הזמנה + אישור
  const page = await api('/api/laundries/achuza');
  const bag = page.json.items.find(i => i.name.includes('שק'));
  const created = await api('/api/orders', { method: 'POST', token: customer, body: { slug: 'achuza', items: [{ item_id: bag.id, qty: 1 }], address: 'הרצל 12' } });
  assert.equal(created.status, 201);
  await api(`/api/t/achuza/orders/${created.json.order.id}/status`, { method: 'POST', token: owner, body: { status: 'confirmed' } });
  await new Promise(r => setTimeout(r, 1200));

  const log = await api('/api/t/achuza/notif-log', { token: owner });
  assert.equal(log.status, 200);
  assert.equal(log.json.simulated, true);
  assert.ok(log.json.note.includes('לא נשלח דבר לאיש'));
  assert.ok(log.json.log.length >= 3, 'customer received + owner new-order + status confirmed');
  for (const x of log.json.log) {
    assert.ok(x.channel_he, 'channel label in Hebrew');
    assert.ok(x.body, 'body shown');
    assert.ok(x.to, 'recipient shown');
  }
  assert.ok(log.json.log.some(x => x.body.includes('התקבלה')), 'customer order-received logged');
  assert.ok(log.json.log.some(x => x.body.includes('הזמנה חדשה')), 'owner new-order logged');
});

test('N8: טון התבניות — עברית פשוטה, סימון דמו עקבי, בלי ניסוח מנופח', async (t) => {
  const { api } = await startApp(t);
  const admin = await api.login('+972500000001');
  await api('/api/admin/message-templates/seed-defaults', { method: 'POST', token: admin });
  const list = await api('/api/admin/message-templates', { token: admin });
  assert.equal(list.status, 200);
  const tpls = list.json.templates;
  assert.ok(tpls.length >= 6);
  const BANNED = /בברכה|בתודה מראש|אנו מתכבדים|הננו|בזאת|לשם כך|באופן מיידי/;
  for (const tp of tpls) {
    assert.ok(!BANNED.test(tp.title + ' ' + tp.body), `no inflated phrasing in ${tp.key}`);
    assert.ok(tp.body.length < 220, `short body in ${tp.key}`);
  }
  // סימון דמו בכל תבנית מדומה
  for (const key of ['welcome_sim', 'receipt_email_sim', 'laundry_new_order', 'owner_daily_summary']) {
    const tp = tpls.find(x => x.key === key);
    assert.ok(tp, key + ' exists');
    assert.match(tp.body + ' ' + tp.title, /דמו|סימולציה/, key + ' marked as demo');
  }
});

test('N8: fallback של הבוט — קצר, עם דוגמאות מוכנות, ו"עזרה" מחזירה את התפריט', async (t) => {
  const { api } = await startApp(t);
  const fb = await api('/api/bot-sim/chat', { method: 'POST', body: { message: 'שרשור אקראי לגמרי' } });
  assert.match(fb.json.reply, /לא הבנתי/);
  assert.match(fb.json.reply, /מחירון/);           // דוגמאות קצרות
  assert.ok(fb.json.reply.length < 400, 'short fallback');
  const help = await api('/api/bot-sim/chat', { method: 'POST', body: { message: 'עזרה' } });
  assert.match(help.json.reply, /אפשר לכתוב לי למשל/);
});
