// T111 (לקוח): מרכז ההודעות — קיבוץ הודעות הזמנה לכרטיס אחד לפי data.tracking_code
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'messages.js'), 'utf8');

test('T111: הודעות order עם tracking_code מתקבצות לכרטיס אחד', () => {
  assert.ok(src.includes('byCode'), 'קיבוץ לפי קוד');
  assert.ok(src.includes("m.data && m.data.tracking_code"), 'מפתח הקיבוץ הוא קוד המעקב');
  assert.ok(src.includes('עדכונים קודמים'), 'עדכונים ישנים מכווצים');
  assert.ok(src.includes('<details'), 'כיווץ בלי JS נוסף');
});

test('T111: כרטיס קבוצה מציג קוד הזמנה, מספר עדכונים ומונה לא-נקראו', () => {
  assert.ok(src.includes('הזמנה ${esc(g.code)}'), 'קוד הזמנה בכותרת הכרטיס');
  assert.ok(src.includes("' עדכונים'"), 'ספירת עדכונים');
  assert.ok(src.includes('חדשים'), 'מונה לא-נקראו בקבוצה');
});

test('T111: הודעות בלי הזמנה נשארות בודדות; פעולות נקרא/מחק נשמרות לכל הודעה', () => {
  assert.ok(src.includes('g.solo'), 'מסלול בודד');
  assert.ok(src.includes("data-act=\"msgDelete\""), 'מחיקה נשמרת');
  assert.ok(src.includes('msgMarkRead') && src.includes('msgMarkUnread'), 'סימון נקרא/לא נקרא נשמר');
});
