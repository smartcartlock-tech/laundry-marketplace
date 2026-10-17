// P1 מובייל: שורות שעות פעילות בפרופיל שליח — ללא overflow ב-375px (שדה סיום נשפך שמאלה)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const src = fs.readFileSync('public/js/courier-day.js', 'utf8');

test('שורת שעות ליום: גלישה גמישה (flex-wrap), בלי רוחב קבוע 110px ששובר 375px', () => {
  const row = src.match(/DAYS_HE\.map\([\s\S]*?join\(''\)/);
  assert.ok(row, 'בלוק שורות הימים קיים');
  assert.match(row[0], /flex-wrap:wrap/, 'השורה חייבת flex-wrap:wrap');
  assert.doesNotMatch(row[0], /max-width:110px/, 'אסור רוחב קבוע 110px על שדות הזמן — גורם overflow ב-375px');
  assert.match(row[0], /min-width:0/, 'שדות גמישים חייבים min-width:0 כדי להתכווץ');
});

test('שורת שעות מעובדת: שדות זמן בקבוצה גמישה ברוחב מלא אחרי שם היום', () => {
  const ctx = { window: { addEventListener() {} }, onAct() {}, state: { token: 'demo' }, esc: String,
    api: async p => p === '/auth/me' ? { courier: { approved: true }, user: { name: 'שליח' } } : p === '/courier/profile' ? { courier: { availability: {} }, stats: { delivered: 0, active: 0 } } : ({}) };
  vm.createContext(ctx); vm.runInContext(src, ctx);
  return ctx.vCourierProfile().then(html => {
    const dayRow = html.match(/<div style="display:flex[^"]*flex-wrap:wrap[^"]*">[\s\S]*?cp-from-0[\s\S]*?cp-to-0[\s\S]*?<\/div>\s*<\/div>/);
    assert.ok(dayRow, 'שורת יום עם שני שדות זמן בתוך מבנה גולש');
  });
});
