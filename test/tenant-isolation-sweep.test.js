// בדיקת בידוד טננטים: סריקה שיטתית של כל ה-API הטננטי עם משתמש זר — כל נתיב חייב 403/404, אף אחד לא דליפת 200
const { test } = require('node:test');
const assert = require('node:assert');
const { startApp } = require('./helpers');

// כל הנתיבים הטננטיים (GET וכתיבה) לפי הראוטרים ב-server.js — התבנית: /api/t/:slug/...
const TENANT_GETS = [
  '/orders', '/items', '/windows', '/coupons', '/settings', '/customers', '/issues', '/checklist',
  '/documents', '/documents/consolidated/eligible', '/clusters', '/couriers', '/couriers/overview',
  '/stats', '/ops/state', '/ops/daily-summary', '/agreement', '/subscriptions', '/plans',
  '/settlement/payments', '/settlement/payments.csv', '/settlement/commission', '/settlement/consistency',
  '/settlement/sequence-check', '/settlement/monthly-summary.pdf', '/settlement/accountant-export.csv',
  '/export/orders.csv', '/export/customers.csv', '/export/courier-payments.csv',
  '/business-accounts', '/financials', '/analytics', '/reports',
  '/bookkeeping/accounts', '/bookkeeping/parties', '/bookkeeping/entries',
  '/bookkeeping/trial-balance', '/bookkeeping/periods',
  '/bookkeeping/expenses', '/bookkeeping/expenses/x/file', '/bookkeeping/documents',
  '/bookkeeping/bank/transactions', '/bookkeeping/bank/reconciliation',
  '/bookkeeping/reports/pnl', '/bookkeeping/reports/vat', '/bookkeeping/reports/pending-allocation',
  '/bookkeeping/accountant-export.csv',
];
const TENANT_WRITES = [
  ['POST', '/items', {}], ['POST', '/windows', {}], ['POST', '/coupons', {}], ['PATCH', '/settings', {}],
  ['POST', '/orders/x/status', {}], ['POST', '/issues/x/handle', {}], ['PUT', '/financials', {}],
  ['POST', '/business-accounts', {}], ['POST', '/ops/closures', {}], ['POST', '/documents/x/credit', {}],
  ['POST', '/clusters', {}], ['POST', '/export/consolidated', {}],
  ['POST', '/bookkeeping/init', {}], ['POST', '/bookkeeping/accounts', {}],
  ['POST', '/bookkeeping/parties', {}], ['POST', '/bookkeeping/entries', {}],
  ['POST', '/bookkeeping/entries/x/reverse', {}], ['POST', '/bookkeeping/periods/close', {}],
  ['POST', '/bookkeeping/expenses', {}], ['POST', '/bookkeeping/expenses/x/post', {}],
  ['POST', '/bookkeeping/expenses/x/void', {}],
  ['POST', '/bookkeeping/documents', {}], ['POST', '/bookkeeping/documents/x/allocate', {}],
  ['POST', '/bookkeeping/documents/x/issue', {}], ['POST', '/bookkeeping/documents/x/cancel', {}],
];

test('סריקת בידוד: זר לא מקבל דבר מאף נתיב טננטי', async (t) => {
  const { api } = await startApp(t);
  const stranger = await api.login('+972500000921', 'זר סריקה');
  const failures = [];
  for (const slug of ['express', 'achuza']) {
    for (const p of TENANT_GETS) {
      const r = await api(`/api/t/${slug}${p}`, { token: stranger });
      if (![401, 403, 404, 429].includes(r.status)) failures.push(`GET ${slug}${p} → ${r.status}`);
    }
    for (const [m, p, body] of TENANT_WRITES) {
      const r = await api(`/api/t/${slug}${p}`, { method: m, token: stranger, body });
      if (![401, 403, 404, 429].includes(r.status)) failures.push(`${m} ${slug}${p} → ${r.status}`);
    }
  }
  assert.deepEqual(failures, [], 'נתיבים דולפים:\n' + failures.join('\n'));
});
