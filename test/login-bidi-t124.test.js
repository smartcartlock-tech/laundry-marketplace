// T124: כניסה bidi — שדות מספרים (טלפון/קוד) LTR בתוכן, יישור ימין, placeholder נקי
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'auth.js'), 'utf8');

test('T124: שדה טלפון dir=ltr + יישור ימין — הספרות לא מתהפכות', () => {
  const inp = src.match(/<input class="inp" id="login-target"[^>]*>/)[0];
  assert.ok(inp.includes('dir="ltr"'), 'תוכן LTR');
  assert.ok(inp.includes('text-align:right'), 'יישור ימין ויזואלי');
  assert.ok(!/[\u05d0-\u05ea].*@|@.*[\u05d0-\u05ea]/.test(inp), 'placeholder בלי ערבוב עברית+אימייל');
});

test('T124: שדה הקוד dir=ltr; תוויות מקושרות לשדות (for/id)', () => {
  const code = src.match(/<input class="inp" id="login-code"[^>]*>/)[0];
  assert.ok(code.includes('dir="ltr"'), 'קוד LTR');
  assert.ok(src.includes('for="login-target"') && src.includes('for="login-code"'), 'תוויות מקושרות');
});
