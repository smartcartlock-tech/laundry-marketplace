// הצעות חיפוש חכמות: /api/search/suggest מחזיר מכבסות, ערים ושירותים תואמים
const { test } = require('node:test');
const assert = require('node:assert');
const { startApp } = require('./helpers');

test('search/suggest: מכבסה לפי שם חלקי', async (t) => {
  const { api } = await startApp(t);
  const r = await api('/api/search/suggest?q=' + encodeURIComponent('אחוזה'));
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  const l = r.json.suggestions.find(s => s.type === 'laundry');
  assert.ok(l, 'צפויה הצעת מכבסה');
  assert.strictEqual(l.slug, 'achuza');
  assert.strictEqual(l.sub, 'תל אביב');
});

test('search/suggest: עיר ושירות', async (t) => {
  const { api } = await startApp(t);
  const city = await api('/api/search/suggest?q=' + encodeURIComponent('חיפה'));
  assert.ok(city.json.suggestions.some(s => s.type === 'city' && s.label === 'חיפה'), 'עיר');
  assert.ok(city.json.suggestions.some(s => s.type === 'laundry' && s.slug === 'carmel'), 'מכבסה מהעיר');
  const svc = await api('/api/search/suggest?q=' + encodeURIComponent('שטיח'));
  assert.ok(svc.json.suggestions.some(s => s.type === 'service' && s.label === 'שטיחים'), 'שירות');
});

test('search/suggest: שאילתה ריקה/ללא התאמות', async (t) => {
  const { api } = await startApp(t);
  const empty = await api('/api/search/suggest?q=');
  assert.deepStrictEqual(empty.json.suggestions, []);
  const none = await api('/api/search/suggest?q=' + encodeURIComponent('zzzqqq'));
  assert.deepStrictEqual(none.json.suggestions, []);
});

// רישום צד לקוח: search-suggest.js קיים, נטען ונשמר ב-precache
test('search-suggest.js: רישום ב-index.html ו-sw.js', () => {
  const fs = require('fs'), path = require('path');
  const pub = p => fs.readFileSync(path.join(__dirname, '..', 'public', p), 'utf8');
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'public', 'js', 'search-suggest.js')), 'file exists');
  assert.ok(pub('index.html').includes('/js/search-suggest.js'), 'loaded in index.html');
  assert.ok(pub('sw.js').includes('./js/search-suggest.js'), 'precached in sw.js');
  const js = pub('js/search-suggest.js');
  assert.match(js, /role','combobox'/, 'combobox aria');
  assert.match(js, /search\/suggest/, 'uses suggest endpoint');
});
