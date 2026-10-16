// G5: הגנת is_demo על purge-demo — נוגע רק בנתוני דמו ונעצר על קשר לטננט שאינו דמו.
const { test } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const path = require('path');
const { Pool } = require('pg');
const { startApp, TEST_DB } = require('./helpers');

function runPurge(schema) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'scripts', 'purge-demo.js')], {
      env: { ...process.env, DATABASE_URL: TEST_DB, PGSCHEMA: schema, CONFIRM_PURGE_DEMO: 'yes' },
    });
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { out += d; });
    child.on('close', code => resolve({ code, out }));
  });
}

test('purge-demo: עוצר על משתמש דמו הקשור לטננט שאינו דמו, ומנקה רק is_demo', async (t) => {
  const { schema } = await startApp(t);
  const pool = new Pool({ connectionString: TEST_DB, options: `-c search_path=${schema},public` });
  t.after(async () => { await pool.end().catch(() => {}); });

  // טננט "אמיתי" (לא דמו) + משתמש הדמו 003 משויך אליו כבעלים — מדמה את מכבסת הפטור עם הנה"ח
  const { rows: [realT] } = await pool.query(
    `INSERT INTO tenants(slug, name, letter, approved, is_demo) VALUES ('real-biz', 'עסק אמיתי', 'ע', true, false) RETURNING id`);
  const { rows: [demoU] } = await pool.query(`SELECT id FROM users WHERE phone='+972500000003'`);
  assert.ok(demoU, 'משתמש דמו 003 קיים מהזרעה');
  await pool.query('INSERT INTO tenant_members(tenant_id, user_id, role) VALUES ($1,$2,$3)', [realT.id, demoU.id, 'owner']);
  const { rows: before } = await pool.query('SELECT count(*)::int n FROM tenants WHERE is_demo');
  assert.ok(before[0].n >= 4, 'הוזרעו לפחות 4 טננטי דמו');

  // הרצה 1: חייבת להיעצר ולא למחוק דבר
  const blocked = await runPurge(schema);
  assert.equal(blocked.code, 1, blocked.out);
  assert.match(blocked.out, /שאינם דמו/);
  const { rows: stillThere } = await pool.query(
    `SELECT
       (SELECT count(*)::int FROM tenants WHERE is_demo) AS demo_tenants,
       (SELECT count(*)::int FROM tenants WHERE id=$1) AS real_tenant,
       (SELECT count(*)::int FROM users WHERE id=$2) AS demo_user`, [realT.id, demoU.id]);
  assert.ok(stillThere[0].demo_tenants >= 4, 'טננטי הדמו לא נמחקו');
  assert.equal(stillThere[0].real_tenant, 1, 'הטננט האמיתי לא נמחק');
  assert.equal(stillThere[0].demo_user, 1, 'משתמש הדמו לא נמחק');

  // הרצה 2: אחרי ניתוק הקשר — מנקה דמו בלבד; הטננט האמיתי נשאר
  await pool.query('DELETE FROM tenant_members WHERE tenant_id=$1 AND user_id=$2', [realT.id, demoU.id]);
  const cleaned = await runPurge(schema);
  assert.equal(cleaned.code, 0, cleaned.out);
  const { rows: after } = await pool.query(
    `SELECT
       (SELECT count(*)::int FROM tenants WHERE is_demo) AS demo_tenants,
       (SELECT count(*)::int FROM tenants WHERE id=$1) AS real_tenant,
       (SELECT count(*)::int FROM users WHERE is_demo) AS demo_users`, [realT.id]);
  assert.equal(after[0].demo_tenants, 0, 'טננטי הדמו נוקו');
  assert.equal(after[0].demo_users, 0, 'משתמשי הדמו נוקו');
  assert.equal(after[0].real_tenant, 1, 'הטננט האמיתי שרד');
});
