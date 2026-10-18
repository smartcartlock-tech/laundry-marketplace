// T121: צעד שקילה/עדכון מחיר עם אישור לקוח לפני גבייה.
// קריטריון: שק 9 ק"ג מעדכן מחיר, הלקוח מאשר, החשבונית מתעדכנת לפני גבייה.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { startApp } = require('./helpers');
const trackJs = fs.readFileSync('public/js/track.js', 'utf8');
const communityJs = fs.readFileSync('public/js/community.js', 'utf8');

async function orderInWork(api, admin, customer) {
  const l = await api('/api/laundries/achuza');
  const items = l.json.items.slice(0, 2);
  const r = await api('/api/orders', { method: 'POST', token: customer, body: { slug: 'achuza', items: items.map(i => ({ item_id: i.id, qty: 1 })), address: 'רחוב השקילה 9, תל אביב' } });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const oid = r.json.order.id;
  for (const st of ['confirmed']) await api(`/api/t/achuza/orders/${oid}/status`, { method: 'POST', token: admin, body: { status: st } });
  await api(`/api/t/achuza/orders/${oid}/self-deliver`, { method: 'POST', token: admin });
  for (const st of ['picked_up', 'in_work']) await api(`/api/t/achuza/orders/${oid}/status`, { method: 'POST', token: admin, body: { status: st } });
  return { oid, items };
}

test('שקילה: הבעלים מעדכן כמויות, ההצעה ממתינה לאישור, והלקוח רואה אותה', async (t) => {
  const { api } = await startApp(t);
  const admin = await api.login('+972500000001');
  const customer = await api.login('+972500000002');
  const { oid, items } = await orderInWork(api, admin, customer);
  const before = (await api('/api/orders/' + oid, { token: customer })).json.order;
  const upd = await api(`/api/t/achuza/orders/${oid}/weight-update`, { method: 'POST', token: admin, body: { items: [{ item_id: items[0].id, qty: 3 }, { item_id: items[1].id, qty: 1 }], note: 'שק 9 ק"ג' } });
  assert.equal(upd.status, 200, JSON.stringify(upd.json));
  assert.equal(upd.json.price_update.status, 'pending');
  assert.ok(upd.json.price_update.to_total > Number(before.total), 'הסכום גדל אחרי שקילה');
  // ההזמנה עצמה עוד לא השתנתה
  const mid = (await api('/api/orders/' + oid, { token: customer })).json.order;
  assert.equal(Number(mid.total), Number(before.total), 'החיוב לא משתנה לפני אישור');
  assert.equal(mid.price_update.status, 'pending', 'הלקוח רואה את ההצעה הממתינה');
  // כפילות: עדכון שני בזמן שממתין נדחה
  const dup = await api(`/api/t/achuza/orders/${oid}/weight-update`, { method: 'POST', token: admin, body: { items: [{ item_id: items[0].id, qty: 5 }] } });
  assert.equal(dup.status, 409, 'עדכון כפול בזמן המתנה נדחה');
});

test('אישור לקוח: הסכום והפריטים מתעדכנים לפני הגבייה; סגירת מסירה חסומה בזמן המתנה', async (t) => {
  const { api } = await startApp(t);
  const admin = await api.login('+972500000001');
  const customer = await api.login('+972500000002');
  const { oid, items } = await orderInWork(api, admin, customer);
  const upd = await api(`/api/t/achuza/orders/${oid}/weight-update`, { method: 'POST', token: admin, body: { items: [{ item_id: items[0].id, qty: 3 }, { item_id: items[1].id, qty: 1 }], note: 'שק 9 ק"ג' } });
  const newTotal = upd.json.price_update.to_total;
  // חסימת מסירה בזמן המתנה (נתיב הבעלים)
  await api(`/api/t/achuza/orders/${oid}/status`, { method: 'POST', token: admin, body: { status: 'ready' } });
  await api(`/api/t/achuza/orders/${oid}/status`, { method: 'POST', token: admin, body: { status: 'out_for_delivery' } });
  const blocked = await api(`/api/t/achuza/orders/${oid}/status`, { method: 'POST', token: admin, body: { status: 'delivered' } });
  assert.equal(blocked.status, 409, 'מסירה חסומה בזמן המתנה לאישור מחיר');
  assert.match(blocked.json.error, /עדכון המחיר|אישור הלקוח/);
  // אישור
  const res = await api(`/api/orders/${oid}/price-update/respond`, { method: 'POST', token: customer, body: { approve: true } });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  const after = (await api('/api/orders/' + oid, { token: customer })).json;
  assert.equal(Number(after.order.total), Number(newTotal), 'החיוב עודכן אחרי אישור');
  assert.equal(after.order.price_update.status, 'approved');
  const item0 = after.items.find(i => i.name && after.items.length);
  assert.ok(after.items.some(i => Number(i.qty) === 3), 'כמות השקילה עודכנה בפריטים');
  // עכשיו המסירה אפשרית על הסכום המאושר
  const done = await api(`/api/t/achuza/orders/${oid}/status`, { method: 'POST', token: admin, body: { status: 'delivered' } });
  assert.equal(done.status, 200, 'אחרי אישור אפשר למסור');
  // אישור כפול נדחה
  const again = await api(`/api/orders/${oid}/price-update/respond`, { method: 'POST', token: customer, body: { approve: true } });
  assert.equal(again.status, 409);
});

test('דחיית לקוח: הסכום נשאר כפי שהיה והמסירה מתאפשרת על המקורי', async (t) => {
  const { api } = await startApp(t);
  const admin = await api.login('+972500000001');
  const customer = await api.login('+972500000002');
  const { oid, items } = await orderInWork(api, admin, customer);
  const before = (await api('/api/orders/' + oid, { token: customer })).json.order;
  await api(`/api/t/achuza/orders/${oid}/weight-update`, { method: 'POST', token: admin, body: { items: [{ item_id: items[0].id, qty: 4 }, { item_id: items[1].id, qty: 1 }] } });
  const res = await api(`/api/orders/${oid}/price-update/respond`, { method: 'POST', token: customer, body: { approve: false } });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  const after = (await api('/api/orders/' + oid, { token: customer })).json.order;
  assert.equal(Number(after.total), Number(before.total), 'דחייה משאירה את הסכום המקורי');
  assert.equal(after.price_update.status, 'rejected');
  for (const st of ['ready', 'out_for_delivery', 'delivered']) {
    const s = await api(`/api/t/achuza/orders/${oid}/status`, { method: 'POST', token: admin, body: { status: st } });
    assert.equal(s.status, 200, st);
  }
});

test('בידוד: לקוח אחר לא יכול לאשר עדכון מחיר של הזמנה זרה', async (t) => {
  const { api } = await startApp(t);
  const admin = await api.login('+972500000001');
  const customer = await api.login('+972500000002');
  const other = await api.login('+972500000004');
  const { oid, items } = await orderInWork(api, admin, customer);
  await api(`/api/t/achuza/orders/${oid}/weight-update`, { method: 'POST', token: admin, body: { items: [{ item_id: items[0].id, qty: 2 }, { item_id: items[1].id, qty: 1 }] } });
  const res = await api(`/api/orders/${oid}/price-update/respond`, { method: 'POST', token: other, body: { approve: true } });
  assert.equal(res.status, 404, 'לקוח זר לא מקבל גישה להזמנה');
});

test('לקוח: כרטיס אישור מחיר במעקב + כפתור שקילה אצל הבעלים', () => {
  assert.match(trackJs, /עדכון מחיר אחרי שקילה/, 'כותרת כרטיס האישור');
  assert.match(trackJs, /מאשר את המחיר/, 'כפתור אישור');
  assert.match(trackJs, /price-update\/respond/, 'קריאת האישור לשרת');
  assert.match(trackJs, /הגבייה תתבצע רק על הסכום שאושר/, 'הסבר שהחיוב מותנה באישור');
  assert.match(communityJs, /data-act="weighUpdate"/, 'כפתור שקילה אצל הבעלים');
  assert.match(communityJs, /weight-update/, 'קריאת עדכון השקילה');
});
