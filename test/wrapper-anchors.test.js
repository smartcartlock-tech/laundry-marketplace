// משמר עוגני עטיפות: עטיפות (קבצים שמחליפים window.vX) מוזרקות ל-markup של קבצים אחרים.
// אם מפתח משנה את מבנה ה-view המקורי, עוגן מחרוזתי עלול להפסיק להתאים — והעטיפה נכשלת בשקט (כרטיס נעלם).
// הטסט מחלץ כל עוגן '<div class="...">' שמשמש ב-.replace()/.match()/.includes() בקובצי העטיפה,
// ומוודא שהוא עדיין קיים באחד מקובצי ה-view. נכשל = מבנה המקור השתנה והעטיפה צריכה עדכון עוגן.
// רקע: רגרסיה אמיתית ב-16.10 — כרטיס "מוכנות המכבסה" נעלם אחרי שלוח זמינות נכנס לפני ה-subtabs.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const JS_DIR = path.join(__dirname, '..', 'public', 'js');
const files = fs.readdirSync(JS_DIR).filter(f => f.endsWith('.js'));
const sources = Object.fromEntries(files.map(f => [f, fs.readFileSync(path.join(JS_DIR, f), 'utf8')]));
const wrappers = files.filter(f => /window\.v[A-Z]\w*\s*=\s*(?:async\s*)?function/.test(sources[f]));

// חילוץ עוגנים: ליטרלים '<div class="...">' שמופיעים כארגומנט של replace/match/includes,
// וכן בתוך ביטויים רגולריים שמחפשים div class (החלק הקשיח של הביטוי)
function anchorsOf(src){
  const out = new Set();
  for (const m of src.matchAll(/(?:replace|match|includes)\(\s*'(<div class="[^"]+")'/g)) out.add(m[1]);
  for (const m of src.matchAll(/(?:replace|match)\(\s*\/([^/]*?<div class="[^"]+")[^/]*\//g)){
    const plain = m[1].match(/<div class="[^"]+"/);
    if (plain) out.add(plain[0]);
  }
  return [...out];
}

test('עוגני עטיפות קיימים בקבצי ה-view (אין עטיפה שתיכשל בשקט)', () => {
  const problems = [];
  for (const w of wrappers){
    for (const a of anchorsOf(sources[w])){
      const found = files.some(f => f !== w && sources[f].includes(a));
      if (!found) problems.push(`${w}: העוגן ${a} לא נמצא באף קובץ view — העטיפה תיכשל בשקט`);
    }
  }
  assert.deepEqual(problems, [], problems.join('\n'));
});

test('אסור עוגן קשיח רב-אלמנטי (body+subtabs ברצף) — נשבר בכל הוספת כרטיס לראש הלוח', () => {
  const RIGID = '<div class="body"><div class="subtabs">';
  const offenders = wrappers.filter(w => sources[w].includes(RIGID));
  assert.deepEqual(offenders, [], `עטיפות עם עוגן קשיח: ${offenders.join(', ')} — יש לעגן אחרי '<div class="body">' בלבד עם fallback`);
});
