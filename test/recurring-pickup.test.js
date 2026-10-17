// T85: איסוף קבוע לצרכן — CRUD, הרשאות, יצירה אוטומטית פעם ביום, biweekly, הודעה פנימית
const { test } = require('node:test');
const assert = require('node:assert');
const { Pool } = require('pg');
const { startApp, TEST_DB } = require('./helpers');
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5433/laundry_test';
const { generateDueConsumerPickups } = require('../src/consumer-recurring');

const IL = 'Asia/Jerusalem';
const todayDow = () => new Date(new Date().toLocaleString('en-US', { timeZone: IL })).getDay();
const todayStr = () => new Date().toLocaleDateString('en-CA', { timeZone: IL });

async function setup(t) {
  const { api, schema } = await startApp(t);
  const customer = await api.login('+972500000002');
  const other = await api.login('+972500000004');
  const owner = await api.login('+972500000003');
  const pub = await api('/api/laundries/achuza');
  const item = pub.json.items[0];
  const pool = new Pool({ connectionString: TEST_DB, options: `-c search_path=${schema},public` });
  t.after(() => pool.end());
  return { api, schema, customer, other, owner, item, q: (s, p) => pool.query(s, p) };
}

test('T85: יצירה, רשימה, השהיה/חידוש, ביטול + הרשאות ובידוד', async (t) => {
  const { api, customer, other, owner, item } = await setup(t);
  const wd = todayDow();
  const bad = await api('/api/t/achuza/recurring-pickup', { method: 'POST', token: customer, body: { weekday: wd, address: 'הרצל 1', items: [] } });
  assert.equal(bad.status, 400);
  const c = await api('/api/t/achuza/recurring-pickup', { method: 'POST', token: customer, body: {
    weekday: wd, frequency: 'weekly', pickup_time: '09:30', address: 'הרצל 1, תל אביב', items: [{ item_id: item.id, qty: 2 }] } });
  assert.equal(c.status, 201, JSON.stringify(c.json));
  const sid = c.json.subscription.id;
  // כפילות באותו יום נחסמת
  const dup = await api('/api/t/achuza/recurring-pickup', { method: 'POST', token: customer, body: {
    weekday: wd, address: 'הרצל 1', items: [{ item_id: item.id, qty: 1 }] } });
  assert.equal(dup.status, 409);
  // פריט של טנאנט אחר נדחה
  const pub2 = await api('/api/laundries/express');
  const cross = await api('/api/t/achuza/recurring-pickup', { method: 'POST', token: customer, body: {
    weekday: (wd + 1) % 7, address: 'הרצל 1', items: [{ item_id: pub2.json.items[0].id, qty: 1 }] } });
  assert.equal(cross.status, 400);
  // רשימה עצמית
  const mine = await api('/api/me/recurring-pickups', { token: customer });
  assert.equal(mine.status, 200);
  assert.equal(mine.json.subscriptions.length, 1);
  assert.equal(mine.json.subscriptions[0].tenant_name, 'מכבסת האחוזה');
  // משתמש אחר לא רואה/לא נוגע
  assert.equal((await api(`/api/me/recurring-pickups/${sid}`, { method: 'PATCH', token: other, body: { active: false } })).status, 404);
  assert.equal((await api(`/api/me/recurring-pickups/${sid}`, { method: 'DELETE', token: other })).status, 404);
  // בעלים רואה בטנאנט שלו; לקוח רגיל — לא
  assert.equal((await api('/api/t/achuza/recurring-pickup', { token: owner })).json.subscriptions.length, 1);
  assert.equal((await api('/api/t/achuza/recurring-pickup', { token: customer })).status, 403);
  // השהיה וחידוש
  const pause = await api(`/api/me/recurring-pickups/${sid}`, { method: 'PATCH', token: customer, body: { active: false } });
  assert.equal(pause.json.subscription.active, false);
  const resume = await api(`/api/me/recurring-pickups/${sid}`, { method: 'PATCH', token: customer, body: { active: true, pickup_time: '10:00' } });
  assert.equal(resume.json.subscription.active, true);
  assert.equal(resume.json.subscription.pickup_time, '10:00');
  // ביטול
  assert.equal((await api(`/api/me/recurring-pickups/${sid}`, { method: 'DELETE', token: customer })).status, 200);
  assert.equal((await api('/api/me/recurring-pickups', { token: customer })).json.subscriptions.length, 0);
});

test('T85: יצירה אוטומטית — רק ביום המתוזמן, פעם ביום, מושהה לא, biweekly בשבוע הנכון, הודעה פנימית', async (t) => {
  const { api, customer, item, q } = await setup(t);
  const wd = todayDow();
  const today = todayStr();
  const mk = (body) => api('/api/t/achuza/recurring-pickup', { method: 'POST', token: customer, body: {
    address: 'הרצל 1, תל אביב', items: [{ item_id: item.id, qty: 3 }], ...body } });
  const weekly = await mk({ weekday: wd, frequency: 'weekly', pickup_time: '09:00' });
  assert.equal(weekly.status, 201, JSON.stringify(weekly.json));
  const tomorrow = await mk({ weekday: (wd + 1) % 7 });
  assert.equal(tomorrow.status, 201);
  // biweekly עם עוגן שבוע שעבר → השבוע לא בשבוע שלו
  const anchor = new Date(today + 'T12:00:00Z');
  anchor.setUTCDate(anchor.getUTCDate() - 7);
  await q(`UPDATE consumer_pickup_subscriptions SET anchor_date=$2::date WHERE id=$1`, [tomorrow.json.subscription.id, today]);
  const bi = await mk({ weekday: wd, frequency: 'biweekly' });
  assert.equal(bi.status, 409); // אותו יום כמו weekly — נחסם; נעדכן את weekly ל-biweekly במקום
  await q(`UPDATE consumer_pickup_subscriptions SET frequency='biweekly', anchor_date=$2::date WHERE id=$1`,
    [weekly.json.subscription.id, anchor.toISOString().slice(0, 10)]);

  // ריצה היום: weekly (שהוא biweekly מושהה-שבוע) לא; tomorrow לא (לא יומו)
  let r = await generateDueConsumerPickups((s, p) => q(s, p), { dow: wd, date: today });
  assert.equal(r.created, 0, 'biweekly מחוץ לשבוע העוגן לא מייצר');
  // החזרת העוגן להיום → מייצר
  await q(`UPDATE consumer_pickup_subscriptions SET anchor_date=$2::date WHERE id=$1`, [weekly.json.subscription.id, today]);
  r = await generateDueConsumerPickups((s, p) => q(s, p), { dow: wd, date: today });
  assert.equal(r.created, 1);
  const { rows: orders } = await q(`SELECT * FROM orders WHERE source='recurring'`);
  assert.equal(orders.length, 1);
  assert.equal(Number(orders[0].subtotal), Number(item.price) * 3);
  assert.ok(orders[0].pickup_at, 'pickup_at נקבע');
  // ריצה חוזרת באותו יום — לא שוב
  r = await generateDueConsumerPickups((s, p) => q(s, p), { dow: wd, date: today });
  assert.equal(r.created, 0);
  // הודעה פנימית נמסרה
  const { rows: msgs } = await q(`SELECT * FROM user_messages WHERE kind='order' AND title LIKE '%איסוף הקבוע%'`);
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].tenant_id, orders[0].tenant_id);
  // השהיה עוצרת
  await api(`/api/me/recurring-pickups/${weekly.json.subscription.id}`, { method: 'PATCH', token: customer, body: { active: false } });
  const nextWeek = new Date(today + 'T12:00:00Z'); nextWeek.setUTCDate(nextWeek.getUTCDate() + 7);
  const nw = nextWeek.toISOString().slice(0, 10);
  r = await generateDueConsumerPickups((s, p) => q(s, p), { dow: wd, date: nw });
  assert.equal(r.created, 0, 'מנוי מושהה לא מייצר');
});
