// CX-D2: PATCH /api/me — עדכון שם מלא: ולידציה, אימות, עדכון בפועל.
const { test } = require('node:test');
const assert = require('node:assert');
const { startApp } = require('./helpers');

test('account-hub: PATCH /api/me מעדכן שם, דוחה קלט פסול וללא אימות', async (t) => {
  const { api } = await startApp(t);
  const tok = await api.login('+972500000002');

  const noauth = await api('/api/me', { method: 'PATCH', body: { name: 'שם חדש' } });
  assert.strictEqual(noauth.status, 401);

  const short = await api('/api/me', { method: 'PATCH', token: tok, body: { name: 'א' } });
  assert.strictEqual(short.status, 400);

  const ok = await api('/api/me', { method: 'PATCH', token: tok, body: { name: 'לקוחה לדמו' } });
  assert.strictEqual(ok.status, 200, JSON.stringify(ok.json));
  assert.strictEqual(ok.json.user.name, 'לקוחה לדמו');

  const me = await api('/api/auth/me', { token: tok });
  assert.strictEqual(me.json.user.name, 'לקוחה לדמו');
});
