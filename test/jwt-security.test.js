// B1: JWT — תוקף 7 ימים, ביטול גלובלי ב-logout (token_version), דחיית טוקן מזויף
const { test } = require('node:test');
const assert = require('node:assert');
const jwt = require('jsonwebtoken');
const { startApp } = require('./helpers');

test('B1: תוקף הטוקן 7 ימים', async (t) => {
  const { api } = await startApp(t);
  const token = await api.login('+972500000501');
  const payload = jwt.decode(token);
  const days = (payload.exp - payload.iat) / 86400;
  assert.ok(Math.abs(days - 7) < 0.05, 'תוקף בפועל: ' + days + ' ימים');
});

test('B1: logout מבטל את כל הטוקנים; התחברות חדשה עובדת', async (t) => {
  const { api } = await startApp(t);
  const phone = '+972500000502';
  const token = await api.login(phone);
  const before = await api('/api/auth/me', { token });
  assert.equal(before.status, 200);

  const out = await api('/api/auth/logout', { method: 'POST', token });
  assert.equal(out.status, 200);

  const after = await api('/api/auth/me', { token });
  assert.equal(after.status, 401, 'טוקן ישן מת אחרי logout');
  assert.match(after.json.error, /בוטלה/);

  const fresh = await api.login(phone);
  const again = await api('/api/auth/me', { token: fresh });
  assert.equal(again.status, 200, 'התחברות חדשה מקבלת טוקן תקף');
});

test('B1: טוקן שחתום בסוד ברירת-מחדל הישן נדחה', async (t) => {
  const { api } = await startApp(t);
  const token = await api.login('+972500000503');
  const { uid } = jwt.decode(token);
  const forged = jwt.sign({ uid, tv: 0 }, 'dev-insecure-secret', { expiresIn: '7d' });
  const r = await api('/api/auth/me', { token: forged });
  assert.equal(r.status, 401);
});

test('B1: טוקן ללא tv (דור קודם) נדחה', async (t) => {
  const { api } = await startApp(t);
  const token = await api.login('+972500000504');
  const { uid } = jwt.decode(token);
  const legacy = jwt.sign({ uid }, 'test-secret', { expiresIn: '7d' });
  const r = await api('/api/auth/me', { token: legacy });
  assert.equal(r.status, 401);
});
