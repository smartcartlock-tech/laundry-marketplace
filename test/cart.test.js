// E14.T1: עגלה בענן — שמירה, קריאה, דריסה, ניקוי, ולידציה, הפרדת משתמשים.
const { test } = require('node:test');
const assert = require('node:assert');
const { startApp } = require('./helpers');

test('cart: PUT/GET/ניקוי, ולידציה, הפרדה בין משתמשים', async (t) => {
  const { api } = await startApp(t);
  const a = await api.login('+972500000002');
  const b = await api.login('+972500000006', 'לקוחה נוספת');

  // עגלה ריקה בהתחלה
  const empty = await api('/api/cart', { token: a });
  assert.deepStrictEqual(empty.json.items, []);

  const items = [
    { slug: 'achuza', item_id: 'x1', name: 'שק כביסה', price: 56, unit: 'item', qty: 2 },
    { slug: 'carmel', item_id: 'y2', name: 'חולצה', price: 8, unit: 'item', qty: 1 },
  ];
  const put = await api('/api/cart', { method: 'PUT', token: a, body: { items } });
  assert.strictEqual(put.status, 200, JSON.stringify(put.json));
  assert.strictEqual(put.json.items.length, 2);

  const got = await api('/api/cart', { token: a });
  assert.strictEqual(got.json.items.length, 2);
  assert.strictEqual(got.json.items[0].qty, 2);

  // דריסה מלאה (לא merge)
  const put2 = await api('/api/cart', { method: 'PUT', token: a, body: { items: [items[1]] } });
  assert.strictEqual(put2.json.items.length, 1);

  // ולידציות
  const badQty = await api('/api/cart', { method: 'PUT', token: a, body: { items: [{ slug: 'a', item_id: 'b', qty: 0 }] } });
  assert.strictEqual(badQty.status, 400);
  const notArr = await api('/api/cart', { method: 'PUT', token: a, body: { items: 'nope' } });
  assert.strictEqual(notArr.status, 400);
  const badUnit = await api('/api/cart', { method: 'PUT', token: a, body: { items: [{ slug: 'a', item_id: 'b', qty: 1, unit: 'ton' }] } });
  assert.strictEqual(badUnit.status, 200);
  assert.strictEqual(badUnit.json.items[0].unit, 'item'); // unit לא מוכר מנורמל ל-item

  // הפרדה בין משתמשים
  const gotB = await api('/api/cart', { token: b });
  assert.deepStrictEqual(gotB.json.items, []);

  // מערך ריק מנקה את הרשומה
  await api('/api/cart', { method: 'PUT', token: a, body: { items: [] } });
  const cleared = await api('/api/cart', { token: a });
  assert.deepStrictEqual(cleared.json.items, []);

  // ללא אימות
  const noauth = await api('/api/cart');
  assert.strictEqual(noauth.status, 401);
});
