// T122: צ'אט תמיכה — ניסוח תקין, שדה הקלדה רחב, כפתור שליחה קטן, סטטוס פנייה ללקוח
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const chat = fs.readFileSync('public/js/support-chat.js', 'utf8');
const orders = fs.readFileSync('public/js/orders.js', 'utf8');

test('ניסוח תקין: אין טעות הכתיב "הדעות" באף מסך', () => {
  assert.doesNotMatch(chat, /הדעות/, 'טעות הכתיב הדעות נעלמה מצ\'אט התמיכה');
  assert.doesNotMatch(orders, /הדעות/);
  assert.match(chat, /עוד אין הודעות/, 'נוסח תקין למצב ריק');
});

test('שדה הקלדה רחב (textarea מלא רוחב) וכפתור שליחה קטן', () => {
  assert.match(chat, /<textarea class="inp" id="sc-inp"[^>]*width:100%/, 'textarea ברוחב מלא');
  assert.match(chat, /id="sc-send-btn"[^>]*font-size:13px/, 'כפתור שליחה קטן');
  assert.doesNotMatch(chat, /<input class="inp" id="sc-inp"/, 'השדה החד-שורתי הוחלף');
  assert.match(chat, /e\.key==='Enter'&&!e\.shiftKey/, 'Enter שולח, Shift+Enter שורה חדשה');
});

test('סטטוס פנייה ללקוח: בחלון הצ\'אט, ברשימת השיחות ובדיווחי התקלות', () => {
  assert.match(chat, /id="sc-status"/, 'אלמנט סטטוס בחלון');
  assert.match(chat, /st\.textContent=closed\?'הפנייה טופלה — השרשור סגור':'בטיפול — נחזור עד מחר'/, 'סטטוס מתעדכן מהשרת');
  assert.match(chat, /t\.status==='open'\?'בטיפול — נחזור עד מחר':'טופל ✓'/, 'סטטוס ברשימת השיחות בחשבון');
  assert.match(orders, /in_progress:'בטיפול — נחזור עד מחר'/, 'סטטוס פנייה בדיווח תקלה בדף ההזמנה');
});
