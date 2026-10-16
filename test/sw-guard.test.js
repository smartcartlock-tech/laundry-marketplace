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
