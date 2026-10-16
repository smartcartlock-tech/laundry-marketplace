const { test } = require('node:test');
const assert = require('node:assert');
const { startApp } = require('./helpers');

test('auth: OTP דמו מלא + /me + הרשאות', async (t) => {
  const { api } = await startApp(t);

  const req = await api('/api/auth/otp/request', { method: 'POST', body: { target: '050-1234567' } });
  assert.equal(req.status, 200);
  assert.equal(req.json.channel, 'demo');
  assert.match(req.json.demoCode, /^\d{6}$/);

  const bad = await api('/api/auth/otp/verify', { method: 'POST', body: { target: '050-1234567', code: '000000' } });
  assert.equal(bad.status, 401);

  const ver = await api('/api/auth/otp/verify', { method: 'POST', body: { target: '050-1234567', code: req.json.demoCode, name: 'בודק בדיקות' } });
  assert.equal(ver.status, 200);
  assert.ok(ver.json.token);
  assert.equal(ver.json.user.phone, '+972501234567');
  assert.equal(ver.json.user.name, 'בודק בדיקות');

  const me = await api('/api/auth/me', { token: ver.json.token });
  assert.equal(me.status, 200);
  assert.equal(me.json.user.phone, '+972501234567');

  const noAuth = await api('/api/orders/mine');
  assert.equal(noAuth.status, 401);

  const badToken = await api('/api/orders/mine', { token: 'garbage' });
  assert.equal(badToken.status, 401);
});

// QA2.T1: שם קיים לא נדרס בשתיקה בכניסה חוזרת
test('auth: כניסה עם שם אחר לא דורסת שם קיים', async (t) => {
  const { api } = await startApp(t);
  // יצירת משתמש חדש עם שם
  const req1 = await api('/api/auth/otp/request', { method: 'POST', body: { target: '+972500000042' } });
  const v1 = await api('/api/auth/otp/verify', { method: 'POST', body: { target: '+972500000042', code: req1.json.demoCode, name: 'שם מקורי' } });
  assert.strictEqual(v1.json.user.name, 'שם מקורי');
  // כניסה חוזרת עם שם אחר — לא דורס
  const req2 = await api('/api/auth/otp/request', { method: 'POST', body: { target: '+972500000042' } });
  const v2 = await api('/api/auth/otp/verify', { method: 'POST', body: { target: '+972500000042', code: req2.json.demoCode, name: 'שם חדש מתחזה' } });
  assert.strictEqual(v2.json.user.name, 'שם מקורי');
  // השלמת שם למשתמש בלי שם — עובדת
  const req3 = await api('/api/auth/otp/request', { method: 'POST', body: { target: '+972500000043' } });
  await api('/api/auth/otp/verify', { method: 'POST', body: { target: '+972500000043', code: req3.json.demoCode } });
  const req4 = await api('/api/auth/otp/request', { method: 'POST', body: { target: '+972500000043' } });
  const v4 = await api('/api/auth/otp/verify', { method: 'POST', body: { target: '+972500000043', code: req4.json.demoCode, name: 'השלמה' } });
  assert.strictEqual(v4.json.user.name, 'השלמה');
});
