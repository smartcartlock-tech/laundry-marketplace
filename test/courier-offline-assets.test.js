// מסך שליח: שומר סף לתור הצילומים הלא-מקוון (IndexedDB) — רישום, precache, חיווט וסינטקס
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

const P = f => path.join(__dirname, '..', 'public', f);

test('courier-offline.js תקין סינטקטית ומגדיר את ממשק ה-IndexedDB', () => {
  execSync(`node --check ${JSON.stringify(P('js/courier-offline.js'))}`);
  const src = fs.readFileSync(P('js/courier-offline.js'), 'utf8');
  for (const fn of ['coffSavePhoto', 'coffGetPhoto', 'coffDelPhoto', 'coffListPhotos', 'coffPersist'])
    assert.ok(src.includes('function ' + fn), 'חסרה פונקציה: ' + fn);
  assert.ok(src.includes('indexedDB.open'), 'לא נמצא שימוש ב-IndexedDB');
  assert.ok(src.includes('navigator.storage.persist'), 'חסרה בקשת אחסון מתמשך');
});

test('courier-offline.js רשום ב-index.html לפני courier-day.js ונמצא ב-precache של sw.js', () => {
  const html = fs.readFileSync(P('index.html'), 'utf8');
  const iOff = html.indexOf('/js/courier-offline.js');
  const iDay = html.indexOf('/js/courier-day.js');
  assert.ok(iOff > -1, 'courier-offline.js לא רשום ב-index.html');
  assert.ok(iOff < iDay, 'courier-offline.js חייב להיטען לפני courier-day.js');
  const sw = fs.readFileSync(P('sw.js'), 'utf8');
  assert.ok(sw.includes("'./js/courier-offline.js'"), 'חסר ב-precache של sw.js');
});

test('courier-day.js מחווט: סמני photo בתור, סנכרון FormData ובאדג׳ מאוחד', () => {
  const src = fs.readFileSync(P('js/courier-day.js'), 'utf8');
  assert.ok(src.includes("kind==='photo'"), 'cqSync לא מטפל בסמני photo');
  assert.ok(src.includes("coffSavePhoto(orderId,f)"), 'שמירת צילום לא-מקוון לא מחוברת');
  assert.ok(src.includes('cqSyncPhoto'), 'חסרה פונקציית סנכרון צילום');
  assert.ok(src.includes("kind:'photo'"), 'סמן photo לא נדחף לתור המאוחד');
  execSync(`node --check ${JSON.stringify(P('js/courier-day.js'))}`);
});
