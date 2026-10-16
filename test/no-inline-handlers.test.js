// B7: שומר סף — אין inline event handlers (onclick= וכד') בשום קובץ לקוח, כהכנה ל-CSP בלי unsafe-inline
// G8: הסריקה מורחבת גם ל-HTML שנבנה ב-src/routes (למשל כרטיס הסניף ב-public.js)
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

test('אפס inline event handlers ב-public/js, ב-index.html וב-HTML מתוך src/routes', () => {
  const root = path.join(__dirname, '..');
  const files = fs.readdirSync(path.join(root, 'public', 'js'))
    .filter(f => f.endsWith('.js')).map(f => path.join(root, 'public', 'js', f));
  files.push(path.join(root, 'public', 'index.html'));
  // HTML שנבנה בשרת (תבניות טמפלט בתוך routes) — אותו כלל: בלי on*="..." ובלי javascript:
  for (const f of fs.readdirSync(path.join(root, 'src', 'routes'))) {
    if (f.endsWith('.js')) files.push(path.join(root, 'src', 'routes', f));
  }
  // תכונת inline תמיד עם רווח לפני (בתוך markup); `.onclick=` (הקצאת property) חוקי ומותר
  const re = /\son[a-z]+\s*=\s*["']/g;
  const offenders = [];
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    src.split('\n').forEach((line, i) => {
      let m;
      while ((m = re.exec(line))) offenders.push(`${path.basename(f)}:${i + 1} ${m[0].trim()}…`);
      if (/href="javascript:/i.test(line)) offenders.push(`${path.basename(f)}:${i + 1} href="javascript:…"`);
    });
  }
  assert.deepEqual(offenders, [], 'inline handlers נותרו:\n' + offenders.join('\n'));
});
