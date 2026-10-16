// מועדפים מסונכרנים: הוספה/רשימה/הסרה לכל משתמש, הפרדה בין משתמשים, דרישת התחברות
const { test } = require('node:test');
const assert = require('node:assert');
const { startApp } = require('./helpers');

test('favorites: CRUD מלא והפרדת משתמשים', async (t) => {
  const { api } = await startApp(t);
  const tokenA = await api.login('0501111111', 'משתמש א');
  const tokenB = await api.login('0502222222', 'משתמש ב');

  // דרישת התחברות
  const anon = await api('/api/me/favorites');
  assert.strictEqual(anon.status, 401);

  // רשימה ריקה
  const empty = await api('/api/me/favorites', { token: tokenA });
  assert.deepStrictEqual(empty.json.favorites, []);

  // הוספה + כפילות idempotent
  let add = await api('/api/me/favorites', { method: 'POST', token: tokenA, body: { slug: 'achuza' } });
  assert.strictEqual(add.status, 200, JSON.stringify(add.json));
  add = await api('/api/me/favorites', { method: 'POST', token: tokenA, body: { slug: 'achuza' } });
  assert.strictEqual(add.status, 200);
  await api('/api/me/favorites', { method: 'POST', token: tokenA, body: { slug: 'carmel' } });

  const list = await api('/api/me/favorites', { token: tokenA });
  assert.strictEqual(list.json.favorites.length, 2);
  assert.strictEqual(list.json.favorites[0].slug, 'carmel', 'אחרון שהתווסף ראשון');
  assert.ok(list.json.favorites[0].name, 'שם מכבסה');

  // הפרדה: משתמש ב לא רואה את המועדפים של א
  const other = await api('/api/me/favorites', { token: tokenB });
  assert.deepStrictEqual(other.json.favorites, []);

  // slug לא קיים
  const nf = await api('/api/me/favorites', { method: 'POST', token: tokenA, body: { slug: 'no-such' } });
  assert.strictEqual(nf.status, 404);

  // הסרה
  const del = await api('/api/me/favorites/achuza', { method: 'DELETE', token: tokenA });
  assert.strictEqual(del.json.removed, true);
  const after = await api('/api/me/favorites', { token: tokenA });
  assert.strictEqual(after.json.favorites.length, 1);
  assert.strictEqual(after.json.favorites[0].slug, 'carmel');
});

// רישום צד לקוח: favorites-sync.js ו-perf.js קיימים, נטענים ונשמרים ב-precache
test('favorites-sync/perf: רישום ב-index.html ו-sw.js', () => {
  const fs = require('fs'), path = require('path');
  const pub = p => fs.readFileSync(path.join(__dirname, '..', 'public', p), 'utf8');
  for (const f of ['favorites-sync', 'perf']) {
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'public', 'js', f + '.js')), f + ' exists');
    assert.ok(pub('index.html').includes('/js/' + f + '.js'), f + ' in index.html');
    assert.ok(pub('sw.js').includes('./js/' + f + '.js'), f + ' in sw.js');
  }
  const fsync = pub('js/favorites-sync.js');
  assert.match(fsync, /me\/favorites/, 'syncs with server');
  assert.match(fsync, /window\.toggleFav/, 'wraps toggleFav');
  const perf = pub('js/perf.js');
  assert.match(perf, /preconnect/, 'resource hints');
  assert.match(perf, /pointerover/, 'hover prefetch');
});
