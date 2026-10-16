// A2: APP_MODE=demo|pilot — ב-pilot: בלי הזרעה, בלי הצגת קוד OTP, בלי תשלום דמו; ב-demo אין שינוי
const { test } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const path = require('path');
const { startApp, TEST_DB } = require('./helpers');

async function startWithMode(t, mode) {
  const port = 5300 + (process.pid % 200) + Math.floor(Math.random() * 90);
  const schema = 'test_' + Math.random().toString(36).slice(2, 8);
  const env = { ...process.env, DATABASE_URL: TEST_DB, PGSCHEMA: schema, SEED_DEMO: 'true', DEMO_OTP: 'true',
    PORT: String(port), JWT_SECRET: 'test-secret', APP_MODE: mode, TWILIO_ACCOUNT_SID: '', TWILIO_AUTH_TOKEN: '', TWILIO_WHATSAPP_FROM: '' };
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], { env });
  const base = `http://127.0.0.1:${port}`;
  t.after(() => { try { child.kill('SIGKILL'); } catch (e) {} });
  const t0 = Date.now();
  while (Date.now() - t0 < 30000) {
    try { const r = await fetch(base + '/health'); if (r.ok) break; } catch (e) {}
    if (child.exitCode !== null) throw new Error('server exited early');
    await new Promise(r => setTimeout(r, 400));
  }
  return base;
}

test('pilot mode: no demo seed, no demoCode, demo pay blocked', async (t) => {
  const base = await startWithMode(t, 'pilot');

  const cfg = await (await fetch(base + '/api/config')).json();
  assert.equal(cfg.mode, 'pilot');
  assert.equal(cfg.demoOtp, false, 'אין הצגת קוד ב-pilot');

  const laundries = await (await fetch(base + '/api/laundries')).json();
  assert.equal(laundries.laundries.length, 0, 'אין הזרעת דמו ב-pilot');

  const otp = await (await fetch(base + '/api/auth/otp/request', { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ target: '+972509990001' }) })).json();
  assert.equal(otp.demoCode, undefined, 'קוד OTP לא מוחזר ב-pilot');

  const pay = await fetch(base + '/api/pay/00000000-0000-0000-0000-000000000000');
  assert.equal(pay.status, 403, 'דף תשלום דמו חסום ב-pilot');
});

test('demo mode (default): behavior unchanged', async (t) => {
  const { api } = await startApp(t);
  const cfg = await api('/api/config');
  assert.equal(cfg.json.mode, 'demo');
  assert.equal(cfg.json.demoOtp, true);
  const laundries = await api('/api/laundries');
  assert.ok(laundries.json.laundries.length >= 4, 'demo seed active');
});
