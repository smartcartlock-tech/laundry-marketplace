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
  // פורט אפמרלי (0): מערכת ההפעלה מקצה — אפס התנגשויות בין תהליכי בדיקה מקבילים (flakiness)
  const schema = 'test_' + Math.random().toString(36).slice(2, 8);
  const env = {
    ...process.env,
    DATABASE_URL: TEST_DB,
    PGSCHEMA: schema,
    SEED_DEMO: 'true',
    DEMO_OTP: 'true',
    OTP_SCREEN_CODE: 'true', // קוד על המסך רק בסביבת בדיקות
    PORT: '0',
    JWT_SECRET: 'test-secret',
    TWILIO_ACCOUNT_SID: '', TWILIO_AUTH_TOKEN: '', TWILIO_WHATSAPP_FROM: '',
  };
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], { env });
  // הכתובת האמיתית נלמדת משורת הלוג "[server] listening on :NNNN"
  const port = await new Promise((resolve, reject) => {
    let buf = '';
    const to = setTimeout(() => reject(new Error('no listening line; log:\n' + buf)), 30000);
    child.stdout.on('data', d => {
      buf += d;
      const m = buf.match(/\[server\] listening on :(\d+)/);
      if (m) { clearTimeout(to); resolve(Number(m[1])); }
    });
    child.on('exit', () => { clearTimeout(to); reject(new Error('server exited before listen:\n' + buf)); });
  });
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
