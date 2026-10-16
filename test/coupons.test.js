// E1.T1/E1.T3: מנוע קופונים — יצירה (מכבסה), תיקוף, מימוש בהזמנה, מגבלות.
const { test } = require('node:test');
const assert = require('node:assert');
const { startApp } = require('./helpers');

test('coupons: יצירה, מימוש אחוז/סכום, תוקף, מינימום, מגבלות', async (t) => {
  const { api } = await startApp(t);
  const owner = await api.login('+972500000003');
  const cust = await api.login('+972500000002');
  const cust2 = await api.login('+972500000006', 'לקוחה נוספת');

  // פרטי מכבסה + פריט להזמנות
  const laundry = await api('/api/laundries/achuza');
  const items = laundry.json.items;
  const bag = items.find(i => i.name.includes('שק'));

  // יצירת קופון 10% — מכבסה
  const mk = await api('/api/t/achuza/coupons', { method: 'POST', token: owner,
    body: { code: 'SAVE10', kind: 'percent', value: 10 } });
  assert.strictEqual(mk.status, 201, JSON.stringify(mk.json));
  assert.strictEqual(mk.json.coupon.code, 'SAVE10');

  // קוד כפול נדחה
  const dup = await api('/api/t/achuza/coupons', { method: 'POST', token: owner,
    body: { code: 'save10', kind: 'amount', value: 5 } });
  assert.strictEqual(dup.status, 409);

  // לקוח רגיל לא יכול ליצור קופון
  const forbidden = await api('/api/t/achuza/coupons', { method: 'POST', token: cust,
    body: { code: 'HACK', kind: 'percent', value: 50 } });
  assert.strictEqual(forbidden.status, 403);

  // תצוגה מקדימה בעגלה
  const subtotal = Number(bag.price) * 2;
  const prev = await api('/api/orders/validate-coupon', { method: 'POST', token: cust,
    body: { slug: 'achuza', code: 'save10', subtotal } });
  assert.strictEqual(prev.status, 200, JSON.stringify(prev.json));
  assert.strictEqual(prev.json.discount, Math.round(subtotal * 10) / 100);

  // מימוש אחוז בהזמנה: הנחה נכונה ו-total מעודכן
  const o1 = await api('/api/orders', { method: 'POST', token: cust,
    body: { slug: 'achuza', items: [{ item_id: bag.id, qty: 2 }], address: 'בדיקה 1', coupon_code: 'SAVE10' } });
  assert.strictEqual(o1.status, 201, JSON.stringify(o1.json));
  const fee = Number(laundry.json.laundry.delivery_fee || 0);
  assert.strictEqual(Number(o1.json.order.discount), Math.round(subtotal * 10) / 100);
  assert.strictEqual(Number(o1.json.order.total), subtotal + fee - Math.round(subtotal * 10) / 100);

  // used_count עלה
  const lst = await api('/api/t/achuza/coupons', { token: owner });
  const sc = lst.json.coupons.find(c => c.code === 'SAVE10');
  assert.strictEqual(sc.used_count, 1);
  assert.strictEqual(sc.redemptions, 1);

  // קופון סכום קבוע עם מינימום הזמנה
  await api('/api/t/achuza/coupons', { method: 'POST', token: owner,
    body: { code: 'FLAT20', kind: 'amount', value: 20, min_order: 100 } });
  // מתחת למינימום — נדחה (שק בודד < 100)
  const small = await api('/api/orders', { method: 'POST', token: cust,
    body: { slug: 'achuza', items: [{ item_id: bag.id, qty: 1 }], address: 'בדיקה 2', coupon_code: 'FLAT20' } });
  assert.strictEqual(small.status, 409);
  assert.match(small.json.error, /מסכום/);
  // מעל המינימום — עובד, ההנחה בדיוק 20
  const big = await api('/api/orders', { method: 'POST', token: cust,
    body: { slug: 'achuza', items: [{ item_id: bag.id, qty: 3 }], address: 'בדיקה 2', coupon_code: 'FLAT20' } });
  assert.strictEqual(big.status, 201, JSON.stringify(big.json));
  assert.strictEqual(Number(big.json.order.discount), 20);

  // קופון שפג תוקף — נדחה
  await api('/api/t/achuza/coupons', { method: 'POST', token: owner,
    body: { code: 'OLD', kind: 'percent', value: 5, expires_at: '2020-01-01T00:00:00Z' } });
  const expired = await api('/api/orders/validate-coupon', { method: 'POST', token: cust,
    body: { slug: 'achuza', code: 'OLD', subtotal: 100 } });
  assert.strictEqual(expired.status, 409);
  assert.match(expired.json.error, /פג תוקף/);

  // מגבלת שימוש כוללת = 1: הראשון מצליח, השני נדחה
  await api('/api/t/achuza/coupons', { method: 'POST', token: owner,
    body: { code: 'ONCE', kind: 'amount', value: 5, usage_limit: 1 } });
  const first = await api('/api/orders', { method: 'POST', token: cust,
    body: { slug: 'achuza', items: [{ item_id: bag.id, qty: 1 }], address: 'בדיקה 3', coupon_code: 'ONCE' } });
  assert.strictEqual(first.status, 201);
  const second = await api('/api/orders', { method: 'POST', token: cust2,
    body: { slug: 'achuza', items: [{ item_id: bag.id, qty: 1 }], address: 'בדיקה 3', coupon_code: 'ONCE' } });
  assert.strictEqual(second.status, 409);
  assert.match(second.json.error, /מוצה/);

  // מגבלה פר-משתמש = 1
  await api('/api/t/achuza/coupons', { method: 'POST', token: owner,
    body: { code: 'PERUSER', kind: 'percent', value: 15, per_user_limit: 1 } });
  const pu1 = await api('/api/orders', { method: 'POST', token: cust,
    body: { slug: 'achuza', items: [{ item_id: bag.id, qty: 1 }], address: 'בדיקה 4', coupon_code: 'PERUSER' } });
  assert.strictEqual(pu1.status, 201);
  const pu2 = await api('/api/orders', { method: 'POST', token: cust,
    body: { slug: 'achuza', items: [{ item_id: bag.id, qty: 1 }], address: 'בדיקה 4', coupon_code: 'PERUSER' } });
  assert.strictEqual(pu2.status, 409);
  assert.match(pu2.json.error, /ניצלת/);
  // משתמש אחר עדיין יכול
  const pu3 = await api('/api/orders', { method: 'POST', token: cust2,
    body: { slug: 'achuza', items: [{ item_id: bag.id, qty: 1 }], address: 'בדיקה 4', coupon_code: 'PERUSER' } });
  assert.strictEqual(pu3.status, 201);

  // השבתה — קופון מושבת נדחה
  const all = await api('/api/t/achuza/coupons', { token: owner });
  const s10 = all.json.coupons.find(c => c.code === 'SAVE10');
  const dis = await api(`/api/t/achuza/coupons/${s10.id}`, { method: 'PATCH', token: owner, body: { active: false } });
  assert.strictEqual(dis.status, 200);
  assert.strictEqual(dis.json.coupon.active, false);
  const gone = await api('/api/orders/validate-coupon', { method: 'POST', token: cust,
    body: { slug: 'achuza', code: 'SAVE10', subtotal: 100 } });
  assert.strictEqual(gone.status, 404);

  // קופון לא קיים
  const nope = await api('/api/orders/validate-coupon', { method: 'POST', token: cust,
    body: { slug: 'achuza', code: 'NOSUCH', subtotal: 100 } });
  assert.strictEqual(nope.status, 404);
});
