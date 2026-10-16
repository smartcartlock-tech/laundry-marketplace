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
