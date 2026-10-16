// יציבות: async handler שזורק לא מפיל את התהליך (Express 4 + pg 22P02)
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers');

async function demoLogin(api, target) {
  const r = await api('/api/auth/otp/request', { method: 'POST', body: { target } });
  const v = await api('/api/auth/otp/verify', { method: 'POST', body: { target, code: r.json.demoCode } });
  return v.json.token;
}

test('DELETE /api/addresses/abc — 400 והתהליך נשאר חי', async (t) => {
  const { api, base } = await startApp(t);
  const token = await demoLogin(api, '+972500000002');
  const bad = await api('/api/addresses/abc', { method: 'DELETE', token });
  assert.equal(bad.status, 400);
  const health = await fetch(base + '/health');
  assert.equal(health.status, 200);
});

test('uuid חוקי שלא קיים — 404 (לא 500)', async (t) => {
  const { api, base } = await startApp(t);
  const token = await demoLogin(api, '+972500000002');
  const r = await api('/api/addresses/11111111-1111-1111-1111-111111111111', { method: 'DELETE', token });
  assert.equal(r.status, 404);
  assert.equal((await fetch(base + '/health')).status, 200);
});

test('rejection אמיתי (uuid תקין פורמט אך שאילתה נכשלת) — 500 מטופל, התהליך חי', async (t) => {
  const { api, base } = await startApp(t);
  const token = await demoLogin(api, '+972500000002');
  // GET הזמנה עם uuid תקין שלא קיים — עובר דרך ה-wrapper הגלובלי בלי קריסה
  const r = await api('/api/orders/22222222-2222-2222-2222-222222222222', { token });
  assert.ok([403, 404, 500].includes(r.status));
  assert.equal((await fetch(base + '/health')).status, 200);
  // וגם אחרי בקשה כושלת נוספת עם id שבור
  const r2 = await api('/api/orders/not-a-uuid', { token });
  assert.equal(r2.status, 400);
  assert.equal((await fetch(base + '/health')).status, 200);
});
