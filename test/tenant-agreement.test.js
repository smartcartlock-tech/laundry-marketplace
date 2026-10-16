// B4: הסכם שירות דיגיטלי — קריאה, אישור גרסה, אידמפוטנטיות, שגיאת גרסה, היסגלות אדמין
const { test } = require('node:test');
const assert = require('node:assert');
const { Pool } = require('pg');
const { startApp, TEST_DB } = require('./helpers');

test('agreement: read, accept, idempotent, version mismatch, admin pipeline sees it', async (t) => {
  const { api, schema } = await startApp(t);
  const pool = new Pool({ connectionString: TEST_DB, options: `-c search_path=${schema},public` });
  t.after(() => pool.end());
  const token = await api.login('+972509940001', 'בעלים הסכם');
  const [u] = (await pool.query('SELECT id FROM users WHERE phone=$1', ['+972509940001'])).rows;
  const [ten] = (await pool.query(`INSERT INTO tenants(slug, name) VALUES ('agree1', 'מכבסת הסכם') RETURNING id`)).rows;
  await pool.query(`INSERT INTO tenant_members(tenant_id, user_id, role) VALUES ($1,$2,'owner')`, [ten.id, u.id]);

  let g = await api('/api/t/agree1/agreement', { token });
  assert.equal(g.status, 200);
  assert.ok(g.json.version && g.json.text.length > 100);
  assert.equal(g.json.accepted_at, null);

  const bad = await api('/api/t/agree1/agreement/accept', { method: 'POST', token, body: { version: '0.9' } });
  assert.equal(bad.status, 409, 'גרסה ישנה נדחית');

  const ok = await api('/api/t/agree1/agreement/accept', { method: 'POST', token, body: { version: g.json.version } });
  assert.equal(ok.status, 200);
  assert.ok(ok.json.accepted_at);

  const again = await api('/api/t/agree1/agreement/accept', { method: 'POST', token, body: { version: g.json.version } });
  assert.equal(again.json.already, true, 'אישור חוזר אידמפוטנטי');

  g = await api('/api/t/agree1/agreement', { token });
  assert.ok(g.json.accepted_at && g.json.accepted_version === g.json.version);

  const admin = await api.login('+972500000001', 'אדמין');
  const pipe = await api('/api/admin/onboarding', { token: admin });
  const row = pipe.json.tenants.find(x => x.id === ten.id);
  assert.ok(row, 'המכבסה מופיעה בצינור הקליטה');
  assert.equal(row.stage, 'agreement', 'המכבסה בשלב agreement עד שהאדמין מקדם');
  assert.ok(row.accepted_terms_at, 'האדמין רואה שההסכם אושר בשלב agreement');

  const outsider = await api.login('+972509940002', 'עובר אורח');
  const denied = await api('/api/t/agree1/agreement', { token: outsider });
  assert.equal(denied.status, 403);
});
