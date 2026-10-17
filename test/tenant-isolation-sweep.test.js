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
  '/bookkeeping/accounts', '/bookkeeping/parties', '/bookkeeping/accounts/1020/ledger', '/bookkeeping/parties/x/ledger', '/bookkeeping/reports/balance-sheet', '/bookkeeping/entries',
  '/bookkeeping/trial-balance', '/bookkeeping/periods',
  '/bookkeeping/expenses', '/bookkeeping/expenses/x/file', '/bookkeeping/documents', '/bookkeeping/documents/x/pdf',
  '/bookkeeping/bank/transactions', '/bookkeeping/bank/reconciliation',
  '/bookkeeping/reports/pnl', '/bookkeeping/reports/vat', '/bookkeeping/reports/pending-allocation',
  '/bookkeeping/accountant-export.csv',
  '/bookkeeping/uniform-export', '/bookkeeping/uniform-export/x/ini', '/bookkeeping/uniform-export/x/bkmv',
];
// מודול הנה"ח (K) — בדיקה שגם staff (חבר, לא בעלים) נדחה, לא רק זר
const BOOKKEEPING_GETS = ['/bookkeeping/accounts', '/bookkeeping/parties', '/bookkeeping/accounts/1020/ledger', '/bookkeeping/parties/x/ledger', '/bookkeeping/reports/balance-sheet', '/bookkeeping/entries', '/bookkeeping/trial-balance', '/bookkeeping/periods'];
const BOOKKEEPING_WRITES = [['POST', '/bookkeeping/init'], ['POST', '/bookkeeping/accounts'], ['POST', '/bookkeeping/parties'], ['POST', '/bookkeeping/entries'], ['POST', '/bookkeeping/periods/close']];

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
  ['POST', '/bookkeeping/uniform-export', {}],
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

test('הנה"ח: זר ו-staff שניהם נדחים (בעלים בלבד), בעלים עובד', async (t) => {
  const { api, schema } = await startApp(t);
  const { Client } = require('pg');
  const db = new Client({ connectionString: process.env.TEST_DATABASE_URL || 'postgres://postgres@127.0.0.1:5433/laundry_test' });
  await db.connect(); t.after(() => db.end());
  await db.query(`SET search_path TO ${schema}, public`);

  const owner = await api.login('+972500000931');
  const staff = await api.login('+972500000932');
  const stranger = await api.login('+972500000933');
  const { rows: [ten] } = await db.query(`INSERT INTO tenants(slug, name) VALUES ('bkk', 'מכבסת הנהח') RETURNING id`);
  await db.query(`INSERT INTO tenant_members(tenant_id, user_id, role)
    SELECT $1, id, 'owner' FROM users WHERE phone='+972500000931'`, [ten.id]);
  await db.query(`INSERT INTO tenant_members(tenant_id, user_id, role)
    SELECT $1, id, 'staff' FROM users WHERE phone='+972500000932'`, [ten.id]);

  for (const [label, token, expect] of [['stranger', stranger, 403], ['staff', staff, 403]]) {
    for (const p of BOOKKEEPING_GETS) {
      const r = await api(`/api/t/bkk${p}`, { token });
      assert.equal(r.status, expect, `${label} GET ${p} → ${r.status}`);
    }
    for (const [m, p] of BOOKKEEPING_WRITES) {
      const r = await api(`/api/t/bkk${p}`, { method: m, token, body: {} });
      assert.equal(r.status, expect, `${label} ${m} ${p} → ${r.status}`);
    }
    // גם financials (נתוני בנק) — staff נדחה
    assert.equal((await api('/api/t/bkk/financials', { token })).status, expect, label + ' financials');
  }

  // בעלים: init + קריאת חשבונות עובדים
  const init = await api('/api/t/bkk/bookkeeping/init', { method: 'POST', token: owner, body: {} });
  assert.ok([200, 201, 400].includes(init.status), 'owner init: ' + init.status);
  const acc = await api('/api/t/bkk/bookkeeping/accounts', { token: owner });
  assert.equal(acc.status, 200, 'owner accounts: ' + acc.status);
});
