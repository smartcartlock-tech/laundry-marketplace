// בדיקות חוזה API: ולידציה, קודי שגיאה, גבולות. בדיקות עם todo = ליקוי ידוע שטרם תוקן (לא מכשילות את הסוויטה; להסיר todo אחרי תיקון).
const { test } = require('node:test');
const assert = require('node:assert');
const { startApp } = require('./helpers');

const raw = async (base, p, { method = 'GET', body, token, timeout = 3000 } = {}) => {
  const ac = new AbortController(); const to = setTimeout(() => ac.abort(), timeout);
  try {
    const r = await fetch(base + p, { method, signal: ac.signal, headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: 'Bearer ' + token } : {}) }, body });
    await r.arrayBuffer(); return r.status;
  } catch (e) { return 'NORESP'; } finally { clearTimeout(to); }
};
const alive = async (base) => { try { return (await fetch(base + '/health')).ok; } catch (e) { return false; } };

test('auth required: protected endpoints return 401 without token', async (t) => {
  const { base } = await startApp(t);
  for (const [m, p] of [['GET', '/api/orders/mine'], ['POST', '/api/orders'], ['GET', '/api/t/achuza/orders'], ['GET', '/api/admin/overview'], ['GET', '/api/addresses'], ['PUT', '/api/cart']]) {
    assert.strictEqual(await raw(base, p, { method: m, body: m === 'GET' ? undefined : '{}' }), 401, m + ' ' + p);
  }
});

test('malformed JSON -> 400, unknown api path -> 404', async (t) => {
  const { base } = await startApp(t);
  assert.strictEqual(await raw(base, '/api/auth/otp/request', { method: 'POST', body: '{bad' }), 400);
  assert.strictEqual(await raw(base, '/api/nope'), 404);
});

test('otp request/verify input validation', async (t) => {
  const { api } = await startApp(t);
  for (const target of [undefined, '', 'abc@', '123', '+1555', { a: 1 }]) {
    const r = await api('/api/auth/otp/request', { method: 'POST', body: { target } });
    assert.strictEqual(r.status, 400, JSON.stringify(target));
  }
  const v = await api('/api/auth/otp/verify', { method: 'POST', body: { target: '+972500000042', code: { a: 1 } } });
  assert.strictEqual(v.status, 401);
});

test('input boundaries: orders/cart/addresses', async (t) => {
  const { api } = await startApp(t);
  const tok = await api.login('+972500000042', 'Contract');
  const item = (await api('/api/laundries/achuza')).json.items[0].id;
  const o = (body) => api('/api/orders', { method: 'POST', token: tok, body });
  assert.strictEqual((await o({})).status, 400);
  assert.strictEqual((await o({ slug: 'achuza', items: [], address: 'x' })).status, 400);
  assert.strictEqual((await o({ slug: 'nope', items: [{ item_id: item, qty: 1 }], address: 'רוטשילד 1' })).status, 404);
  assert.strictEqual((await o({ slug: 'achuza', items: [{ item_id: item, qty: 101 }], address: 'רוטשילד 1' })).status, 400);
  assert.strictEqual((await o({ slug: 'achuza', items: [{ item_id: item, qty: -1 }], address: 'רוטשילד 1' })).status, 400);
  assert.strictEqual((await api('/api/cart', { method: 'PUT', token: tok, body: { items: 'x' } })).status, 400);
  assert.strictEqual((await api('/api/addresses', { method: 'POST', token: tok, body: { address: 'x' } })).status, 400);
  assert.strictEqual((await api('/api/addresses', { method: 'POST', token: tok, body: { address: 'x'.repeat(201) } })).status, 400);
  assert.strictEqual((await api('/api/apply', { method: 'POST', body: { name: 'a', city: 'b', phone: '1' } })).status, 400);
});

test('rate limit: otp request returns 429 + Retry-After after 5 per target', async (t) => {
  const { base } = await startApp(t);
  let last;
  for (let i = 0; i < 6; i++) last = await fetch(base + '/api/auth/otp/request', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ target: '+972500000077' }) });
  assert.strictEqual(last.status, 429);
  assert.ok(Number(last.headers.get('retry-after')) > 0);
});

// ---- ליקויים ידועים ----
test('invalid uuid in /api/pay/:id must not hang or crash the server (unauthenticated)', { todo: 'src/routes/pay.js async handlers without try/catch -> unhandledRejection kills node' }, async (t) => {
  const { base } = await startApp(t);
  const st = await raw(base, '/api/pay/BADID');
  const ok = await alive(base);
  assert.ok(ok, 'server died');
  assert.ok(st === 400 || st === 404, 'status ' + st);
});

test('invalid uuid in DELETE /api/addresses/:id must not crash the server', { todo: 'src/routes/addresses.js async handler without try/catch' }, async (t) => {
  const { api, base } = await startApp(t);
  const tok = await api.login('+972500000043');
  const st = await raw(base, '/api/addresses/abc', { method: 'DELETE', token: tok });
  assert.ok(await alive(base), 'server died');
  assert.ok(st === 400 || st === 404, 'status ' + st);
});

test('otp target as array should be rejected', { todo: 'normalizeTarget stringifies arrays' }, async (t) => {
  const { api } = await startApp(t);
  const r = await api('/api/auth/otp/request', { method: 'POST', body: { target: ['+972500000044'] } });
  assert.strictEqual(r.status, 400);
});
