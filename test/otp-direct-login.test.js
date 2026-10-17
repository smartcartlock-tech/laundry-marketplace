// חיים 17.10 23:38: מספרי דמו 002/003/004/031 — כניסה ישירה בלי קוד/SMS בפרוד; 001 (מנהל) וכל השאר — SMS.
// הבדיקות כאן מריצות שרת בלי OTP_SCREEN_CODE (= התנהגות פרוד) ומול stub של Inforu.
const { test } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { TEST_DB } = require('./helpers');

async function startInforuStub(t) {
  const calls = [];
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', c => b += c);
    req.on('end', () => { calls.push(JSON.parse(b || '{}')); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ StatusId: 1, StatusDescription: 'Success', Data: { Recipients: 1 } })); });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  t.after(() => srv.close());
  return { calls, url: `http://127.0.0.1:${srv.address().port}/x` };
}

// כמו helpers.startApp אבל בלי OTP_SCREEN_CODE ובלי ה-demoCode (מדמה פרוד)
async function startProdApp(t, extraEnv = {}) {
  const schema = 'test_' + Math.random().toString(36).slice(2, 8);
  const env = {
    ...process.env,
    DATABASE_URL: TEST_DB, PGSCHEMA: schema, SEED_DEMO: 'true', DEMO_OTP: 'true',
    PORT: '0', JWT_SECRET: 'test-secret',
    TWILIO_ACCOUNT_SID: '', TWILIO_AUTH_TOKEN: '', TWILIO_WHATSAPP_FROM: '',
    BOT_OUTBOUND_URL: '', BOT_OUTBOUND_KEY: '',
    OTP_PROVIDER: 'inforu',
    ...extraEnv,
  };
  delete env.OTP_SCREEN_CODE;
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], { env });
  const port = await new Promise((resolve, reject) => {
    let buf = '';
    const to = setTimeout(() => reject(new Error('no listening line:\n' + buf)), 30000);
    child.stdout.on('data', d => { buf += d; const m = buf.match(/\[server\] listening on :(\d+)/); if (m) { clearTimeout(to); resolve(Number(m[1])); } });
    child.on('exit', () => { clearTimeout(to); reject(new Error('exit:\n' + buf)); });
  });
  t.after(() => { try { child.kill('SIGKILL'); } catch (e) {} });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 50; i++) { try { const r = await fetch(base + '/health'); if (r.ok) break; } catch (e) {} await new Promise(r => setTimeout(r, 200)); }
  const api = async (p, { method = 'GET', token, body } = {}) => {
    const headers = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (token) headers.authorization = 'Bearer ' + token;
    const r = await fetch(base + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    let json = null; try { json = await r.json(); } catch (e) {}
    return { status: r.status, json };
  };
  return { api };
}

test('כניסה ישירה: 002/003/004/031 — טוקן מיד, בלי קוד, בלי SMS', async (t) => {
  const stub = await startInforuStub(t);
  const { api } = await startProdApp(t, { INFORU_USERNAME: 'u', INFORU_PASSWORD: 'p', INFORU_BASE_URL: stub.url });
  for (const phone of ['+972500000002', '+972500000003', '+972500000004', '+972500000031']) {
    const r = await api('/api/auth/otp/request', { method: 'POST', body: { target: phone } });
    assert.equal(r.status, 200, phone);
    assert.equal(r.json.direct, true, phone);
    assert.ok(r.json.token, phone);
    assert.equal(r.json.demoCode, undefined, phone + ' — בלי הצגת קוד');
    const me = await api('/api/auth/me', { token: r.json.token });
    assert.equal(me.status, 200, phone + ' — טוקן עובד');
  }
  assert.equal(stub.calls.length, 0); // לא נשלח אף SMS למספרי דמו
});

test('001 מנהל ו-005 לא בכניסה ישירה — SMS בלבד, בלי קוד על המסך', async (t) => {
  const stub = await startInforuStub(t);
  const { api } = await startProdApp(t, { INFORU_USERNAME: 'u', INFORU_PASSWORD: 'p', INFORU_BASE_URL: stub.url });
  for (const phone of ['+972500000001', '+972500000005', '+972501119999']) {
    const r = await api('/api/auth/otp/request', { method: 'POST', body: { target: phone } });
    assert.equal(r.status, 200, phone);
    assert.equal(r.json.channel, 'sms', phone);
    assert.equal(r.json.token, undefined, phone + ' — אין כניסה ישירה');
    assert.equal(r.json.demoCode, undefined, phone + ' — בלי הצגת קוד');
  }
  assert.equal(stub.calls.length, 3); // SMS נשלח לכל אחד
});

test('001 מנהל עם קוד קבוע (ADMIN_STATIC_CODE): בלי SMS, נעילה אחרי 3, כניסה עם הקוד', async (t) => {
  const stub = await startInforuStub(t);
  const { api } = await startProdApp(t, { INFORU_USERNAME: 'u', INFORU_PASSWORD: 'p', INFORU_BASE_URL: stub.url, ADMIN_STATIC_CODE: 'S3cret-Adm1n' });
  const r = await api('/api/auth/otp/request', { method: 'POST', body: { target: '+972500000001' } });
  assert.equal(r.status, 200);
  assert.equal(r.json.channel, 'static');
  assert.equal(r.json.demoCode, undefined);
  assert.equal(r.json.token, undefined);
  assert.equal(stub.calls.length, 0); // לא נשלח SMS למנהל
  // 3 ניסיונות שגויים → נעילה (429) גם עם הקוד הנכון
  for (let i = 0; i < 3; i++) {
    const v = await api('/api/auth/otp/verify', { method: 'POST', body: { target: '+972500000001', code: 'wrong' } });
    assert.equal(v.status, 401, 'ניסיון ' + (i + 1));
  }
  const blocked = await api('/api/auth/otp/verify', { method: 'POST', body: { target: '+972500000001', code: 'S3cret-Adm1n' } });
  assert.equal(blocked.status, 429);
  // חלון חדש: בקשה חדשה → הקוד הקבוע נכנס
  const r2 = await api('/api/auth/otp/request', { method: 'POST', body: { target: '+972500000001' } });
  assert.equal(r2.status, 200);
  const v2 = await api('/api/auth/otp/verify', { method: 'POST', body: { target: '+972500000001', code: 'S3cret-Adm1n' } });
  assert.equal(v2.status, 200);
  assert.ok(v2.json.token);
  const me = await api('/api/auth/me', { token: v2.json.token });
  assert.equal(me.json.user.phone, '+972500000001');
});
