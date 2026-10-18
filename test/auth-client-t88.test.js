// T88: כניסה — ניווט מיידי אחרי 200, מצב טעינה, 429 עם Retry-After + ספירה לאחור, אין כשל שקט
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'auth.js'), 'utf8');

test('T88: finishLogin מנווט לפני /auth/me (לא תקוע אחרי 200)', () => {
  const fn = src.match(/async function finishLogin[\s\S]*?\n}/)[0];
  assert.ok(fn.indexOf('go(rt)') < fn.indexOf("api('/auth/me')"), 'go(rt) קודם ל-/auth/me');
  assert.ok(fn.includes("rt.indexOf('#/login')===0"), 'לא מנווט חזרה למסך כניסה');
});

test('T88: 429 — קריאת Retry-After + ספירה לאחור מילולית + נעילת כפתור', () => {
  assert.ok(src.includes("r.headers.get('Retry-After')"), 'Retry-After נקרא מהתגובה');
  assert.ok(src.includes('showRetryCountdown'), 'ספירה לאחור');
  assert.ok(src.includes('יותר מדי ניסיונות — נסו שוב בעוד'), 'ניסוח מילולי');
  const tick = src.match(/function showRetryCountdown[\s\S]*?rlTimer=setInterval/)[0];
  assert.ok(tick.includes('setInterval'), 'טיימר חי');
});

test('T88: מצב טעינה — כפתורים ננעלים ומסומנים בזמן בקשה', () => {
  assert.ok(src.includes("'שולח…'"), 'requestOtp מצב טעינה');
  assert.ok(src.includes("'מאמת…'"), 'verifyOtp מצב טעינה');
  assert.ok(src.includes('btn.disabled'), 'נעילה');
});

test('T88: אין כשל שקט — הודעה מוצגת על כל כשל, כולל רשת/timeout', () => {
  assert.ok(src.includes('handleAuthErr'), 'טיפול שגיאות מאוחד');
  const h = src.match(/function handleAuthErr[\s\S]*?\n}/)[0];
  assert.ok(h.includes('loginErr(') && h.includes('toast('), 'הודעה מילולית + טוסט');
  assert.ok(src.includes("role=\"alert\""), 'נגישות: role=alert');
  assert.ok(src.includes('aria-live'), 'aria-live על אזור השגיאה');
});

test('T88: כניסת Google עוברת באותה finishLogin (ניווט מיידי גם שם)', () => {
  const g = src.match(/callback:async\(resp\)=>\{[\s\S]*?catch\(e\)\{toast\(e\.message\)\}/)[0];
  assert.ok(g.includes('finishLogin(r)'), 'google callback → finishLogin');
  assert.ok(!g.includes("go(rt)"), 'אין עותק ניווט נפרד בגוגל');
});
