// N6: תבניות הודעה לאירועי הזמנה — מכבסה על הזמנה חדשה, שליח על משימה חדשה,
// והעתקה אוטומטית של כל התראת notifyUser למרכז ההודעות.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers');

async function waitMsgs(api, token, pred, tries = 20) {
  for (let i = 0; i < tries; i++) {
    const d = await api('/api/messages', { token });
    if (d.status === 200 && pred(d.json.messages)) return d.json;
    await new Promise(r => setTimeout(r, 200));
  }
  const last = await api('/api/messages', { token });
  return last.json;
}

test('N6: הזמנה חדשה מודיעה למכבסה בתבנית, שיבוץ מודיע לשליח בתבנית, הכל במרכז ההודעות', async (t) => {
  const { api } = await startApp(t);
  const customer = await api.login('+972500000002');
  const owner = await api.login('+972500000003');
  const courierUser = await api.login('+972500000004');

  const page = await api('/api/laundries/achuza');
  const bag = page.json.items.find(i => i.name.includes('שק'));
  const created = await api('/api/orders', { method: 'POST', token: customer, body: { slug: 'achuza', items: [{ item_id: bag.id, qty: 1 }], address: 'הרצל 12, תל אביב' } });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const order = created.json.order;

  // הלקוח קיבל הודעת "התקבלה" — מועתקת אוטומטית למרכז ההודעות (notifyUser אסינכרוני — ממתינים)
  const custMsgs = await waitMsgs(api, customer, ms => ms.some(m => m.body.includes('התקבלה')));
  assert.ok(custMsgs.messages.some(m => m.body.includes('התקבלה')), 'customer got order-received message');
  assert.ok(custMsgs.unread >= 1);

  // בעל המכבסה קיבל הודעת "הזמנה חדשה" מתבנית laundry_new_order (כולל קוד מעקב וסכום)
  const ownerMsgs = await waitMsgs(api, owner, ms => ms.some(m => m.title.includes('הזמנה חדשה')));
  const newOrder = ownerMsgs.messages.find(m => m.title.includes('הזמנה חדשה'));
  assert.ok(newOrder, 'owner got laundry_new_order template message');
  assert.ok(newOrder.body.includes(order.tracking_code), 'body includes tracking code');
  assert.ok(newOrder.body.includes(String(Number(order.total))), 'body includes total');
  assert.ok(newOrder.body.includes('מסמך דמו'), 'marked as demo');

  // שיבוץ שליח פרטי — הודעת courier_new_task מהתבנית
  const couriers = await api('/api/t/achuza/couriers', { token: owner });
  const priv = couriers.json.couriers.find(c => c.model === 'private');
  const assign = await api(`/api/t/achuza/orders/${order.id}/assign`, { method: 'POST', token: owner, body: { courier_id: priv.id } });
  assert.equal(assign.status, 200, JSON.stringify(assign.json));

  const courierMsgs = await waitMsgs(api, courierUser, ms => ms.some(m => m.title.includes('משימה חדשה')));
  const task = courierMsgs.messages.find(m => m.title.includes('משימה חדשה'));
  assert.ok(task, 'courier got courier_new_task template message');
  assert.ok(task.body.includes('שובצת לאיסוף'), 'assign mode text');
  assert.ok(task.body.includes('הרצל 12'), 'includes address');
  assert.ok(task.body.includes('מכבסת האחוזה'), 'includes tenant name');

  // שינוי סטטוס — מועתק גם הוא למרכז ההודעות של הלקוח
  const confirm = await api(`/api/t/achuza/orders/${order.id}/status`, { method: 'POST', token: owner, body: { status: 'confirmed' } });
  assert.equal(confirm.status, 200);
  const custMsgs2 = await waitMsgs(api, customer, ms => ms.some(m => m.body.includes('אושרה')));
  assert.ok(custMsgs2.messages.some(m => m.body.includes('אושרה')), 'status change mirrored to message center');
});

test('N6: שאלת הבוט "איפה ההזמנה שלי" לפי קוד מעקב + שעות פתיחה לפי מכבסה', async (t) => {
  const { api } = await startApp(t);
  const customer = await api.login('+972500000002');

  const page = await api('/api/laundries/achuza');
  const bag = page.json.items.find(i => i.name.includes('שק'));
  const created = await api('/api/orders', { method: 'POST', token: customer, body: { slug: 'achuza', items: [{ item_id: bag.id, qty: 1 }], address: 'הרצל 12, תל אביב' } });
  const code = created.json.order.tracking_code;
  assert.ok(code);

  // בלי קוד — הבוט מבקש קוד
  const noCode = await api('/api/bot-sim/chat', { method: 'POST', body: { message: 'איפה ההזמנה שלי?' } });
  assert.match(noCode.json.reply, /קוד (ה)?מעקב/);

  // עם קוד — סטטוס אמיתי מה-DB (אנונימי, כמו עמוד המעקב הציבורי)
  const withCode = await api('/api/bot-sim/chat', { method: 'POST', body: { message: `איפה ההזמנה ${code}` } });
  assert.match(withCode.json.reply, /מכבסת האחוזה/);
  assert.match(withCode.json.reply, /חדשה/);

  // קוד שגוי
  const badCode = await api('/api/bot-sim/chat', { method: 'POST', body: { message: 'איפה ההזמנה ABCDEF12' } });
  assert.match(badCode.json.reply, /לא מצאתי/);

  // שעות פתיחה לפי שם מכבסה ספציפי
  const hours = await api('/api/bot-sim/chat', { method: 'POST', body: { message: 'שעות פתיחה של מכבסת האחוזה' } });
  assert.match(hours.json.reply, /שעות הפעילות של מכבסת האחוזה/);
  assert.match(hours.json.reply, /יום/);

  // מכבסה שלא קיימת
  const noL = await api('/api/bot-sim/chat', { method: 'POST', body: { message: 'שעות פתיחה של מכבסת הקשקוש' } });
  assert.match(noL.json.reply, /לא מצאתי מכבסת/);
});
