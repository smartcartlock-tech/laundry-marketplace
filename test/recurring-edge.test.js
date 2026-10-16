// E4.T2 קצה: תבנית לשבת מייצרת רק בשבת; מעבר יום לא מייצר כפילות; תבנית בלי שעת איסוף
const { test } = require('node:test');
const assert = require('node:assert');
const { Pool } = require('pg');
const { startApp, TEST_DB } = require('./helpers');
const { generateDueOrders } = require('../src/recurring');

test('recurring edge: saturday template fires only on saturday, no dup next day, no pickup_time', async (t) => {
  const { api, schema } = await startApp(t);
  const owner = await api.login('+972500000003', 'בעל מכבסה');
  await api.login('+972500000002', 'לקוחה לדמו');
  const uid = (await api('/api/auth/me', { token: await api.login('+972500000002', 'לקוחה לדמו') })).json.user.id;

  const acc = (await api('/api/t/achuza/business-accounts', { method: 'POST', token: owner, body: { name: 'חברת שבת' } })).json.account;
  await api(`/api/t/achuza/business-accounts/${acc.id}/users`, { method: 'POST', token: owner, body: { phone: '+972500000002' } });
  const item = (await api('/api/laundries/achuza')).json.items[0];

  // תבנית לשבת (6) בלי שעת איסוף
  const tpl = (await api(`/api/t/achuza/business-accounts/${acc.id}/recurring`, { method: 'POST', token: owner, body: {
    user_id: uid, days: [6], items: [{ item_id: item.id, qty: 1 }], address: 'הרצל 1' } })).json.template;
  assert.ok(tpl.id);

  const pool = new Pool({ connectionString: TEST_DB, options: `-c search_path=${schema},public` });
  t.after(() => pool.end());
  const q = (s, p) => pool.query(s, p);

  // יום שישי 16.10.2026 — לא מייצר
  let r = await generateDueOrders(q, { dow: 5, date: '2026-10-16' });
  assert.equal(r.created, 0);
  // שבת 17.10.2026 — מייצר
  r = await generateDueOrders(q, { dow: 6, date: '2026-10-17' });
  assert.equal(r.created, 1);
  // שוב באותה שבת — כפילות נחסמת
  r = await generateDueOrders(q, { dow: 6, date: '2026-10-17' });
  assert.equal(r.created, 0);
  // למחרת (ראשון) — לא מייצר
  r = await generateDueOrders(q, { dow: 0, date: '2026-10-18' });
  assert.equal(r.created, 0);
  // שבת הבאה — מייצר שוב
  r = await generateDueOrders(q, { dow: 6, date: '2026-10-24' });
  assert.equal(r.created, 1);

  const { rows: orders } = await pool.query('SELECT * FROM orders WHERE business_account_id=$1 ORDER BY created_at', [acc.id]);
  assert.equal(orders.length, 2);
  assert.equal(orders[0].pickup_at, null, 'בלי שעת איסוף — pickup_at ריק');
});
