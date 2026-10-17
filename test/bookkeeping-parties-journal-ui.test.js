// T3 + T55: מסך כרטיסי ספקים/לקוחות ומסך יומן בלשונית הנה״ח.
// בדיקה התנהגותית: מריצים את שלושת הקבצים ב-vm עם api מדומה ומעבירים דרך vManage,
// וברמת ה-handlers — מוודאים POST נכון לכרטיס חדש, לספק inline, לפקודה מאוזנת ולסטורנו.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', 'js', f), 'utf8');
const SRC_BK = read('bookkeeping.js');
const SRC_PARTIES = read('bookkeeping-parties.js');
const SRC_JOURNAL = read('bookkeeping-journal.js');

const ENTRIES = { entries: [
  { id: 'e1', entry_no: 7, entry_date: '2026-10-01', description: 'פקודה ידנית בדיקה', source: 'manual', reversal_of: null,
    lines: [
      { account_code: '6010', account_name: 'סחורה', party_name: 'ספק בדיקה', debit: 100, credit: 0, details: null },
      { account_code: '1010', account_name: 'קופה', party_name: null, debit: 0, credit: 100, details: null },
    ] },
  { id: 'e2', entry_no: 8, entry_date: '2026-10-02', description: 'חשבונית מס 2026-1', source: 'invoice', reversal_of: null,
    lines: [
      { account_code: '1020', account_name: 'לקוחות', party_name: 'לקוח בדיקה', debit: 117, credit: 0, details: null },
      { account_code: '4000', account_name: 'הכנסות', party_name: null, debit: 0, credit: 100, details: null },
      { account_code: '2010', account_name: 'מע״מ עסקאות', party_name: null, debit: 0, credit: 17, details: null },
    ] },
  { id: 'e3', entry_no: 9, entry_date: '2026-10-03', description: 'פקודה שסווטרנה', source: 'manual', reversal_of: null,
    lines: [
      { account_code: '6010', account_name: 'סחורה', party_name: null, debit: 50, credit: 0, details: null },
      { account_code: '1010', account_name: 'קופה', party_name: null, debit: 0, credit: 50, details: null },
    ] },
  { id: 'e4', entry_no: 10, entry_date: '2026-10-04', description: 'סטורנו לפקודה 9', source: 'reversal', reversal_of: 'e3',
    lines: [
      { account_code: '1010', account_name: 'קופה', party_name: null, debit: 50, credit: 0, details: null },
      { account_code: '6010', account_name: 'סחורה', party_name: null, debit: 0, credit: 50, details: null },
    ] },
] };

const PARTIES = { parties: [
  { id: 'p1', kind: 'supplier', name: 'ספק בדיקה', tax_id: '*****1234', email: null, phone: '050-1', address: null, active: true },
  { id: 'p2', kind: 'customer', name: 'לקוח בדיקה', tax_id: null, email: 'c@c.c', phone: null, address: null, active: true },
] };

function canned(pathname){
  if (pathname.endsWith('/settings')) return { tenant: { dealer_type: 'morasha' } };
  if (pathname.endsWith('/accounts')) return { accounts: [
    { id: 'a1', code: '1010', name_he: 'קופה', type: 'asset', active: true },
    { id: 'a2', code: '6010', name_he: 'סחורה', type: 'expense', active: true },
  ] };
  if (pathname.endsWith('/parties')) return PARTIES;
  if (pathname.endsWith('/entries')) return ENTRIES;
  if (pathname.endsWith('/documents')) return { documents: [] };
  if (pathname.endsWith('/expenses')) return { expenses: [] };
  if (pathname.endsWith('/bank/transactions')) return { transactions: [] };
  if (pathname.endsWith('/trial-balance')) return { totals: { balanced: true } };
  if (pathname.endsWith('/reports/pnl')) return { income: [], expenses: [], total_income: 0, total_expenses: 0, net_profit: 0 };
  if (pathname.endsWith('/reports/vat')) return { applicable: true, vat_on_sales: 0, vat_on_inputs: 0, balance: 0, disclaimer: 'ד' };
  if (pathname.endsWith('/reports/pending-allocation')) return { count: 0, pending: [] };
  if (pathname.endsWith('/uniform-export')) return { exports: [] };
  if (pathname.endsWith('/bank/reconciliation')) return { by_status: { unmatched: { count: 0 } }, ledger_bank_balance: 0 };
  throw new Error('api לא מכוסה בטסט: ' + pathname);
}

function makeSandbox(overrides = {}){
  const sb = {
    window: { vManage: async () => '<div class="subtabs"></div>' },
    document: {
      addEventListener: (type, fn) => { (sb.__listeners[type] = sb.__listeners[type] || []).push(fn); },
      getElementById: (id) => (overrides.inputs && overrides.inputs[id]) || null,
      querySelectorAll: overrides.querySelectorAll || (() => []),
    },
    __listeners: {},
    state: { memberships: [{ slug: 'x', role: 'owner' }], token: 't' },
    store: { get: () => 'x' },
    api: overrides.api || (async (p) => canned(p)),
    esc: (s) => String(s),
    toast: overrides.toast || (() => {}), route: () => {}, downloadCsv: () => {},
    confirm: () => true,
    fetch: async () => { throw new Error('fetch לא צפוי'); },
    URL, FormData, Promise, Number, String, Date, Set, console,
  };
  vm.createContext(sb);
  return sb;
}

test('רינדור: כרטיס כרטיסים + כרטיס יומן מצורפים ללשונית הנה״ח', async () => {
  const sb = makeSandbox();
  vm.runInContext(SRC_BK, sb); vm.runInContext(SRC_PARTIES, sb); vm.runInContext(SRC_JOURNAL, sb);
  const html = await sb.window.vManage('bookkeeping');
  // T3 — כרטיסים
  assert.ok(html.includes('id="bk-parties-card"'), 'כרטיס הכרטיסים מצורף');
  assert.ok(html.includes('ספק בדיקה') && html.includes('לקוח בדיקה'), 'שורות כרטיסים מוצגות');
  assert.ok(html.includes('id="bk-p-search"'), 'שדה חיפוש קיים');
  assert.ok(html.includes('data-bkp-act="create"'), 'טופס יצירת כרטיס קיים');
  // T3 — ספק חדש inline בטופס ההוצאה
  assert.ok(html.includes('data-bkp-act="sup-toggle"'), 'כפתור ספק חדש בטופס ההוצאה');
  assert.ok(html.includes('id="bk-new-sup" hidden'), 'טופס הספק המוטמע מוסתר כברירת מחדל');
  assert.ok(html.includes('data-bkp-act="sup-create"'), 'כפתור יצירת ספק inline');
  // T55 — יומן
  assert.ok(html.includes('id="bk-journal-card"'), 'כרטיס היומן מצורף');
  assert.ok(html.includes('id="bk-j-lines"'), 'טופס פקודה ידנית קיים');
  assert.ok((html.match(/class="inp bk-j-acc"/g) || []).length === 2, 'שתי שורות התחלתיות בטופס');
  assert.ok(html.includes('פקודה ידנית בדיקה') && html.includes('חשבונית מס 2026-1'), 'פקודות מוצגות');
  assert.ok(html.includes('data-bkj-act="filter"') && html.includes('id="bk-j-from"'), 'סינון תאריכים קיים');
});

test('סטורנו: כפתור רק לפקודה ידנית שלא סווטרנה; מסמך מסומן T42; סווטרנה מסומנת', async () => {
  const sb = makeSandbox();
  vm.runInContext(SRC_BK, sb); vm.runInContext(SRC_PARTIES, sb); vm.runInContext(SRC_JOURNAL, sb);
  const html = await sb.window.vManage('bookkeeping');
  assert.ok(html.includes('data-bkj-act="reverse" data-id="e1"'), 'פקודה ידנית — כפתור סטורנו');
  assert.ok(!html.includes('data-bkj-act="reverse" data-id="e2"'), 'פקודת מסמך — בלי כפתור סטורנו (ממתין ל-T42)');
  assert.ok(!html.includes('data-bkj-act="reverse" data-id="e3"'), 'פקודה שסווטרנה — בלי כפתור נוסף');
  assert.ok(!html.includes('data-bkj-act="reverse" data-id="e4"'), 'פקודת סטורנו — בלי כפתור');
  assert.ok(html.includes('T42'), 'פקודת מסמך מסומנת כממתינה ל-T42');
  assert.ok(html.includes('בוצע סטורנו (#10)'), 'פקודה שסווטרנה מסומנת עם מספר הסטורנו');
});

function clickWith(attrs){
  const btn = { getAttribute: (k) => attrs[k] ?? null };
  return { target: { closest: (sel) => sel === '[data-bkp-act]' || sel === '[data-bkj-act]' ? btn : null } };
}

test('handler: יצירת כרטיס שולחת POST נכון; שם קצר נחסם בלי קריאה', async () => {
  const calls = []; const toasts = [];
  const sb = makeSandbox({
    inputs: {
      'bk-p-kind': { value: 'supplier' }, 'bk-p-name': { value: 'ספק חדש' },
      'bk-p-taxid': { value: '123456789' }, 'bk-p-phone': { value: '' },
      'bk-p-email': { value: '' }, 'bk-p-address': { value: '' },
    },
    api: async (p, o) => { calls.push([p, o]); return { party: {} }; },
    toast: (m) => toasts.push(m),
  });
  vm.runInContext(SRC_PARTIES, sb);
  const handler = sb.__listeners.click[0];
  await handler(clickWith({ 'data-bkp-act': 'create' }));
  assert.strictEqual(calls.length, 1);
  assert.ok(calls[0][0].endsWith('/bookkeeping/parties'));
  const body = JSON.parse(calls[0][1].body);
  assert.strictEqual(body.kind, 'supplier');
  assert.strictEqual(body.name, 'ספק חדש');
  assert.strictEqual(body.tax_id, '123456789');
  assert.strictEqual(body.phone, undefined, 'שדה ריק לא נשלח');

  calls.length = 0;
  sb.document.getElementById = (id) => id === 'bk-p-name' ? { value: 'א' } : { value: '' };
  await handler(clickWith({ 'data-bkp-act': 'create' }));
  assert.strictEqual(calls.length, 0, 'שם קצר מדי — אין POST');
  assert.ok(toasts.some(t => t.includes('שם')), 'הודעת שגיאה למשתמש');
});

test('handler: ספק חדש inline נוצר כ-supplier', async () => {
  const calls = [];
  const sb = makeSandbox({
    inputs: { 'bk-ns-name': { value: 'ספק inline' }, 'bk-ns-taxid': { value: '' }, 'bk-ns-phone': { value: '' } },
    api: async (p, o) => { calls.push([p, o]); return { party: {} }; },
  });
  vm.runInContext(SRC_PARTIES, sb);
  await sb.__listeners.click[0](clickWith({ 'data-bkp-act': 'sup-create' }));
  assert.strictEqual(calls.length, 1);
  const body = JSON.parse(calls[0][1].body);
  assert.strictEqual(body.kind, 'supplier');
  assert.strictEqual(body.name, 'ספק inline');
});

function journalLine(acc, debit, credit){
  return {
    querySelector: (sel) => {
      const map = { '.bk-j-acc': acc, '.bk-j-debit': debit, '.bk-j-credit': credit, '.bk-j-party': '', '.bk-j-details': '' };
      return { value: map[sel] };
    },
  };
}

test('handler: פקודה מאוזנת נרשמת; לא מאוזנת נחסמת בלי POST', async () => {
  const calls = []; const toasts = [];
  const sb = makeSandbox({
    inputs: { 'bk-j-desc': { value: 'פקודת בדיקה' }, 'bk-j-date': { value: '2026-10-17' } },
    querySelectorAll: (sel) => sel === '#bk-j-lines .bk-j-line'
      ? [journalLine('6010', '100', ''), journalLine('1010', '', '100')] : [],
    api: async (p, o) => { calls.push([p, o]); return { entry: { entry_no: 11 } }; },
    toast: (m) => toasts.push(m),
  });
  vm.runInContext(SRC_JOURNAL, sb);
  const handler = sb.__listeners.click[0];
  await handler(clickWith({ 'data-bkj-act': 'submit-entry' }));
  assert.strictEqual(calls.length, 1, 'פקודה מאוזנת נשלחת');
  assert.ok(calls[0][0].endsWith('/bookkeeping/entries'));
  const body = JSON.parse(calls[0][1].body);
  assert.strictEqual(body.entry_date, '2026-10-17');
  assert.strictEqual(body.lines.length, 2);
  assert.strictEqual(body.lines[0].account_code, '6010');
  assert.strictEqual(body.lines[0].debit, 100);
  assert.strictEqual(body.lines[1].credit, 100);

  calls.length = 0;
  sb.document.querySelectorAll = (sel) => sel === '#bk-j-lines .bk-j-line'
    ? [journalLine('6010', '100', ''), journalLine('1010', '', '90')] : [];
  await handler(clickWith({ 'data-bkj-act': 'submit-entry' }));
  assert.strictEqual(calls.length, 0, 'פקודה לא מאוזנת — אין POST');
  assert.ok(toasts.some(t => t.includes('לא מאוזנת')), 'הודעת איזון למשתמש');
});

test('handler: סטורנו שולח POST לנתיב reverse', async () => {
  const calls = [];
  const sb = makeSandbox({ api: async (p, o) => { calls.push([p, o]); return { reversal: { entry_no: 12 } }; } });
  vm.runInContext(SRC_JOURNAL, sb);
  await sb.__listeners.click[0](clickWith({ 'data-bkj-act': 'reverse', 'data-id': 'e1', 'data-no': '7' }));
  assert.strictEqual(calls.length, 1);
  assert.ok(calls[0][0].endsWith('/bookkeeping/entries/e1/reverse'));
  assert.strictEqual(calls[0][1].method, 'POST');
});
