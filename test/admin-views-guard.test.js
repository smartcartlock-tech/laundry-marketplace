// שומר סף ללוח אדמין: תת-מסך לא מוכר מפולבק ל-overview (לא דף ריק), ואין הפניות ל-slug חופשי שבורות.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'admin.js'), 'utf8');

test('vAdmin: תת-מסך לא מוכר מפולבק ל-overview', async () => {
  const sb = {
    console, Promise, JSON, Object, Array, String, Number, Date, Math,
    state: { token: 't' }, store: { get: (k, d) => d, set() {} },
    api: async p => {
      if (p === '/admin/overview') return { tenants: { approved: 0, pending: 0 }, orders: { total: 0, gmv: 0 }, users: { total: 0 }, couriers: { pending: 0 } };
      return {};
    },
    needLogin: () => 'LOGIN', esc: s => String(s), fmtDate: () => '', fmtDT: () => '', onAct() {},
    document: { querySelectorAll: () => [] }, window: {},
  };
  vm.createContext(sb);
  vm.runInContext(SRC, sb);
  const html = await sb.vAdmin('no-such-view');
  assert.ok(html && html.length > 100, 'לא דף ריק');
});

test('admin.js: אין הפניות /t/${slug} שבורות מחוץ לקונטקסט מכבסה', () => {
  assert.ok(!SRC.includes('`/t/${slug}/'), 'נשארה הפניית slug שבורה');
  assert.ok(SRC.includes("if(!KNOWN.includes(sub))sub='overview'"), 'חסר fallback');
});
