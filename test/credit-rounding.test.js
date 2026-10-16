// בדיקת תיקון: זיכוי חלקי - amount+vat חייב להשתוות ל-total (תוקן ב-creditSplit, src/documents.js)
const test = require('node:test'); const assert = require('node:assert');
const { creditSplit } = require('../src/documents');
const r2 = x => Math.round(x * 100) / 100;

test('partial credit: amount + vat must equal total', () => {
  const total = 10, net = r2(total / 1.18), vat = r2(total - net); // 8.47 / 1.53
  const s = creditSplit({ amount: net, vat, total, credited_amount: 0 }, 5);
  assert.strictEqual(r2(s.amount + s.vat), -5);
});

test('closing credit: cumulative splits equal the original document exactly', () => {
  const total = 10, net = r2(total / 1.18), vat = r2(total - net);
  const s1 = creditSplit({ amount: net, vat, total, credited_amount: 0 }, 5);
  const s2 = creditSplit({ amount: net, vat, total, credited_amount: 5 }, 5);
  assert.strictEqual(r2(s1.amount + s1.vat), -5);
  assert.strictEqual(r2(s2.amount + s2.vat), -5);
  assert.strictEqual(r2(s1.amount + s2.amount), -net);
  assert.strictEqual(r2(s1.vat + s2.vat), -vat);
});
