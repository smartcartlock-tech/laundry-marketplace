// T115: styles.css — ניגודיות AA בניווט, toast מעל מודאלים, באנר דמו לא חופף, ירח מעוגד, צ'יפי סטטוס
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path');
const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');

// ניגודיות יחסית לפי WCAG
function lum(hex) {
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function ratio(a, b) { const [h, l] = [lum(a), lum(b)].sort((x, y) => y - x); return (h + 0.05) / (l + 0.05); }

test('T115: צבע ניווט לא-פעיל עובר AA (4.5:1) על לבן', () => {
  const m = css.match(/#tabs a\{flex:1[^}]*\}/)[0]; // כלל המובייל (דסקטופ על רקע כהה)
  const color = m.match(/color:(#[0-9a-f]{6})/)[1];
  assert.ok(ratio(color, '#ffffff') >= 4.5, color + ' על לבן = ' + ratio(color, '#ffffff').toFixed(2));
  assert.ok(!css.includes('#tabs a{flex:1;min-width:0;text-align:center;padding:9px 2px 10px;font-size:11px;line-height:1.25;color:#8a99a3'), 'הצבע הישן הוחלף');
});

test('T115: toast מעל modal-ov (200) — שגיאות לא נבלעות', () => {
  const toastZ = Math.max(...[...css.matchAll(/\.toast\{[^}]*z-index:(\d+)/g)].map(x => +x[1]),
    ...[...css.matchAll(/\.toast\{[^}]*?z-index:(\d+)/g)].map(x => +x[1]));
  const modalZ = +css.match(/\.modal-ov\{[^}]*z-index:(\d+)/)[1];
  assert.ok(toastZ > modalZ, `toast ${toastZ} > modal ${modalZ}`);
});

test('T115: באנר דמו fixed — פיצוי גובה למובייל/דסקטופ/דפי /b/', () => {
  assert.ok(css.includes('body.mode-demo #app{padding-top:27px}'), 'פיצוי מובייל');
  assert.ok(css.includes('body.mode-demo #tabs{top:27px}'), 'nav דסקטופ מוזז');
  assert.ok(css.includes('body.mode-demo .demo{margin-top:27px}'), 'באנר .demo בדפי /b/ לא מכוסה');
});

test('T115: כפתור ירח מעוגד לפינה עליונה — לא מכסה תוכן תחתון', () => {
  const rule = [...css.matchAll(/(?:^|\s)\.theme-toggle\{[^}]*\}/g)].map(x => x[0]).find(r => r.includes('left:10px'));
  assert.ok(rule && rule.includes('top:34px') && rule.includes('bottom:auto'), 'הועבר לפינה עליונה');
});

test('T115: צ\'יפי סטטוס לכל 8 הסטטוסים עם ניגודיות AA', () => {
  for (const st of ['new', 'confirmed', 'picked_up', 'in_work', 'ready', 'out_for_delivery', 'delivered', 'cancelled']) {
    const m = css.match(new RegExp('\\.status-chip\\.st-' + st + '\\{background:(#[0-9a-f]{6});color:(#[0-9a-f]{6})\\}'));
    assert.ok(m, st + ' קיים');
    assert.ok(ratio(m[2], m[1]) >= 4.5, st + ' ניגודיות ' + ratio(m[2], m[1]).toFixed(2));
  }
});
