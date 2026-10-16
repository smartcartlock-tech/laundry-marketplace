// שומר סף ל-service worker: מונע חזרה של התקלה שבה const C נמחק במיזוג (SW נכשל בהתקנה בפרוד)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

const SW = path.join(__dirname, '..', 'public', 'sw.js');

test('sw.js תקין סינטקטית (node --check)', () => {
  execSync(`node --check ${JSON.stringify(SW)}`);
});

test('sw.js מגדיר const C בגרסת mbk-v* וכל ההפניות ל-C מכוסות', () => {
  const src = fs.readFileSync(SW, 'utf8');
  assert.match(src, /const C='mbk-v\d+';/, 'חסרה הגדרת const C=\'mbk-vN\';');
  assert.match(src, /const A=\[/, 'חסרה רשימת ה-precache const A');
  assert.ok(src.includes('caches.open(C)'), 'ה-install handler חייב להשתמש ב-C');
});

test('sw.js: ה-install handler רץ בלי ReferenceError (משחזר את התקלה בפרוד — C נמחק)', () => {
  const src = fs.readFileSync(SW, 'utf8');
  const vm = require('vm');
  const handlers = {};
  const sandbox = {
    self: {
      addEventListener: (evt, fn) => { handlers[evt] = fn; },
      skipWaiting: () => {},
      clients: { claim: () => {} },
    },
    caches: {
      open: () => Promise.resolve({ addAll: () => Promise.resolve() }),
      keys: () => Promise.resolve([]),
      delete: () => Promise.resolve(),
    },
    URL,
    Promise,
  };
  sandbox.self.location = { origin: 'https://example.com' };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox); // ReferenceError כאן = התקלה בדיוק כפי שהתרחשה בפרוד
  assert.ok(handlers.install, 'חסר install handler');
  assert.ok(handlers.fetch, 'חסר fetch handler');
  return handlers.install({ waitUntil: p => p });
});

test('sw.js precache מכסה את סקריפטי מסך השליח (courier*, כולל תור הצילומים)', () => {
  const src = fs.readFileSync(SW, 'utf8');
  for (const f of ['./js/courier.js', './js/courier-day.js', './js/courier-offline.js'])
    assert.ok(src.includes(`'${f}'`), 'חסר ב-precache: ' + f);
});

test('אחידות precache: כל סקריפט ב-index.html נכלל ב-precache של sw.js (מדיניות אחידה, אכיפה אוטומטית)', () => {
  const idx = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const sw = fs.readFileSync(SW, 'utf8');
  const m = sw.match(/const A=\[([^\]]*)\]/);
  assert.ok(m, 'רשימת precache קיימת');
  const precached = new Set([...m[1].matchAll(/'\.\/js\/([^']+)'/g)].map(x => x[1]));
  const missing = [...idx.matchAll(/src="\/js\/([^"]+)"/g)].map(x => x[1]).filter(f => !precached.has(f));
  assert.deepStrictEqual(missing, [], 'סקריפטים חסרים ב-precache: ' + missing.join(', '));
});

test('sw.js: ריכוך עדכון — אסורים skipWaiting ו-clients.claim (מניעת קפיאת טאבים ב-deploy)', () => {
  const src = fs.readFileSync(SW, 'utf8');
  assert.ok(!src.includes('skipWaiting'), 'skipWaiting אסור — הגרסה החדשה נכנסת רק בסגירת כל הטאבים');
  assert.ok(!/clients\s*\.\s*claim\s*\(/.test(src), 'clients.claim אסור — network-first מבטיח תוכן טרי');
});

test('sw.js: precache אטומי — ה-install מסתמך על דחיית addAll בלי לבלוע שגיאה', () => {
  const src = fs.readFileSync(SW, 'utf8');
  assert.match(src, /caches\.open\(C\)\.then\(c=>c\.addAll\(A\)\)/, 'install חייב caches.open(C)+addAll(A)');
  const installLine = src.split('\n').find(l => l.includes("addEventListener('install'"));
  assert.ok(!/catch\s*\(/.test(installLine), 'אסור catch ב-install — שגיאה חייבת לדחות את ההתקנה');
});
