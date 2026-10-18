// T90b: returnTo דביק — אחרי טעינת תפקידים ב-/auth/me, נחיתה זרה לתפקיד מנותבת לבית התפקיד
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'auth.js'), 'utf8');

test('T90b: finishLogin בודק זרות-תפקיד אחרי /auth/me ומנתב ל-homeForRole', () => {
  const fn = src.match(/async function finishLogin[\s\S]*?\n}/)[0];
  assert.ok(fn.includes("indexOf('#/courier/')===0&&!state.courier"), 'דפי שליח עמוקים זרים ללא-courier');
  assert.ok(fn.includes("indexOf('#/manage')===0"), 'דף ניהול זר ללא מכבסה');
  assert.ok(fn.includes("indexOf('#/admin')===0"), 'דף אדמין זר');
  assert.ok(fn.includes('go(homeForRole())'), 'ניתוב לבית התפקיד');
  // הבדיקה מתרחשת אחרי שהתפקידים נטענו (אחרי api('/auth/me')), לא לפני
  assert.ok(fn.indexOf("api('/auth/me')") < fn.indexOf('const cur='), 'אחרי טעינת תפקידים');
});
