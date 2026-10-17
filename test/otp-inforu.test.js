// T86: OTP אמיתי דרך Inforu — ספק, תבנית, מספרי דמו, תפוגה, נעילה. בלי SMS אמיתי: שרת stub מקומי.
const { test } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { startApp } = require('./helpers');

// שרת stub שמחקה את Inforu: לוכד בקשות ומחזיר הצלחה
async function startInforuStub(t) {
  const calls = [];
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      calls.push({ auth: req.headers.authorization, body: JSON.parse(body || '{}') });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ StatusId: 1, StatusDescription: 'Success', Data: { Recipients: 1 } }));
    });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  t.after(() => srv.close());
  return { calls, url: `http://127.0.0.1:${srv.address().port}/api/v2/SMS/SendSms` };
}

function inforuEnv(stub) {
  process.env.OTP_PROVIDER = 'inforu';
  process.env.INFORU_USERNAME = 'test-user';
  process.env.INFORU_PASSWORD = 'test-pass';
  process.env.INFORU_BASE_URL = stub.url;
  process.env.SMS_SENDER_ID = 'ClickLndry';
}
function clearInforuEnv() {
  delete process.env.OTP_PROVIDER; delete process.env.INFORU_USERNAME;
  delete process.env.INFORU_PASSWORD; delete process.env.INFORU_BASE_URL;
}

test('T86: מספר דמו (+972500000002) — קוד על המסך, לא נשלח SMS', async (t) => {
  const stub = await startInforuStub(t);
  inforuEnv(stub);
  t.after(clearInforuEnv);
  const { api } = await startApp(t);
  const r = await api('/api/auth/otp/request', { method: 'POST', body: { target: '+972500000002' } });
  assert.equal(r.status, 200);
  assert.equal(r.json.channel, 'demo');
  assert.match(r.json.demoCode, /^\d{6}$/);
  assert.equal(stub.calls.length, 0); // לא נשלח SMS אמיתי למספר דמו
});

test('T86: מספר אמיתי — SMS דרך Inforu, בלי חשיפת קוד בתגובה, וכניסה מלאה', async (t) => {
  const stub = await startInforuStub(t);
  inforuEnv(stub);
  t.after(clearInforuEnv);
  const { api } = await startApp(t);
  const r = await api('/api/auth/otp/request', { method: 'POST', body: { target: '+972501112233' } });
  assert.equal(r.status, 200);
  assert.equal(r.json.channel, 'sms');
  assert.equal(r.json.demoCode, undefined); // אין חשיפת קוד במסך/תגובה למספר אמיתי
  assert.equal(stub.calls.length, 1);
  const call = stub.calls[0];
  assert.ok(call.auth && call.auth.startsWith('Basic ')); // פרטי הכספת ב-Basic auth
  const d = call.body.Data;
  assert.equal(d.Recipients[0].Phone, '0501112233'); // E164 → מקומי
  assert.equal(d.Settings.Sender, 'ClickLndry');
  assert.match(d.Message, /^קוד האימות שלך הוא: \d{6}\. הקוד תקף ל-5 דקות\.$/);
  const code = d.Message.match(/(\d{6})/)[1];
  const v = await api('/api/auth/otp/verify', { method: 'POST', body: { target: '+972501112233', code } });
  assert.equal(v.status, 200);
  assert.ok(v.json.token);
});

test('T86: נעילה אחרי 3 ניסיונות שגויים (MAX_ATTEMPTS_PER_OTP=3)', async (t) => {
  const stub = await startInforuStub(t);
  inforuEnv(stub);
  t.after(clearInforuEnv);
  const { api } = await startApp(t);
  await api('/api/auth/otp/request', { method: 'POST', body: { target: '+972501114444' } });
  const real = stub.calls[0].body.Data.Message.match(/(\d{6})/)[1];
  const wrong = real === '000000' ? '000001' : '000000';
  for (let i = 0; i < 3; i++) {
    const v = await api('/api/auth/otp/verify', { method: 'POST', body: { target: '+972501114444', code: wrong } });
    assert.equal(v.status, 401, 'ניסיון ' + (i + 1));
  }
  const blocked = await api('/api/auth/otp/verify', { method: 'POST', body: { target: '+972501114444', code: real } });
  assert.equal(blocked.status, 429); // נעול גם עם הקוד הנכון
});

test('T86: תפוגה מונעת דרך OTP_EXPIRY_MINUTES (0 = פג מיד)', async (t) => {
  const stub = await startInforuStub(t);
  inforuEnv(stub);
  process.env.OTP_EXPIRY_MINUTES = '0';
  t.after(() => { clearInforuEnv(); delete process.env.OTP_EXPIRY_MINUTES; });
  const { api } = await startApp(t);
  await api('/api/auth/otp/request', { method: 'POST', body: { target: '+972501115555' } });
  const code = stub.calls[0].body.Data.Message.match(/(\d{6})/)[1];
  const v = await api('/api/auth/otp/verify', { method: 'POST', body: { target: '+972501115555', code } });
  assert.equal(v.status, 401); // פג תוקף מיד
  assert.match(stub.calls[0].body.Data.Message, /תקף ל-0 דקות/);
});

test('T86: כשל Inforu → 503 בלי קוד דמו, ובלי SMS במצב provider=inforu', async (t) => {
  // stub שמחזיר כשל
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', c => b += c);
    req.on('end', () => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ StatusId: -1, StatusDescription: 'InvalidSender' })); });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  t.after(() => srv.close());
  process.env.OTP_PROVIDER = 'inforu';
  process.env.INFORU_USERNAME = 'u'; process.env.INFORU_PASSWORD = 'p';
  process.env.INFORU_BASE_URL = `http://127.0.0.1:${srv.address().port}/x`;
  t.after(clearInforuEnv);
  const { api } = await startApp(t);
  const r = await api('/api/auth/otp/request', { method: 'POST', body: { target: '+972501116666' } });
  assert.equal(r.status, 503);
  assert.equal(r.json.demoCode, undefined);
});
