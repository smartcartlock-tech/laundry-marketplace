// T32: ליטושי מסך שליח — טלפון LTR, תור אופליין לזמינות, הערת KPI להזמנות במכבסה
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const courierJs = fs.readFileSync('public/js/courier.js', 'utf8');
const dayJs = fs.readFileSync('public/js/courier-day.js', 'utf8');

test('קישור טלפון בכרטיס משימה: dir=ltr עם בידוד bidi כדי שלא יוצג הפוך', () => {
  const tel = courierJs.match(/<a href="tel:[^>]*>/);
  assert.ok(tel, 'קישור טלפון קיים ב-courier.js');
  assert.match(tel[0], /dir="ltr"/, 'חסר dir=ltr');
  assert.match(tel[0], /unicode-bidi:isolate/, 'חסר unicode-bidi:isolate');
});

test('שינוי זמינות ללא חיבור: נכנס לתור הסנכרון (cqPush) ולא נופל בשקט', () => {
  const fn = dayJs.match(/async function courierToggleAvail[\s\S]*?\n}/);
  assert.ok(fn, 'courierToggleAvail קיימת');
  assert.match(fn[0], /e\.status===0/, 'זיהוי כשל רשת');
  assert.match(fn[0], /cqPush\(\{path:'\/courier\/availability'/, 'דחיפה לתור האופליין');
});

test('אישור בצילום: ההערה משקפת את תור ה-IndexedDB הקיים', () => {
  const comment = dayJs.match(/\/\* אישור מסירה בצילום[\s\S]*?\*\//);
  assert.ok(comment, 'ההערה קיימת');
  assert.match(comment[0], /IndexedDB/, 'מתעדת שמירה ב-IndexedDB');
  assert.doesNotMatch(comment[0], /דורש חיבור פעיל/, 'אין טענה מיושנת שצילום דורש חיבור');
});

test('KPI "נותרו": הערת הבהרה שהזמנות אצל המכבסה נספרות רק כשמוכנות', () => {
  assert.match(dayJs, /"נותרו" סופר רק נקודות הדורשות פעולה עכשיו/, 'הערת הבהרה ליד ה-KPIs');
});
