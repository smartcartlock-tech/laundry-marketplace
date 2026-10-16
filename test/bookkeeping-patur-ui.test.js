// הנה״ח UI: עוסק פטור — תפריט סוגי מסמך בלי חשבוניות מס, וללא באנר מספר הקצאה.
// בדיקה התנהגותית: מריצים את public/js/bookkeeping.js ב-vm עם api מדומה ומעבירים דרך vManage.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'bookkeeping.js'), 'utf8');

function canned(pathname, dealerType){
  if (pathname.endsWith('/settings')) return { tenant: { dealer_type: dealerType } };
  if (pathname.endsWith('/accounts')) return { accounts: [] };
  if (pathname.endsWith('/parties')) return { parties: [] };
  if (pathname.endsWith('/documents')) return { documents: [] };
  if (pathname.endsWith('/expenses')) return { expenses: [] };
  if (pathname.endsWith('/bank/transactions')) return { transactions: [] };
  if (pathname.endsWith('/trial-balance')) return { totals: { balanced: true } };
  if (pathname.endsWith('/reports/pnl')) return { income: [], expenses: [], total_income: 0, total_expenses: 0, net_profit: 0 };
  if (pathname.endsWith('/reports/vat')) return dealerType === 'morasha'
    ? { applicable: true, vat_on_sales: 0, vat_on_inputs: 0, balance: 0, disclaimer: 'ד' }
    : { applicable: false, note: 'עוסק פטור' };
  if (pathname.endsWith('/reports/pending-allocation')) return { count: 0, pending: [] };
  if (pathname.endsWith('/uniform-export')) return { exports: [] };
  if (pathname.endsWith('/bank/reconciliation')) return { by_status: { unmatched: { count: 0 } }, ledger_bank_balance: 0 };
  throw new Error('api לא מכוסה בטסט: ' + pathname);
}

async function render(dealerType, role){
  const sb = {
    window: { vManage: async () => '<div class="subtabs"></div>' },
    document: { addEventListener: () => {}, getElementById: () => null },
    state: { memberships: [{ slug: 'x', role }], token: 't' },
    store: { get: () => 'x' },
    api: async (p) => canned(p, dealerType),
    esc: (s) => String(s),
    toast: () => {}, route: () => {}, downloadCsv: () => {},
    fetch: async () => { throw new Error('fetch לא צפוי'); },
    URL, FormData, Promise, Number, String, console,
  };
  vm.createContext(sb);
  vm.runInContext(SRC, sb);
  return sb.window.vManage('bookkeeping');
}

test('עוסק פטור: בלי חשבונית מס/חשבונית מס-קבלה בתפריט, בלי באנר הקצאה', async () => {
  const html = await render('patur', 'owner');
  assert.ok(!html.includes('value="tax_invoice"'), 'חשבונית מס לא תוצע לפטור');
  assert.ok(!html.includes('value="tax_invoice_receipt"'), 'חשבונית מס/קבלה לא תוצע לפטור');
  assert.ok(!html.includes('מספר מבקשים באזור האישי של רשות המסים'), 'באנר ההקצאה מוסתר לפטור');
  assert.ok(html.includes('value="invoice"') && html.includes('value="receipt"'), 'חשבונית עסקה וקבלה נשארות');
  assert.ok(!html.includes('id="bk-exp-vat"'), 'שדה מע״מ בטופס ההוצאה מוסתר לפטור');
  assert.ok(html.includes('הנה״ח'), 'שבב הנה״ח מוצג לבעלים');
});

test('עוסק מורשה: כל ארבעת הסוגים + באנר ההקצאה (רגרסיה)', async () => {
  const html = await render('morasha', 'owner');
  assert.ok(html.includes('value="tax_invoice"'), 'חשבונית מס מוצעת למורשה');
  assert.ok(html.includes('value="tax_invoice_receipt"'), 'חשבונית מס/קבלה מוצעת למורשה');
  assert.ok(html.includes('value="invoice"') && html.includes('value="receipt"'));
  assert.ok(html.includes('מספר מבקשים באזור האישי של רשות המסים'), 'באנר ההקצאה מוצג למורשה');
  assert.ok(html.includes('id="bk-exp-vat"'), 'שדה מע״מ בטופס ההוצאה מוצג למורשה');
});

test('סוג עוסק לא הוגדר: נחשב פטור (תואם לאכיפת השרת)', async () => {
  const html = await render(null, 'owner');
  assert.ok(!html.includes('value="tax_invoice"'), 'ברירת מחדל: בלי חשבוניות מס');
  assert.ok(!html.includes('מספר מבקשים באזור האישי של רשות המסים'));
});

test('staff: שבב הנה״ח לא מתווסף (רגרסיה)', async () => {
  const html = await render('morasha', 'staff');
  assert.ok(!html.includes('הנה״ח'));
});
