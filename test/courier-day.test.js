// מסך שליח: רשימת משימות מקובצת, מסלול יום, אישור מסירה בקוד/צילום, הרשאות תפקיד שליח
const { test } = require('node:test');
const assert = require('node:assert');
const { startApp } = require('./helpers');

async function makeOrder(api, token, slug) {
  const l = await api('/api/laundries/' + slug);
  const item = l.json.items[0];
  const r = await api('/api/orders', { method: 'POST', token, body: { slug, items: [{ item_id: item.id, qty: 1 }], address: 'רחוב הבדיקה 1, תל אביב' } });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return r.json.order.id;
}

// T93: קוד המסירה החד-פעמי נשלף כלקוח (4 ספרות הטלפון בוטלו)
async function getDeliveryCode(api, customer, oid) {
  const r = await api('/api/orders/' + oid, { token: customer });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json.order.delivery_code;
}

async function confirmAndAssign(api, admin, slug, oid) {
  const c = await api(`/api/t/${slug}/orders/${oid}/status`, { method: 'POST', token: admin, body: { status: 'confirmed' } });
  assert.equal(c.status, 200, JSON.stringify(c.json));
  const build = await api('/api/admin/routes/auto-build', { method: 'POST', token: admin, body: {} });
  assert.equal(build.status, 200, JSON.stringify(build.json));
}

test('מסך שליח: משימות מקובצות, מסלול יום, אישור מסירה בקוד, הרשאות', async (t) => {
  const { api } = await startApp(t);
  const admin = await api.login('+972500000001');
  const customer = await api.login('+972500000002');
  const courier = await api.login('+972500000005');

  // הרשאות: אורח נדחה, לקוח רגיל נדחה (נדרש תפקיד שליח מאושר)
  assert.equal((await api('/api/courier/tasks')).status, 401);
  assert.equal((await api('/api/courier/tasks', { token: customer })).status, 403);
  assert.equal((await api('/api/courier/day-route')).status, 401);
  assert.equal((await api('/api/courier/day-route', { token: customer })).status, 403);

  const o1 = await makeOrder(api, customer, 'achuza');
  await confirmAndAssign(api, admin, 'achuza', o1);

  // משימות: ההזמנה בקבוצת האיסופים
  let tasks = await api('/api/courier/tasks', { token: courier });
  assert.equal(tasks.status, 200, JSON.stringify(tasks.json));
  assert.ok(tasks.json.tasks.pickups.find(x => x.id === o1), 'order in pickups');
  assert.equal(tasks.json.counts.pickups, tasks.json.tasks.pickups.length);

  // מסלול יום: נקודת איסוף בכתובת הלקוח
  let dr = await api('/api/courier/day-route', { token: courier });
  assert.equal(dr.status, 200);
  let stop = dr.json.stops.find(s => s.order.id === o1);
  assert.ok(stop, 'stop exists');
  assert.equal(stop.kind, 'pickup');
  assert.equal(stop.done, false);
  assert.equal(stop.stop_address, 'רחוב הבדיקה 1, תל אביב');
  assert.equal(dr.json.summary.remaining, dr.json.stops.filter(s => !s.done).length);

  // סימון נאסף → עובר ל"אצל המכבסה"
  const m = await api(`/api/courier/orders/${o1}/mark`, { method: 'POST', token: courier, body: { action: 'picked_up' } });
  assert.equal(m.status, 200, JSON.stringify(m.json));
  tasks = await api('/api/courier/tasks', { token: courier });
  assert.ok(tasks.json.tasks.in_laundry.find(x => x.id === o1), 'order in in_laundry');
  assert.ok(!tasks.json.tasks.pickups.find(x => x.id === o1));

  // מוכנה → משימת מסירה; מסלול: נקודת איסוף מהמכבסה בכתובת המכבסה
  await api(`/api/t/achuza/orders/${o1}/status`, { method: 'POST', token: admin, body: { status: 'in_work' } });
  await api(`/api/t/achuza/orders/${o1}/status`, { method: 'POST', token: admin, body: { status: 'ready' } });
  tasks = await api('/api/courier/tasks', { token: courier });
  assert.ok(tasks.json.tasks.deliveries.find(x => x.id === o1), 'order in deliveries');
  dr = await api('/api/courier/day-route', { token: courier });
  stop = dr.json.stops.find(s => s.order.id === o1);
  assert.equal(stop.kind, 'collect');

  // אישור מסירה: קוד שגוי נדחה, קוד נכון (4 ספרות אחרונות של טלפון הלקוח) מאשר
  await api(`/api/courier/orders/${o1}/mark`, { method: 'POST', token: courier, body: { action: 'out_for_delivery' } });
  const badMethod = await api(`/api/courier/orders/${o1}/confirm-delivery`, { method: 'POST', token: courier, body: { method: 'sms' } });
  assert.equal(badMethod.status, 400);
  const wrongCode = await api(`/api/courier/orders/${o1}/confirm-delivery`, { method: 'POST', token: courier, body: { method: 'code', code: '9999' } });
  assert.equal(wrongCode.status, 400);
  const dc1 = await getDeliveryCode(api, customer, o1);
  assert.match(dc1, /^\d{6}$/, 'קוד מסירה בן 6 ספרות');
  // מסלול 4 ספרות הטלפון בוטל — 4 הספרות האחרונות אינן מתקבלות יותר
  const last4 = await api(`/api/courier/orders/${o1}/confirm-delivery`, { method: 'POST', token: courier, body: { method: 'code', code: '0002' } });
  assert.equal(last4.status, 400, 'מסלול 4 ספרות בוטל');
  const okCode = await api(`/api/courier/orders/${o1}/confirm-delivery`, { method: 'POST', token: courier, body: { method: 'code', code: dc1 } });
  assert.equal(okCode.status, 200, JSON.stringify(okCode.json));
  assert.equal(okCode.json.confirmed, true);

  // כפילות נדחית; ההזמנה מופיעה ב"הושלמו היום" עם פרטי האישור
  const dup = await api(`/api/courier/orders/${o1}/confirm-delivery`, { method: 'POST', token: courier, body: { method: 'code', code: dc1 } });
  assert.equal(dup.status, 409);
  tasks = await api('/api/courier/tasks', { token: courier });
  const done = tasks.json.tasks.done_today.find(x => x.id === o1);
  assert.ok(done, 'order in done_today');
  assert.equal(done.status, 'delivered');
  assert.equal(done.confirmation && done.confirmation.method, 'code');

  // שליח אחר לא יכול לאשר מסירה על הזמנה שלא שלו
  const o2 = await makeOrder(api, customer, 'achuza');
  await confirmAndAssign(api, admin, 'achuza', o2);
  const other = await api.login('+972500000004'); // שליח מכבסה
  const notMine = await api(`/api/courier/orders/${o2}/confirm-delivery`, { method: 'POST', token: other, body: { method: 'code', code: '0002' } });
  assert.equal(notMine.status, 404);

  // שיטת צילום: חייבת photo_url; עם photo_url מאשרת
  await api(`/api/courier/orders/${o2}/mark`, { method: 'POST', token: courier, body: { action: 'picked_up' } });
  await api(`/api/t/achuza/orders/${o2}/status`, { method: 'POST', token: admin, body: { status: 'in_work' } });
  await api(`/api/t/achuza/orders/${o2}/status`, { method: 'POST', token: admin, body: { status: 'ready' } });
  const noPhoto = await api(`/api/courier/orders/${o2}/confirm-delivery`, { method: 'POST', token: courier, body: { method: 'photo' } });
  assert.equal(noPhoto.status, 400);
  const withPhoto = await api(`/api/courier/orders/${o2}/confirm-delivery`, { method: 'POST', token: courier, body: { method: 'photo', photo_url: '/uploads/demo-proof.jpg' } });
  assert.equal(withPhoto.status, 200, JSON.stringify(withPhoto.json));

  // אישור מסירה מסטטוס לא תקין (confirmed בלבד) נדחה
  const o3 = await makeOrder(api, customer, 'achuza');
  await confirmAndAssign(api, admin, 'achuza', o3);
  const badState = await api(`/api/courier/orders/${o3}/confirm-delivery`, { method: 'POST', token: courier, body: { method: 'code', code: '0002' } });
  assert.equal(badState.status, 409);
});

// PNG מינימלי עם magic bytes תקינים (sniff בודק 4 הבתים הראשונים)
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0]);

test('מסך שליח: אישור מסירה בצילום, הרשאות צפייה, תצוגת מכבסה, סינון תאריך', async (t) => {
  const { base, api } = await startApp(t);
  const admin = await api.login('+972500000001');
  const customer = await api.login('+972500000002');
  const courier = await api.login('+972500000005');
  const owner = await api.login('+972500000003');

  const oid = await makeOrder(api, customer, 'achuza');
  await confirmAndAssign(api, admin, 'achuza', oid);
  await api(`/api/courier/orders/${oid}/mark`, { method: 'POST', token: courier, body: { action: 'picked_up' } });
  await api(`/api/t/achuza/orders/${oid}/status`, { method: 'POST', token: admin, body: { status: 'in_work' } });
  await api(`/api/t/achuza/orders/${oid}/status`, { method: 'POST', token: admin, body: { status: 'ready' } });
  await api(`/api/courier/orders/${oid}/mark`, { method: 'POST', token: courier, body: { action: 'out_for_delivery' } });

  // קובץ מזויף (טקסט בכסות image/png) נדחה ב-magic bytes
  const fakeFd = new FormData();
  fakeFd.append('method', 'photo');
  fakeFd.append('photo', new Blob([Buffer.from('not a real image')], { type: 'image/png' }), 'fake.png');
  const fake = await fetch(`${base}/api/courier/orders/${oid}/confirm-delivery`, { method: 'POST', headers: { authorization: 'Bearer ' + courier }, body: fakeFd });
  assert.equal(fake.status, 400);

  // צילום אמיתי (magic bytes תקינים) מאושר
  const fd = new FormData();
  fd.append('method', 'photo');
  fd.append('photo', new Blob([PNG_BYTES], { type: 'image/png' }), 'proof.png');
  const ok = await fetch(`${base}/api/courier/orders/${oid}/confirm-delivery`, { method: 'POST', headers: { authorization: 'Bearer ' + courier }, body: fd });
  assert.equal(ok.status, 200, JSON.stringify(await ok.clone().text()));

  // האישור נחשף במשימות ובתצוגת המכבסה
  const tasks = await api('/api/courier/tasks', { token: courier });
  const done = tasks.json.tasks.done_today.find(x => x.id === oid);
  assert.ok(done && done.confirmation, 'confirmation in tasks');
  assert.equal(done.confirmation.method, 'photo');
  assert.equal(done.confirmation.has_photo, true);
  const tOrders = await api('/api/t/achuza/orders', { token: owner });
  const tOrder = tOrders.json.orders.find(x => x.id === oid);
  assert.ok(tOrder && tOrder.delivery_confirmation, 'confirmation in tenant orders');
  assert.equal(tOrder.delivery_confirmation.has_photo, true);

  // הרשאות צפייה בצילום
  const photoUrl = `${base}/api/delivery-confirmations/${done.confirmation.id}/photo`;
  const asCourier = await fetch(photoUrl, { headers: { authorization: 'Bearer ' + courier } });
  assert.equal(asCourier.status, 200);
  assert.equal(asCourier.headers.get('content-type'), 'image/png');
  const asOwner = await fetch(photoUrl, { headers: { authorization: 'Bearer ' + owner } });
  assert.equal(asOwner.status, 200);
  const asAdmin = await fetch(photoUrl, { headers: { authorization: 'Bearer ' + admin } });
  assert.equal(asAdmin.status, 200);
  const otherCourier = await api.login('+972500000004');
  const asOther = await fetch(photoUrl, { headers: { authorization: 'Bearer ' + otherCourier } });
  assert.equal(asOther.status, 403);
  const asCustomer = await fetch(photoUrl, { headers: { authorization: 'Bearer ' + customer } });
  assert.equal(asCustomer.status, 403);
  const asAnon = await fetch(photoUrl);
  assert.equal(asAnon.status, 401);

  // סינון תאריך: היום מכיל את ההזמנה שהושלמה; תאריך עבר — ריק; עתיד — בלי נקודות פעילות
  const today = await api('/api/courier/day-route', { token: courier });
  assert.ok(today.json.date);
  assert.ok(today.json.stops.find(s => s.order.id === oid && s.done), 'done stop today');
  const past = await api('/api/courier/day-route?date=2020-01-01', { token: courier });
  assert.equal(past.status, 200);
  assert.equal(past.json.date, '2020-01-01');
  assert.equal(past.json.stops.length, 0);
  assert.equal(past.json.summary.total, 0);
  const bad = await api('/api/courier/day-route?date=not-a-date', { token: courier });
  assert.equal(bad.status, 200); // תאריך לא תקין → ברירת מחדל היום
});
