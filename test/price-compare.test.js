// E14.T2: השוואת מחירים — הזול ביותר אצל מתחרים, רק כשזול יותר, אותה יחידה.
const { test } = require('node:test');
const assert = require('node:assert');
const { startApp } = require('./helpers');

test('price-compare: מחזיר מתחרה זול יותר לאותו פריט, ולא מחזיר כשאין זול יותר', async (t) => {
  const { api } = await startApp(t);

  const r = await api('/api/laundries/achuza/price-compare');
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  const cmp = r.json.compare;

  // "שק כביסה (עד 8 ק״ג)" עולה 56 באחוזה; קרמל מוכר ב-49 → הזול ביותר
  const bag = cmp['שק כביסה (עד 8 ק״ג)|bag'];
  assert.ok(bag, 'צפויה השוואה לשק כביסה');
  assert.strictEqual(bag.other_price, 49);
  assert.strictEqual(bag.my_price, 56);

  // "חולצה — כביסה וקיפול" ב-8; אקספרס ב-7
  const shirt = cmp['חולצה — כביסה וקיפול|item'];
  assert.ok(shirt);
  assert.strictEqual(shirt.other_price, 7);

  // "חליפה — ניקוי יבש" קיימת רק באחוזה → לא מופיעה
  assert.ok(!cmp['חליפה — ניקוי יבש|item']);

  // מבטיח שלא מוחזרים פריטים שבהם אחוזה הזולה ביותר או שווה
  for (const k of Object.keys(cmp)) assert.ok(cmp[k].other_price < cmp[k].my_price);

  // מכבסה לא קיימת
  const nf = await api('/api/laundries/no-such/price-compare');
  assert.strictEqual(nf.status, 404);
});
