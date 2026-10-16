// E13.T2: כתובות שמורות — יצירה, idempotency, גבולות, הרשאות, מחיקה.
const { test } = require('node:test');
const assert = require('node:assert');
const { startApp } = require('./helpers');

test('addresses: CRUD, כפילות idempotent, מגבלת 20, הפרדת משתמשים', async (t) => {
  const { api } = await startApp(t);
  const a = await api.login('+972500000002');
  const b = await api.login('+972500000006', 'לקוחה נוספת');

  // ללא אימות נדחה
  const noauth = await api('/api/addresses');
  assert.strictEqual(noauth.status, 401);

  // כתובת קצרה מדי נדחית
  const short = await api('/api/addresses', { method: 'POST', token: a, body: { address: 'רח' } });
  assert.strictEqual(short.status, 400);

  // יצירה תקינה עם תווית ברירת מחדל
  const mk = await api('/api/addresses', { method: 'POST', token: a, body: { address: 'הרצל 12, חולון' } });
  assert.strictEqual(mk.status, 201, JSON.stringify(mk.json));
  assert.strictEqual(mk.json.address.label, 'בית');

  // כפילות — מחזירה את הקיימת בלי ליצור חדשה
  const dup = await api('/api/addresses', { method: 'POST', token: a, body: { address: 'הרצל 12, חולון', label: 'עבודה' } });
  assert.strictEqual(dup.status, 200);
  assert.strictEqual(dup.json.existing, true);

  const list = await api('/api/addresses', { token: a });
  assert.strictEqual(list.json.addresses.length, 1);

  // כתובת שנייה עם תווית
  const mk2 = await api('/api/addresses', { method: 'POST', token: a, body: { address: 'דיזנגוף 99, תל אביב', label: 'עבודה' } });
  assert.strictEqual(mk2.status, 201);
  assert.strictEqual(mk2.json.address.label, 'עבודה');

  // משתמש אחר לא רואה ולא מוחק
  const listB = await api('/api/addresses', { token: b });
  assert.strictEqual(listB.json.addresses.length, 0);
  const delB = await api('/api/addresses/' + mk.json.address.id, { method: 'DELETE', token: b });
  assert.strictEqual(delB.status, 404);

  // מילוי עד המגבלה (20)
  for (let i = 0; i < 20; i++) {
    const m = await api('/api/addresses', { method: 'POST', token: b, body: { address: `רחוב ${i} מספר ${i}, באר שבע` } });
    assert.strictEqual(m.status, 201);
  }
  const over = await api('/api/addresses', { method: 'POST', token: b, body: { address: 'כתובת נוספת מעבר למגבלה, באר שבע' } });
  assert.strictEqual(over.status, 409);

  // מחיקה של הבעלים עובדת
  const del = await api('/api/addresses/' + mk.json.address.id, { method: 'DELETE', token: a });
  assert.strictEqual(del.status, 200);
  const after = await api('/api/addresses', { token: a });
  assert.strictEqual(after.json.addresses.length, 1);
});
