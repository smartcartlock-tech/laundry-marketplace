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

// תקרת 50 מועדפים למשתמש + סינון מכבסות לא-מאושרות מהרשימה
test('favorites: תקרת כמות (50) עם הודעה ידידותית + GET מסנן לא-מאושרות', async (t) => {
  const { api, schema } = await startApp(t);
  const { Client } = require('pg');
  const db = new Client({ connectionString: process.env.TEST_DATABASE_URL || 'postgres://postgres@127.0.0.1:5433/laundry_test' });
  await db.connect(); t.after(() => db.end());
  await db.query(`SET search_path TO ${schema}, public`);

  const token = await api.login('0503334444', 'משתמש תקרה');
  const { json: me } = await api('/api/auth/me', { token });
  const uid = me.user.id;

  // מכבסה לא מאושרת עם רשומת מועדף קיימת — לא תופיע ב-GET
  const { rows: [un] } = await db.query(`INSERT INTO tenants(slug, name, approved) VALUES ('fav-unapproved', 'מכבסה ממתינה', false) RETURNING id`);
  await db.query('INSERT INTO user_favorites(user_id, tenant_id) VALUES ($1,$2)', [uid, un.id]);
  const listUn = await api('/api/me/favorites', { token });
  assert.ok(!listUn.json.favorites.some(f => f.slug === 'fav-unapproved'), 'מכבסה לא מאושרת מסוננת מהרשימה');
  await db.query('DELETE FROM user_favorites WHERE user_id=$1 AND tenant_id=$2', [uid, un.id]);

  // מילוי עד התקרה: 50 מועדפים ישירות ב-DB
  for (let i = 0; i < 50; i++) {
    const { rows: [ten] } = await db.query(`INSERT INTO tenants(slug, name, approved) VALUES ($1, $2, true) RETURNING id`, [`fav-cap-${i}`, `מכבסה ${i}`]);
    await db.query('INSERT INTO user_favorites(user_id, tenant_id) VALUES ($1,$2)', [uid, ten.id]);
  }

  // ה-51 נחסם עם הודעה ידידותית
  const over = await api('/api/me/favorites', { method: 'POST', token, body: { slug: 'achuza' } });
  assert.strictEqual(over.status, 409, JSON.stringify(over.json));
  assert.match(over.json.error, /50/);
  assert.match(over.json.error, /הסירו/);
  assert.strictEqual(over.json.code, 'favorites_limit');

  // הוספה חוזרת של מועדף קיים לא נחסמת (idempotent)
  const { rows: [firstTen] } = await db.query(`SELECT t.slug FROM user_favorites uf JOIN tenants t ON t.id=uf.tenant_id WHERE uf.user_id=$1 LIMIT 1`, [uid]);
  const again = await api('/api/me/favorites', { method: 'POST', token, body: { slug: firstTen.slug } });
  assert.strictEqual(again.status, 200, 'הוספה חוזרת של קיים לא נחסמת ע"י התקרה');

  // אחרי הסרה אפשר שוב להוסיף
  await api(`/api/me/favorites/${firstTen.slug}`, { method: 'DELETE', token });
  const after = await api('/api/me/favorites', { method: 'POST', token, body: { slug: 'achuza' } });
  assert.strictEqual(after.status, 200);
});
