// B2: בקשת הצטרפות ציבורית — שמירה בלבד, honeypot, הגבלת קצב, תור אדמין, המרה/דחייה
const { test } = require('node:test');
const assert = require('node:assert');
const { Pool } = require('pg');
const { startApp, TEST_DB } = require('./helpers');

const apply = (api, body) => api('/api/apply', { method: 'POST', body });

test('public application: saved, validated, honeypot silently swallowed', async (t) => {
  const { api, schema } = await startApp(t);
  const pool = new Pool({ connectionString: TEST_DB, options: `-c search_path=${schema},public` });
  t.after(() => pool.end());

  let r = await apply(api, { name: 'מכבסת הדרום', city: 'באר שבע', phone: '050-1234567', est_orders: 120 });
  assert.equal(r.status, 201);
  assert.ok(r.json.id);
  const rows = (await pool.query('SELECT * FROM tenant_applications')).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'pending');
  assert.equal(rows[0].est_orders, 120);

  r = await apply(api, { name: 'x', city: 'תל אביב', phone: '0501234567' });
  assert.equal(r.status, 400, 'שם קצר מדי');
  r = await apply(api, { name: 'מכבסה', city: 'תל אביב', phone: 'abc' });
  assert.equal(r.status, 400, 'טלפון לא תקין');
  r = await apply(api, { name: 'מכבסה', phone: '0501234567' });
  assert.equal(r.status, 400, 'עיר חסרה');

  r = await apply(api, { name: 'בוט חשוד', city: 'חיפה', phone: '0501234567', website: 'http://spam' });
  assert.equal(r.status, 200, 'honeypot מקבל תשובת הצלחה שקטה');
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM tenant_applications')).rows[0].n, 1, 'honeypot לא נשמר');
});

test('admin queue: list, convert to tenant (idempotent), reject; non-admin blocked', async (t) => {
  const { api, schema } = await startApp(t);
  const pool = new Pool({ connectionString: TEST_DB, options: `-c search_path=${schema},public` });
  t.after(() => pool.end());
  const admin = await api.login('+972500000001', 'אדמין');
  const outsider = await api.login('+972509930001', 'רגיל');

  await apply(api, { name: 'מכבסת הצפון', city: 'חיפה', phone: '0527654321' });
  await apply(api, { name: 'מכבסת המרכז', city: 'פתח תקווה', phone: '0531112223' });

  let r = await api('/api/admin/applications', { token: outsider });
  assert.equal(r.status, 403);

  const list = await api('/api/admin/applications', { token: admin });
  assert.equal(list.json.applications.length, 2);
  const first = list.json.applications.find(a => a.laundry_name === 'מכבסת הצפון');

  const conv = await api(`/api/admin/applications/${first.id}/convert`, { method: 'POST', token: admin, body: {} });
  assert.equal(conv.status, 200);
  assert.ok(conv.json.tenant_id);
  const tenants = (await pool.query('SELECT * FROM tenants WHERE id=$1', [conv.json.tenant_id])).rows;
  assert.equal(tenants[0].approved, false, 'מכבסה חדשה ממתינה לאישור רגיל');
  assert.equal(tenants[0].city, 'חיפה');

  const conv2 = await api(`/api/admin/applications/${first.id}/convert`, { method: 'POST', token: admin, body: {} });
  assert.equal(conv2.json.tenant_id, conv.json.tenant_id, 'המרה חוזרת אידמפוטנטית');

  const second = list.json.applications.find(a => a.laundry_name === 'מכבסת המרכז');
  const rej = await api(`/api/admin/applications/${second.id}/reject`, { method: 'POST', token: admin, body: {} });
  assert.equal(rej.status, 200);
  const conv3 = await api(`/api/admin/applications/${second.id}/convert`, { method: 'POST', token: admin, body: {} });
  assert.equal(conv3.status, 409, 'נדחתה — לא ניתן להמיר');
});
