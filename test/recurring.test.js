// E4.T2: הזמנה חוזרת — job מייצר רק ביום מתוזמן, פעם ביום, והשהיה עוצרת
const { test } = require('node:test');
const assert = require('node:assert');
const { Pool } = require('pg');
const { startApp, TEST_DB } = require('./helpers');
const { generateDueOrders } = require('../src/recurring');

const IL = 'Asia/Jerusalem';
const todayDow = () => new Date(new Date().toLocaleString('en-US', { timeZone: IL })).getDay();

test('recurring orders: generates only on scheduled day, once a day, pause stops', async (t) => {
  const { api, schema } = await startApp(t);
  const owner = await api.login('+972500000003', 'בעל מכבסה לדמו');
  await api.login('+972500000002', 'לקוח דמו');
  const me = await api('/api/auth/me', { token: await api.login('+972500000002', 'לקוח דמו') });
  const userId = me.json.user.id;

  const acc = (await api('/api/t/achuza/business-accounts', { method: 'POST', token: owner, body: {
    name: 'מלון הים', company_id: '514000000', contact_name: 'דנה', contact_phone: '+972501234567' } })).json.account;
  await api(`/api/t/achuza/business-accounts/${acc.id}/users`, { method: 'POST', token: owner, body: { phone: '+972500000002' } });

  const pub = await api('/api/laundries/achuza');
  const item = pub.json.items[0];
  await api(`/api/t/achuza/business-accounts/${acc.id}/prices`, { method: 'PUT', token: owner, body: {
    prices: [{ item_id: item.id, price: Number(item.price) - 7 }] } });

  const today = todayDow();
  // תבנית להיום, תבנית למחר, תבנית מושהית להיום
  const mk = (days) => api(`/api/t/achuza/business-accounts/${acc.id}/recurring`, { method: 'POST', token: owner, body: {
    user_id: userId, days, items: [{ item_id: item.id, qty: 2 }], pickup_time: '09:00', address: 'הרצל 1, תל אביב' } });
  const tToday = await mk([today]);
  assert.equal(tToday.status, 200, JSON.stringify(tToday.json));
  await mk([(today + 1) % 7]);
  const tPaused = await mk([today]);
  await api(`/api/t/achuza/business-accounts/${acc.id}/recurring/${tPaused.json.template.id}`, { method: 'PATCH', token: owner, body: { active: false } });

  const pool = new Pool({ connectionString: TEST_DB, options: `-c search_path=${schema},public` });
  t.after(() => pool.end());
  const q = (text, params) => pool.query(text, params);

  const run1 = await generateDueOrders(q);
  assert.equal(run1.created, 1, 'רק התבנית של היום מייצרת');
  const run2 = await generateDueOrders(q);
  assert.equal(run2.created, 0, 'לא מייצר פעמיים באותו יום');

  const { rows: orders } = await pool.query('SELECT * FROM orders WHERE business_account_id=$1', [acc.id]);
  assert.equal(orders.length, 1);
  assert.equal(orders[0].source, 'recurring');
  assert.equal(Number(orders[0].subtotal), (Number(item.price) - 7) * 2, 'מחיר הסכמי');
  assert.ok(orders[0].pickup_at, 'שעת איסוף נקבעה');

  // הרשמה של שתי התבניות הפעילות + המושהית ברשימה
  const list = await api(`/api/t/achuza/business-accounts/${acc.id}/recurring`, { token: owner });
  assert.equal(list.json.templates.length, 3);
  assert.equal(list.json.templates.find(x => x.id === tPaused.json.template.id).active, false);
});
