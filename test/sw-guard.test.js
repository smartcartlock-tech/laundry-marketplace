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
