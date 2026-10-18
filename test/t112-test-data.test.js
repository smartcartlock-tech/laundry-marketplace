// T112: טנאנטי בדיקות מוסתרים מהמרקטפלייס, ביקורת עצמית חסומה, אישור מכבסה דורש שעות פעילות
const { test } = require('node:test');
const assert = require('node:assert');
const { Pool } = require('pg');
const { startApp, TEST_DB } = require('./helpers');
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5433/laundry_test';

test('T112: is_test מוסתר מהרשימה הציבורית, ביקורת עצמית 403, אישור בלי שעות 409', async (t) => {
  const { api, schema } = await startApp(t);
  const pool = new Pool({ connectionString: TEST_DB, options: `-c search_path=${schema},public` });
  t.after(() => pool.end());

  // טנאנט שמסומן כבדיקה לא מופיע ברשימה הציבורית
  await pool.query(`INSERT INTO tenants(slug, name, approved, is_open, is_test, hours) VALUES ('t112-test-l', 'מכבסת בדיקה T112', true, true, true, '{"0":[["08:00","18:00"]]}')`);
  const list = await api('/api/laundries');
  assert.equal(list.status, 200);
  assert.ok(!list.json.laundries.some(l => l.slug === 't112-test-l'), 'טנאנט is_test מוסתר מהרשימה');
  assert.ok(list.json.laundries.length >= 1, 'טנאנטים אמיתיים ממשיכים להופיע');

  // אישור מכבסה בלי שעות → 409; עם שעות → 200
  const admin = await api.login('+972500000001');
  const owner = await api.login('+972500000003');
  // T106: רישום דרך ה-API כבר דורש שעות+חלון החזרה — לכן ה-fixture של "בלי שעות" נוצר ישירות ב-DB
  const [t112] = (await pool.query(
    `INSERT INTO tenants(slug, name, phone, address, city, approved) VALUES ('t112-nh', 'מכבסת T112', '03-5559999', 'רחוב 1', 'חיפה', false) RETURNING id, slug`)).rows;
  const [ownerRow] = (await pool.query(`SELECT id FROM users WHERE phone='+972500000003'`)).rows;
  await pool.query(`INSERT INTO tenant_members(tenant_id, user_id, role) VALUES ($1,$2,'owner')`, [t112.id, ownerRow.id]);
  const noHours = await api(`/api/admin/tenants/${t112.id}/approve`, { method: 'POST', token: admin });
  assert.equal(noHours.status, 409, 'אישור בלי שעות נחסם');
  const hs = await api(`/api/t/${t112.slug}/settings`, { method: 'PATCH', token: owner, body: { hours: { '1': [['09:00', '17:00']] } } });
  assert.equal(hs.status, 200, JSON.stringify(hs.json));
  const ok = await api(`/api/admin/tenants/${t112.id}/approve`, { method: 'POST', token: admin });
  assert.equal(ok.status, 200, 'אישור עם שעות עובר');

  // ביקורת עצמית: הבעלים יוצר הזמנה אצל עצמו ומנסה לדרג → 403
  const pub = await api('/api/laundries/achuza');
  const item = pub.json.items[0];
  const order = await api('/api/t/achuza/orders', { method: 'POST', token: owner, body: {
    items: [{ item_id: item.id, qty: 1 }], address: 'הרצל 1', pickup_window: 'morning', payment: 'cash' } });
  if (order.status === 201) {
    await pool.query(`UPDATE orders SET status='delivered' WHERE id=$1`, [order.json.order.id]);
    const rv = await api(`/api/orders/${order.json.order.id}/review`, { method: 'POST', token: owner, body: { rating: 5, text: 'ביקורת עצמית' } });
    assert.equal(rv.status, 403, 'ביקורת עצמית נחסמת');
  }
});
