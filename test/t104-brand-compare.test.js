// T104: White Label — אין הפניה 'זול יותר ב-' לדפי /b/ ממותגים; ההשוואה נשארת במרקטפלייס הראשי.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const src = fs.readFileSync('public/js/marketplace.js', 'utf8');

test('T104: בדף מכבסה בתוך אפליקציית מותג לא נמשכת ולא מוצגת השוואת מתחרים', () => {
  assert.match(src, /brandedView=state\.brandSlug===slug/, 'זיהוי תצוגה ממותגת');
  assert.match(src, /if\(!brandedView\)\{try\{const cd=await api\('\/laundries\/'\+slug\+'\/price-compare'\)/, 'דילוג על price-compare במותג');
  assert.match(src, /const cp=brandedView\?null:cmp\[/, 'התגית מושבתת במותג');
});

test('T104: במרקטפלייס הראשי ההשוואה נשארת (הנדpoint והתגית קיימים)', () => {
  assert.match(src, /price-compare/, 'הנדpoint ההשוואה עדיין בשימוש');
  assert.match(src, /זול יותר ב־/, 'תגית ההשוואה קיימת לתצוגת מרקטפלייס');
  const server = fs.readFileSync('src/routes/public.js', 'utf8');
  assert.match(server, /\/laundries\/:slug\/price-compare/, 'הנדpoint ההשוואה לא הוסר מהשרת');
});
