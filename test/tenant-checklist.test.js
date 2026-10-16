// B1: צ'ק-ליסט מוכנות — אחוז השלמה עולה ככל שמשלימים פריטים; חבר מכבסה בלבד
const { test } = require('node:test');
const assert = require('node:assert');
const { Pool } = require('pg');
const { startApp, TEST_DB } = require('./helpers');

async function sql(schema, text, params) {
  const pool = new Pool({ connectionString: TEST_DB, options: `-c search_path=${schema},public` });
  try { return (await pool.query(text, params)).rows; } finally { await pool.end(); }
}

test('checklist: 0% on empty tenant, rises with each item, 100% when full', async (t) => {
  const { api, schema } = await startApp(t);
  const token = await api.login('+972509910001', 'בעלים צקליסט');
  const [u] = await sql(schema, 'SELECT id FROM users WHERE phone=$1', ['+972509910001']);
  const [ten] = await sql(schema,
    `INSERT INTO tenants(slug, name) VALUES ('checkl', 'מכבסת צקליסט') RETURNING id`);
  await sql(schema, `INSERT INTO tenant_members(tenant_id, user_id, role) VALUES ($1,$2,'owner')`, [ten.id, u.id]);

  const get = () => api('/api/t/checkl/checklist', { token });
  let c = await get();
  assert.equal(c.status, 200);
  assert.equal(c.json.percent, 0);
  assert.equal(c.json.total, 7);
  assert.equal(c.json.complete, false);

  await sql(schema, `INSERT INTO price_items(tenant_id, name, price) VALUES ($1,'חולצה',12)`, [ten.id]);
  await sql(schema, `INSERT INTO pickup_windows(tenant_id, weekday, start_time, end_time) VALUES ($1,0,'08:00','12:00')`, [ten.id]);
  c = await get();
  assert.equal(c.json.done, 2);
  assert.equal(c.json.items.find(i => i.key === 'prices').done, true);
  assert.equal(c.json.items.find(i => i.key === 'window').done, true);

  await sql(schema, `UPDATE tenants SET hours='{"0":[["08:00","20:00"]]}', phone='+972501112233',
    address='רחוב הרצל 1 תל אביב', lat=32.08, lng=34.78, logo=decode('89504e47','hex') WHERE id=$1`, [ten.id]);
  c = await get();
  assert.equal(c.json.done, 6);
  assert.equal(c.json.items.find(i => i.key === 'courier').done, false);
  assert.ok(c.json.items.find(i => i.key === 'courier').action.length > 0, 'יש פעולה מתקנת לפריט');

  const [cu] = await sql(schema, 'SELECT id FROM users WHERE phone=$1', ['+972509910001']);
  await sql(schema, `INSERT INTO couriers(user_id, tenant_id) VALUES ($1,$2)`, [cu.id, ten.id]);
  c = await get();
  assert.equal(c.json.percent, 100);
  assert.equal(c.json.complete, true);
});

test('checklist: non-member is rejected', async (t) => {
  const { api } = await startApp(t);
  const outsider = await api.login('+972509910002', 'עובר אורח');
  const r = await api('/api/t/achuza/checklist', { token: outsider });
  assert.equal(r.status, 403);
});
