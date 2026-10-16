// P0 (מסע בעל מכבסה): סלאג עברי בצ'קאאוט + שדות מיתוג שבלעו בשמירת הגדרות.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function sandbox(extra = {}) {
  const el = () => ({ innerHTML: '', value: '', checked: true, classList: { remove() {}, add() {} }, style: {}, remove() {} });
  const sb = {
    console, URLSearchParams, clearInterval, setInterval, setTimeout, Promise, JSON, Math, Date, Number, String, Array, Object,
    location: { hash: '#/' },
    document: { querySelectorAll: () => [], querySelector: () => null },
    window: { addEventListener() {}, scrollTo() {} },
    $: () => el(), $$: () => [],
    state: {}, store: { get: (k, d) => d, set() {} }, save() {},
    api: async () => ({}), toast() {}, route() {}, renderTabs() {}, go() {}, onAct() {},
    esc: s => String(s), cssColor: c => c, initGoogle() {}, applyBrandTheme() {}, joinExtract() {},
    pickAddr() {}, orderPoll: null, routeSeq: 0, __coAddrs: [],
    ...extra,
  };
  sb.window.location = sb.location;
  vm.createContext(sb);
  return sb;
}

test('router: סלאג עברי מקודד מפוענח לפני קריאה ל-vCheckout', async () => {
  let got = null;
  const sb = sandbox({ vCheckout: async slug => { got = slug; return '<div></div>'; }, vLaundry: async () => '', vHome: async () => '' });
  sb.location.hash = '#/checkout/%D7%90%D7%97%D7%95%D7%96%D7%94';
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'router.js'), 'utf8'), sb);
  await sb.route();
  assert.equal(got, 'אחוזה', 'vCheckout קיבל סלאג מפוענח');
});

test('router: קלט מקודד שבור (% לא תקין) לא מפיל את הניתוב', async () => {
  let got = null;
  const sb = sandbox({ vCheckout: async slug => { got = slug; return ''; } });
  sb.location.hash = '#/checkout/%zz';
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'router.js'), 'utf8'), sb);
  await sb.route();
  assert.equal(got, '%zz', 'נשאר כמות שהוא בלי חריגה');
});

test('saveSettings: שולח slogan/whatsapp/color — לא נבלעים בשקט', async () => {
  let sent = null;
  const vals = { '#s-name': 'מכבסה', '#s-slogan': 'הכי נקי', '#s-wa': '+972501234567', '#s-color': '#a1b2c3' };
  const sb = sandbox({
    $: id => ({ value: vals[id] !== undefined ? vals[id] : '', checked: true, classList: { remove() {} } }),
    api: async (p, opts) => { sent = { p, body: JSON.parse(opts.body) }; return {}; },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'community.js'), 'utf8'), sb);
  await sb.saveSettings('achuza');
  assert.ok(sent, 'נשלחה קריאה');
  assert.equal(sent.p, '/t/achuza/settings');
  assert.equal(sent.body.slogan, 'הכי נקי');
  assert.equal(sent.body.whatsapp, '+972501234567');
  assert.equal(sent.body.color, '#a1b2c3');
});
