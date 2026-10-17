// T18: עריכת טלפון/אימייל עם אימות OTP + חיבור/ניתוק Google (כולל מניעת נעילה וקונפליקטים)
const { test, before } = require('node:test');
const assert = require('node:assert');
const { startApp } = require('./helpers');

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://postgres@127.0.0.1:5433/laundry_test';

let CTX;
before(async (t) => { CTX = await startApp(t); });

test('T18: שינוי טלפון עם אימות; קונפליקט; ולידציות', async () => {
  const { api } = CTX;
  const tok = await api.login('+972500000002');

  // ולידציה: טלפון לא תקין
  assert.equal((await api('/api/me/contact/request', { method: 'POST', token: tok, body: { kind: 'phone', value: '123' } })).status, 400);
  // זהה לנוכחי
  assert.equal((await api('/api/me/contact/request', { method: 'POST', token: tok, body: { kind: 'phone', value: '+972500000002' } })).status, 400);
  // תפוס על ידי משתמש אחר
  assert.equal((await api('/api/me/contact/request', { method: 'POST', token: tok, body: { kind: 'phone', value: '+972500000003' } })).status, 409);

  // זרימה תקינה
  const req = await api('/api/me/contact/request', { method: 'POST', token: tok, body: { kind: 'phone', value: '+972500000777' } });
  assert.equal(req.status, 200, JSON.stringify(req.json));
  assert.ok(req.json.demoCode, 'קוד דמו מוצג');
  // קוד שגוי
  assert.equal((await api('/api/me/contact/confirm', { method: 'POST', token: tok, body: { kind: 'phone', value: '+972500000777', code: '000000' } })).status, 401);
  // קוד נכון
  const cnf = await api('/api/me/contact/confirm', { method: 'POST', token: tok, body: { kind: 'phone', value: '+972500000777', code: req.json.demoCode } });
  assert.equal(cnf.status, 200, JSON.stringify(cnf.json));
  assert.equal(cnf.json.user.phone, '+972500000777');
  const me = await api('/api/auth/me', { token: tok });
  assert.equal(me.json.user.phone, '+972500000777');
});

test('T18: שינוי אימייל עם אימות', async () => {
  const { api } = CTX;
  const tok = await api.login('+972500000002');
  const req = await api('/api/me/contact/request', { method: 'POST', token: tok, body: { kind: 'email', value: 'NewMail@Example.com' } });
  assert.equal(req.status, 200, JSON.stringify(req.json));
  const cnf = await api('/api/me/contact/confirm', { method: 'POST', token: tok, body: { kind: 'email', value: 'newmail@example.com', code: req.json.demoCode } });
  assert.equal(cnf.status, 200, JSON.stringify(cnf.json));
  assert.equal(cnf.json.user.email, 'newmail@example.com');
});

test('T18: Google — סטטוס, ניתוק בלי חיבור, חיבור עם אסימון שגוי', async () => {
  const { api } = CTX;
  const tok = await api.login('+972500000002');
  const st = await api('/api/me/google/status', { token: tok });
  assert.equal(st.status, 200);
  assert.equal(st.json.connected, false);
  assert.equal((await api('/api/me/google/disconnect', { method: 'POST', token: tok })).status, 404);
  const bad = await api('/api/me/google/connect', { method: 'POST', token: tok, body: { credential: 'not-a-real-token' } });
  assert.equal(bad.status, 401);
});
