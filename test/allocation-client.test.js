// מתאם מספרי הקצאה: כבוי כברירת מחדל, מצב מדומה מסומן, ולידציות לפי המפרט, בלי רשת במצבים off/simulated.
const { test } = require('node:test');
const assert = require('node:assert');

function fresh(env = {}) {
  delete require.cache[require.resolve('../src/allocation-client')];
  for (const k of ['ALLOCATION_MODE', 'SHAAM_CLIENT_ID', 'SHAAM_CLIENT_SECRET', 'SHAAM_TOKEN_URL']) delete process.env[k];
  Object.assign(process.env, env);
  return require('../src/allocation-client');
}
const VALID = {
  invoiceId: 'BK-1', invoiceType: 305, vatNumber: '512345678',
  invoiceReferenceNumber: '1001', customerVatNumber: '511223344',
  paymentAmount: 100, amountVat: 18, paymentAmountIncludingVat: 118,
};

test('allocation: ברירת מחדל כבוי', async () => {
  const c = fresh();
  assert.equal(c.mode(), 'off');
  assert.equal(c.isEnabled(), false);
  const res = await c.requestAllocation(VALID);
  assert.equal(res.ok, false);
  assert.equal(res.status, 'off');
});

test('allocation: מצב מדומה מחזיר מספר מסומן בלי רשת', async () => {
  const c = fresh({ ALLOCATION_MODE: 'simulated' });
  const res = await c.requestAllocation(VALID);
  assert.equal(res.ok, true);
  assert.equal(res.simulated, true);
  assert.match(res.allocation_number, /^000[0-9]{6}$/); // תחילית 000 = מזויף
  assert.match(res.warning, /אסור להדפיס/);
  // דטרמיניסטי לאותו invoice_id
  const again = await c.requestAllocation(VALID);
  assert.equal(again.allocation_number, res.allocation_number);
});

test('allocation: ולידציות מפרט', async () => {
  const c = fresh({ ALLOCATION_MODE: 'simulated' });
  let res = await c.requestAllocation({ ...VALID, vatNumber: '123' });
  assert.equal(res.ok, false);
  assert.match(res.error, /9 ספרות/);
  res = await c.requestAllocation({ ...VALID, invoiceType: 3.5 });
  assert.equal(res.ok, false);
  res = await c.requestAllocation({ ...VALID, invoiceReferenceNumber: 'X'.repeat(21) });
  assert.equal(res.ok, false);
});

test('allocation: sandbox בלי פרטי גישה — לא קורא רשת, מחזיר missing_credentials', async () => {
  const c = fresh({ ALLOCATION_MODE: 'sandbox' });
  const res = await c.requestAllocation(VALID);
  assert.equal(res.ok, false);
  assert.equal(res.status, 'missing_credentials');
});
