// ניטור תקלות: endpoint אדמין ליומן שגיאות + התנהגות 4xx/5xx של ה-middleware.
const test = require('node:test');
const assert = require('node:assert');
const { startApp } = require('./helpers');

test('GET /api/admin/errors דורש אדמין ומחזיר מבנה תקין', async (t) => {
  const { api } = await startApp(t);
  const noAuth = await api('/api/admin/errors');
  assert.equal(noAuth.status, 401);
  const token = await api.login('+972500000001'); // אדמין דמו
  const ok = await api('/api/admin/errors', { token });
  assert.equal(ok.status, 200);
  assert.ok(Array.isArray(ok.json.errors));
});

test('JSON שבור מחזיר 400 ולא נרשם כתקלת שרת', async (t) => {
  const { base, api } = await startApp(t);
  const r = await fetch(base + '/api/auth/otp/request', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{not json',
  });
  assert.equal(r.status, 400);
  const token = await api.login('+972500000001');
  const log = await api('/api/admin/errors', { token });
  assert.equal(log.status, 200);
  assert.equal(log.json.errors.length, 0, 'שגיאת לקוח לא אמורה להירשם ביומן');
});
