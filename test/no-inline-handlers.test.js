// B7: שומר סף — אין inline event handlers (onclick= וכד') בשום קובץ לקוח, כהכנה ל-CSP בלי unsafe-inline
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

test('אפס inline event handlers ב-public/js וב-index.html', () => {
  const dir = path.join(__dirname, '..', 'public', 'js');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.js')).map(f => path.join(dir, f));
  files.push(path.join(__dirname, '..', 'public', 'index.html'));
  // תכונת inline תמיד עם רווח לפני (בתוך markup); `.onclick=` (הקצאת property) חוקי ומותר
  const re = /\son[a-z]+\s*=\s*["']/g;
  const offenders = [];
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    src.split('\n').forEach((line, i) => {
      let m;
      while ((m = re.exec(line))) offenders.push(`${path.basename(f)}:${i + 1} ${m[0].trim()}…`);
    });
  }
  assert.deepEqual(offenders, [], 'inline handlers נותרו:\n' + offenders.join('\n'));
});
