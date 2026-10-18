// T89: מעבר חשבון בטוח — ניקוי state מלא בהתנתקות, באנר 'מחובר כ-', התנתקות לכל תפקיד
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path');
const pub = p => fs.readFileSync(path.join(__dirname, '..', 'public', p), 'utf8');
const auth = pub('js/auth.js');

test('T89: logout מנקה את כל מפתחות הסשן והמטמון (לא רק 4), שומר רק קוסמטיקה', () => {
  assert.ok(auth.includes('cleanupSessionState'), 'פונקציית ניקוי');
  const fn = auth.match(/function cleanupSessionState[\s\S]*?\n}/)[0];
  assert.ok(fn.includes("indexOf('wlm_')===0"), 'מנקה את כל wlm_*');
  assert.ok(fn.includes('SESSION_KEEP'), 'רשימת שמירה');
  assert.ok(fn.includes("state.cart=[]"), 'סל מתנקה — פריטים של חשבון קודם לא דולפים');
  assert.ok(auth.includes("'/api/auth/logout'"), 'ניתוק גם בשרת (ביטול טוקן)');
});

test('T89: באנר מחובר-כ קבוע עם התנתקות, מוצג לכל תפקיד', () => {
  assert.ok(auth.includes('ensureIdBanner'), 'באנר זהות');
  assert.ok(auth.includes('MutationObserver'), 'מופיע אחרי כל רינדור');
  assert.ok(auth.includes('מחובר כ-'), 'נוסח הבאנר');
  assert.ok(auth.includes('roleLabel'), 'תפקיד מוצג (לקוח/שליח/בעל מכבסה)');
  assert.ok(auth.includes("acctLogout:(t,e)"), 'פעולת התנתקות רשומה ב-onAct');
  const obs = auth.match(/function ensureIdBanner[\s\S]*?\n}/)[0];
  assert.ok(obs.includes('if(!state.me){if(b)b.remove();return}'), 'אורח — בלי באנר');
});

test('T89: כרטיס הזהות בחשבון מציע התנתקות; צ\'ק-אאוט בודק עקביות זהות', () => {
  const hub = pub('js/account-hub.js');
  assert.ok(hub.includes('data-act="acctLogout"'), 'כפתור התנתקות בחשבון');
  const ca = pub('js/customer-account.js');
  assert.ok(ca.includes("api('/auth/me')"), 'רענון זהות לפני קופה');
  assert.ok(ca.includes('cleanupSessionState()'), '401 בקופה → ניקוי + כניסה מחדש');
});
