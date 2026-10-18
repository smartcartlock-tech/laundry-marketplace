// T94: צעד גביית מזומן חובה לפני סגירת משימת מזומן — 'גביתי ₪X' / סכום אחר / סירב,
// רישום חותמת-זמן בדוח הרווחים + התחשבנות לפי מכבסה.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { startApp } = require('./helpers');
const dayJs = fs.readFileSync('public/js/courier-day.js', 'utf8');

async function cashOrderOutForDelivery(api, admin, customer, courier) {
  const l = await api('/api/laundries/achuza');
  const item = l.json.items[0];
  const r = await api('/api/orders', { method: 'POST', token: customer, body: { slug: 'achuza', items: [{ item_id: item.id, qty: 2 }], address: 'רחוב הגבייה 3, תל אביב' } });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const oid = r.json.order.id;
  await api(`/api/t/achuza/orders/${oid}/status`, { method: 'POST', token: admin, body: { status: 'confirmed' } });
  await api('/api/admin/routes/auto-build', { method: 'POST', token: admin, body: {} });
  await api(`/api/courier/orders/${oid}/mark`, { method: 'POST', token: courier, body: { action: 'picked_up' } });
  await api(`/api/t/achuza/orders/${oid}/status`, { method: 'POST', token: admin, body: { status: 'in_work' } });
  await api(`/api/t/achuza/orders/${oid}/status`, { method: 'POST', token: admin, body: { status: 'ready' } });
  await api(`/api/courier/orders/${oid}/mark`, { method: 'POST', token: courier, body: { action: 'out_for_delivery' } });
  return oid;
}

test('משימת מזומן לא נסגרת בלי אישור גבייה (400 CASH_CONFIRM_REQUIRED)', async (t) => {
  const { api } = await startApp(t);
  const admin = await api.login('+972500000001');
  const customer = await api.login('+972500000002');
  const courier = await api.login('+972500000005');
  const oid = await cashOrderOutForDelivery(api, admin, customer, courier);
  const code = (await api('/api/orders/' + oid, { token: admin })).json.order.delivery_code;
  const noCash = await api(`/api/courier/orders/${oid}/confirm-delivery`, { method: 'POST', token: courier, body: { method: 'code', code } });
  assert.equal(noCash.status, 400, JSON.stringify(noCash.json));
  assert.match(noCash.json.error, /CASH_CONFIRM_REQUIRED|גבייה/, 'שגיאה מסבירה שחסר צעד גבייה');
  const after = await api('/api/orders/' + oid, { token: admin });
  assert.equal(after.json.order.status, 'out_for_delivery', 'ההזמנה לא נסגרה בלי אישור גבייה');
  // גם מסלול /mark delivered חייב צעד גבייה
  const markNoCash = await api(`/api/courier/orders/${oid}/mark`, { method: 'POST', token: courier, body: { action: 'delivered' } });
  assert.equal(markNoCash.status, 400, 'mark delivered ללא גבייה נדחה');
});

test("'גביתי ₪X': ההזמנה נסגרת, נרשם paid_cash, ורשומת גבייה בדוח הרווחים עם התחשבנות למכבסה", async (t) => {
  const { api } = await startApp(t);
  const admin = await api.login('+972500000001');
  const customer = await api.login('+972500000002');
  const courier = await api.login('+972500000005');
  const oid = await cashOrderOutForDelivery(api, admin, customer, courier);
  const total = (await api('/api/orders/' + oid, { token: admin })).json.order.total;
  const code = (await api('/api/orders/' + oid, { token: admin })).json.order.delivery_code;
  const ok = await api(`/api/courier/orders/${oid}/confirm-delivery`, { method: 'POST', token: courier, body: { method: 'code', code, cash: { outcome: 'collected' } } });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  const after = await api('/api/orders/' + oid, { token: admin });
  assert.equal(after.json.order.status, 'delivered');
  assert.equal(after.json.order.payment_status, 'paid_cash', 'גבייה מלאה מסמנת paid_cash');
  const earn = await api('/api/courier/earnings/detail?day=1', { token: courier });
  assert.equal(earn.status, 200, JSON.stringify(earn.json));
  assert.ok(Array.isArray(earn.json.cash) && earn.json.cash.length >= 1, 'רשומת גבייה בדוח הרווחים');
  const row = earn.json.cash.find(c => c.order_id === oid || c.order_address);
  assert.ok(row, 'שורת הגבייה של ההזמנה קיימת');
  assert.equal(row.outcome, 'collected');
  assert.equal(Number(row.amount), Number(total), 'סכום הגבייה = סכום ההזמנה');
  assert.ok(row.at_local, 'חותמת זמן מוצגת');
  assert.ok(row.tenant_name, 'שיוך למכבסה להתחשבנות');
  const tenants = Object.keys(earn.json.cash_by_tenant || {});
  assert.ok(tenants.length >= 1, 'פירוט התחשבנות לפי מכבסה');
  assert.ok(Number(earn.json.cash_total) >= Number(total), 'סה״כ גבייה מצטבר');
});

test("גבייה חלקית ו'סירב': ההזמנה נסגרת אבל התשלום נשאר pending + רשומות נכונות בדוח", async (t) => {
  const { api } = await startApp(t);
  const admin = await api.login('+972500000001');
  const customer = await api.login('+972500000002');
  const courier = await api.login('+972500000005');
  // גבייה חלקית
  const oid1 = await cashOrderOutForDelivery(api, admin, customer, courier);
  const total1 = (await api('/api/orders/' + oid1, { token: admin })).json.order.total;
  const code1 = (await api('/api/orders/' + oid1, { token: admin })).json.order.delivery_code;
  const part = await api(`/api/courier/orders/${oid1}/confirm-delivery`, { method: 'POST', token: courier, body: { method: 'code', code: code1, cash: { outcome: 'partial', amount: Number(total1) - 10, note: 'חסר עודף' } } });
  assert.equal(part.status, 200, JSON.stringify(part.json));
  const after1 = await api('/api/orders/' + oid1, { token: admin });
  assert.equal(after1.json.order.status, 'delivered');
  assert.notEqual(after1.json.order.payment_status, 'paid_cash', 'גבייה חלקית לא מסמנת paid_cash');
  // סירב
  const oid2 = await cashOrderOutForDelivery(api, admin, customer, courier);
  const code2 = (await api('/api/orders/' + oid2, { token: admin })).json.order.delivery_code;
  const ref = await api(`/api/courier/orders/${oid2}/confirm-delivery`, { method: 'POST', token: courier, body: { method: 'code', code: code2, cash: { outcome: 'refused', note: 'לא היה מזומן' } } });
  assert.equal(ref.status, 200, JSON.stringify(ref.json));
  const after2 = await api('/api/orders/' + oid2, { token: admin });
  assert.equal(after2.json.order.status, 'delivered');
  assert.equal(after2.json.order.payment_status, 'pending', 'סירב — התשלום נשאר pending');
  const earn = await api('/api/courier/earnings/detail?day=1', { token: courier });
  const r1 = earn.json.cash.find(c => Number(c.amount) === Number(total1) - 10);
  assert.ok(r1 && r1.outcome === 'partial', 'רשומת גבייה חלקית בדוח');
  assert.equal(r1.note, 'חסר עודף');
  const r2 = earn.json.cash.find(c => c.outcome === 'refused');
  assert.ok(r2, "רשומת 'סירב' בדוח");
  assert.equal(r2.note, 'לא היה מזומן');
});

test('סכום גבייה חלקית לא חוקי נדחה (400)', async (t) => {
  const { api } = await startApp(t);
  const admin = await api.login('+972500000001');
  const customer = await api.login('+972500000002');
  const courier = await api.login('+972500000005');
  const oid = await cashOrderOutForDelivery(api, admin, customer, courier);
  const code = (await api('/api/orders/' + oid, { token: admin })).json.order.delivery_code;
  const bad = await api(`/api/courier/orders/${oid}/confirm-delivery`, { method: 'POST', token: courier, body: { method: 'code', code, cash: { outcome: 'partial' } } });
  assert.equal(bad.status, 400, 'partial בלי סכום נדחה');
});

test('לקוח: צעד גבייה מוצג לפני חלון אישור המסירה במסכי השליח', () => {
  assert.match(dayJs, /function askCashStep\(total\)/, 'חלון צעד הגבייה קיים');
  assert.match(dayJs, /גביתי ₪/, "אפשרות 'גביתי ₪X'");
  assert.match(dayJs, /גביתי סכום אחר/, 'אפשרות סכום אחר');
  assert.match(dayJs, /הלקוח סירב לשלם/, "אפשרות 'סירב'");
  assert.match(dayJs, /cashNeeded\(t\)\?await askCashStep/, 'צעד הגבייה נדרש לפני אישור מסירה');
  assert.match(dayJs, /cash:\s*cashPre|cash:cashPre/, 'אישור הגבייה נשלח לשרת עם המסירה');
  const courierJs = fs.readFileSync('public/js/courier.js', 'utf8');
  assert.match(courierJs, /data-pm=/, 'כפתורי המסירה במסך המשימות נושאים את אופן התשלום לצעד הגבייה');
});
