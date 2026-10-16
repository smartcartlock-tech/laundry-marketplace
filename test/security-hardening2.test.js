// סבב קשיחה שני: JWT fail-fast, CSV formula injection, שגיאות העלאה לא-500, HSTS, push validation, rate limit על חילוץ AI
const { test } = require('node:test');
const assert = require('node:assert');
const { startApp } = require('./helpers');

// 1) auth.js: אין fallback לסוד ציבורי מחוץ ל-NODE_ENV=test
test('JWT: fail-fast בלי JWT_SECRET מחוץ ל-test', () => {
  const saved = { s: process.env.JWT_SECRET, e: process.env.NODE_ENV, d: process.env.DATABASE_URL };
  process.env.DATABASE_URL = 'postgres://postgres@127.0.0.1:5433/laundry_test'; // ל-require של db.js בלבד
  delete process.env.JWT_SECRET; delete process.env.NODE_ENV;
  delete require.cache[require.resolve('../src/auth.js')];
  const { sign } = require('../src/auth.js');
  assert.throws(() => sign({ id: 'x' }), /JWT_SECRET is required/);
  process.env.NODE_ENV = 'test';
  assert.doesNotThrow(() => sign({ id: 'x' }));
  process.env.JWT_SECRET = saved.s; process.env.NODE_ENV = saved.e;
  if (saved.d === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = saved.d;
  delete require.cache[require.resolve('../src/auth.js')];
});

// 2) csv.js: ניטרול נוסחאות
test('CSV: תאים שמתחילים ב-= + - @ מנוטרלים', () => {
  const { toCsv } = require('../src/csv.js');
  const csv = toCsv([['=CMD()', '+972500000001', '-5', '@mention', 'רגיל, עם פסיק']]);
  const lines = csv.split('\r\n')[0];
  assert.ok(lines.includes("'=CMD()"), csv);
  assert.ok(lines.includes("'+972500000001"), csv);
  assert.ok(lines.includes("'-5"), csv);
  assert.ok(lines.includes("'@mention"), csv);
  assert.ok(lines.includes('"רגיל, עם פסיק"'), 'פסיק עדיין מצוטט');
});

// 3+5+6) מול שרת חי
test('העלאות: קובץ גדול → 413, סוג לא נתמך → 415; HSTS קיים', async (t) => {
  const { base, api } = await startApp(t);
  const token = await api.login('+972500000801');

  const hsts = (await fetch(base + '/')).headers.get('strict-transport-security');
  assert.match(hsts || '', /max-age=\d+/, 'HSTS');

  const post = (buf, type, name) => {
    const fd = new FormData();
    fd.set('vehicle', 'אופניים'); fd.set('areas', 'תל אביב');
    fd.set('license', new Blob([buf], { type }), name);
    return fetch(base + '/api/courier/register', { method: 'POST', headers: { authorization: 'Bearer ' + token }, body: fd });
  };
  const big = await post(Buffer.alloc(6 * 1024 * 1024, 1), 'image/png', 'big.png');
  assert.equal(big.status, 413, 'גדול מדי → 413 ולא 500');
  const gif = await post(Buffer.from('GIF89a....'), 'image/gif', 'x.gif');
  assert.equal(gif.status, 415, 'סוג לא נתמך → 415 ולא 500');
});

test('push subscribe: endpoint לא-https ומפתחות פגומים נדחים', async (t) => {
  const { api } = await startApp(t);
  const token = await api.login('+972500000802');
  const sub = (endpoint, keys) => api('/api/push/subscribe', { method: 'POST', token, body: { subscription: { endpoint, keys } } });
  assert.equal((await sub('http://evil.example/x', { p256dh: 'AAAA', auth: 'BBBB' })).status, 400, 'http נדחה');
  assert.equal((await sub('https://push.example/x', { p256dh: '!!!', auth: 'BBBB' })).status, 400, 'מפתח לא-base64url נדחה');
  assert.equal((await sub('https://push.example/x', { p256dh: 'AAAA', auth: 'BBBB' })).status, 201, 'מנוי תקין עובר');
});

test('onboard extract: מוגבל בקצב (429 אחרי 10)', async (t) => {
  const { base, api } = await startApp(t);
  const token = await api.login('+972500000803');
  const fd = () => { const f = new FormData(); f.set('files', new Blob([Buffer.from('x')], { type: 'image/png' }), 'x.png'); return f; };
  let last;
  for (let i = 0; i < 11; i++) {
    last = await fetch(base + '/api/onboard/extract', { method: 'POST', headers: { authorization: 'Bearer ' + token }, body: fd() });
  }
  assert.equal(last.status, 429);
});
