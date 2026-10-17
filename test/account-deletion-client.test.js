// G17.T35 קליינט: ניקוי localStorage סלקטיבי (שומר העדפות לא-אישיות) ומסך "החשבון נמחק".
// בדיקה התנהגותית: מריצים את public/js/account-deletion.js ב-vm עם localStorage מדומה.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'account-deletion.js'), 'utf8');

function sandbox(){
  const store = new Map();
  const sb = {
    window: {},
    localStorage: {
      get length(){ return store.size; },
      key: (i) => [...store.keys()][i] || null,
      getItem: (k) => store.has(k) ? store.get(k) : null,
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
      clear: () => store.clear(),
      __store: store,
    },
    sessionStorage: { clear(){ this.cleared = true; } },
    document: { getElementById: () => null },
    console,
  };
  vm.createContext(sb);
  vm.runInContext(SRC, sb);
  return sb;
}

test('T35: clearPersonalStorage מוחק מפתחות אישיים ושומר wlm_theme', () => {
  const sb = sandbox();
  const st = sb.localStorage.__store;
  st.set('wlm_token', '"secret"');
  st.set('wlm_me', '{"name":"x"}');
  st.set('wlm_cart', '[]');
  st.set('wlm_favs', '[]');
  st.set('wlm_theme', '"dark"');
  sb.window.__acctDel.clearPersonalStorage();
  assert.equal(st.has('wlm_token'), false, 'טוקן נמחק');
  assert.equal(st.has('wlm_me'), false, 'פרופיל נמחק');
  assert.equal(st.has('wlm_cart'), false, 'עגלה נמחקה');
  assert.equal(st.has('wlm_favs'), false, 'מועדפים נמחקו');
  assert.equal(st.get('wlm_theme'), '"dark"', 'ערכת נושא נשמרת — לא מידע אישי');
  assert.ok(sb.sessionStorage.cleared, 'sessionStorage מנוקה');
});

test('T35: מסך "החשבון נמחק" קיים בזרימה; אין localStorage.clear גורף', () => {
  assert.match(SRC, /החשבון נמחק ועבר אנונימיזציה/, 'מסך החשבון נמחק');
  assert.match(SRC, /deleted-home/, 'כפתור חזרה לדף הבית');
  assert.doesNotMatch(SRC, /^\s*localStorage\.clear\(\)/m, 'אין קריאה ל-localStorage.clear() הגורף');
});
