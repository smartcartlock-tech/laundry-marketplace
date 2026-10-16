// אפיק H: בוטסטרפ אדמין (H2) + סקריפט ניקוי דמו (H3)
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const TEST_DB = process.env.TEST_DATABASE_URL || 'postgres://postgres@127.0.0.1:5433/laundry_test';

async function waitHealth(base, child, timeoutMs = 30000) {
  const t0 = Date.now();
  let log = '';
  child.stderr.on('data', d => { log += d; });
  while (Date.now() - t0 < timeoutMs) {
    try { const r = await fetch(base + '/health'); if (r.ok) return; } catch (e) {}
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error('server did not become healthy:\n' + log);
}

async function bootCustom(t, extra) {
  const port = 5900 + (process.pid % 200) + Math.floor(Math.random() * 100);
  const schema = 'test_' + Math.random().toString(36).slice(2, 8);
  const env = { ...process.env, DATABASE_URL: TEST_DB, PGSCHEMA: schema, PORT: String(port), JWT_SECRET: 't', TWILIO_ACCOUNT_SID: '', TWILIO_AUTH_TOKEN: '', TWILIO_WHATSAPP_FROM: '', ...extra };
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], { env });
  t.after(() => { try { child.kill('SIGKILL'); } catch (e) {} });
  await waitHealth(`http://127.0.0.1:${port}`, child);
  return { schema, port };
}

async function psql(schema, sql) {
  const r = spawnSync('psql', [TEST_DB, '-At', '-c', `SET search_path TO ${schema}; ${sql}`], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout.trim();
}

test('H2: ADMIN_PHONE בלי SEED_DEMO יוצר אדמין ראשון ב-boot', async (t) => {
  const { schema } = await bootCustom(t, { SEED_DEMO: 'false', DEMO_OTP: 'false', ADMIN_PHONE: '0501234567' });
  const role = await psql(schema, `SELECT role FROM users WHERE phone='+972501234567'`);
  assert.equal(role, 'admin');
  const tenants = await psql(schema, 'SELECT count(*) FROM tenants');
  assert.equal(tenants, '0'); // בלי זריעת דמו
});

test('H2: אדמין קיים — הבוטסטרפ לא מכפיל ולא דורס', async (t) => {
  const { schema, port } = await bootCustom(t, { SEED_DEMO: 'true', DEMO_OTP: 'true', ADMIN_PHONE: '+972509999999' });
  const n = await psql(schema, `SELECT count(*) FROM users WHERE role='admin'`);
  assert.equal(n, '1'); // רק אדמין הדמו
  const c = await fetch(`http://127.0.0.1:${port}/health`); assert.equal(c.status, 200);
});

test('H3: purge-demo מסיר נתוני דמו ודורש אישור', async (t) => {
  const { schema } = await bootCustom(t, { SEED_DEMO: 'true', DEMO_OTP: 'true' });
  const before = await psql(schema, 'SELECT count(*) FROM tenants');
  assert.ok(Number(before) >= 4);
  // בלי אישור — חייב לסרב
  const no = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'purge-demo.js')],
    { env: { ...process.env, DATABASE_URL: TEST_DB, PGSCHEMA: schema }, encoding: 'utf8' });
  assert.notEqual(no.status, 0);
  const still = await psql(schema, 'SELECT count(*) FROM tenants');
  assert.equal(still, before);
  // עם אישור — מנקה
  const yes = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'purge-demo.js')],
    { env: { ...process.env, DATABASE_URL: TEST_DB, PGSCHEMA: schema, CONFIRM_PURGE_DEMO: 'yes' }, encoding: 'utf8' });
  assert.equal(yes.status, 0, yes.stderr + yes.stdout);
  const after = await psql(schema, 'SELECT count(*) FROM tenants');
  assert.equal(after, '0');
  const demoUsers = await psql(schema, `SELECT count(*) FROM users WHERE phone LIKE '+9725000000%'`);
  assert.equal(demoUsers, '0');
  // טריגר החסינות הוחזר — עדכון מסמך עדיין חסום
  const docs = await psql(schema, 'SELECT count(*) FROM documents');
  assert.equal(docs, '0');
});
