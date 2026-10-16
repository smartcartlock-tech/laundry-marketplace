// הרמת האפליקציה על פורט אקראי מול Postgres בדיקות מקומי, בסכימה מבודדת לכל קובץ בדיקה.
const { spawn } = require('child_process');
const path = require('path');

const TEST_DB = process.env.TEST_DATABASE_URL || 'postgres://postgres@127.0.0.1:5433/laundry_test';

async function waitHealth(base, child, timeoutMs = 30000) {
  const t0 = Date.now();
  let log = '';
  child.stdout.on('data', d => { log += d; });
  child.stderr.on('data', d => { log += d; });
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(base + '/health');
      if (r.ok) return;
    } catch (e) { /* not up yet */ }
    if (child.exitCode !== null) throw new Error('server exited early:\n' + log);
    await new Promise(r => setTimeout(r, 400));
  }
  throw new Error('server did not become healthy:\n' + log);
}

async function startApp(t) {
  const port = 4600 + (process.pid % 300) + Math.floor(Math.random() * 100);
  const schema = 'test_' + Math.random().toString(36).slice(2, 8);
  const env = {
    ...process.env,
    DATABASE_URL: TEST_DB,
    PGSCHEMA: schema,
    SEED_DEMO: 'true',
    DEMO_OTP: 'true',
    PORT: String(port),
    JWT_SECRET: 'test-secret',
    TWILIO_ACCOUNT_SID: '', TWILIO_AUTH_TOKEN: '', TWILIO_WHATSAPP_FROM: '',
  };
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], { env });
  const base = `http://127.0.0.1:${port}`;
  t.after(() => { try { child.kill('SIGKILL'); } catch (e) {} });
  await waitHealth(base, child);
  const api = async (p, { method = 'GET', token, apiKey, body } = {}) => {
    const headers = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (token) headers.authorization = 'Bearer ' + token;
    if (apiKey) headers['x-api-key'] = apiKey;
    const r = await fetch(base + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    let json = null;
    try { json = await r.json(); } catch (e) {}
    return { status: r.status, json };
  };
  api.login = async (phone, name) => {
    const req = await api('/api/auth/otp/request', { method: 'POST', body: { target: phone } });
    if (!req.json || !req.json.demoCode) throw new Error('no demoCode: ' + JSON.stringify(req.json));
    const ver = await api('/api/auth/otp/verify', { method: 'POST', body: { target: phone, code: req.json.demoCode, name } });
    if (!ver.json || !ver.json.token) throw new Error('login failed: ' + JSON.stringify(ver.json));
    await api('/api/auth/consent', { method: 'POST', token: ver.json.token }); // C4: הסכמה אוטומטית בטסטים
    return ver.json.token;
  };
  return { base, api, schema };
}

module.exports = { startApp, TEST_DB };
