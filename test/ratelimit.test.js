// בדיקת אבטחה: מגבלת קצב על OTP — מעבר לסף מחזיר 429 עם Retry-After
const { test } = require('node:test');
const assert = require('node:assert');
const { limiter } = require('../src/ratelimit');

function run(mw, target) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200, headers: {},
      set(k, v) { this.headers[k] = v; },
      status(c) { this.statusCode = c; return this; },
      json(b) { resolve({ statusCode: this.statusCode, headers: this.headers, body: b }); },
    };
    mw({ body: { target }, ip: '1.2.3.4' }, res, () => resolve({ statusCode: 200, next: true }));
  });
}

test('limiter allows up to max then blocks with 429 + Retry-After', async () => {
  const mw = limiter('test-' + Date.now(), 3, 60_000);
  for (let i = 0; i < 3; i++) {
    const r = await run(mw, 'a@b.c');
    assert.strictEqual(r.next, true, `request ${i + 1} should pass`);
  }
  const blocked = await run(mw, 'a@b.c');
  assert.strictEqual(blocked.statusCode, 429);
  assert.ok(Number(blocked.headers['Retry-After']) > 0);
});

test('limiter is per-target, not global', async () => {
  const mw = limiter('test2-' + Date.now(), 1, 60_000);
  await run(mw, 'x@b.c');
  const other = await run(mw, 'y@b.c');
  assert.strictEqual(other.next, true);
});
