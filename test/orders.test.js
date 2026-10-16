const { test } = require('node:test');
const assert = require('node:assert');
const { startApp } = require('./helpers');

// זרימת הזמנה מלאה מקצה לקצה: לקוח -> מכבסה -> שליח -> מסירה -> נקודות -> ביקורת
test('orders: מחזור חיים מלא, נקודות, הרשאות, ביקורת', async (t) => {
  const { api } = await startApp(t);
  const customer = await api.login('+972500000002');
  const owner = await api.login('+972500000003');
  const courierUser = await api.login('+972500000004');

  // קטלוג ציבורי
  const laundries = await api('/api/laundries');
  assert.equal(laundries.status, 200);
  assert.ok(laundries.json.laundries.length >= 4);
  const page = await api('/api/laundries/achuza');
  assert.equal(page.status, 200);
  const items = page.json.items;
  assert.ok(items.length >= 5);
  const bag = items.find(i => i.name.includes('שק'));

  // מתחת למינימום הזמנה (50) — נדחה
  const shirt = items.find(i => i.name.includes('חולצה'));
  const tooSmall = await api('/api/orders', { method: 'POST', token: customer, body: { slug: 'achuza', items: [{ item_id: shirt.id, qty: 1 }], address: 'הרצל 12, תל אביב' } });
  assert.equal(tooSmall.status, 409);

  // הזמנה תקינה עם מימוש נקודות: שק 56 + דמי משלוח 15 = 71; יתרה 42 נק', תקרה 20% מסאב-טוטל = 11
  const created = await api('/api/orders', { method: 'POST', token: customer, body: { slug: 'achuza', items: [{ item_id: bag.id, qty: 1 }], address: 'הרצל 12, תל אביב', redeem_points: true } });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const order = created.json.order;
  assert.equal(Number(order.subtotal), 56);
  assert.equal(Number(order.delivery_fee), 15);
  assert.equal(Number(order.discount), 11);
  assert.equal(Number(order.total), 60);
  assert.equal(Number(order.points_redeemed), 11);
  assert.equal(Number(order.points_earned), 6); // floor(60*0.1)

  // לקוח אחר לא רשאי לצפות
  const other = await api.login('+972500000099');
  const forbidden = await api('/api/orders/' + order.id, { token: other });
  assert.equal(forbidden.status, 403);

  // בעל מכבסה מאשר
  const confirm = await api('/api/t/achuza/orders/' + order.id + '/status', { method: 'POST', token: owner, body: { status: 'confirmed' } });
  assert.equal(confirm.status, 200, JSON.stringify(confirm.json));

  // אי אפשר לסמן picked_up בלי שליח
  const earlyPickup = await api('/api/t/achuza/orders/' + order.id + '/status', { method: 'POST', token: owner, body: { status: 'picked_up' } });
  assert.equal(earlyPickup.status, 409);

  // שיבוץ שליח פרטי (מיידי)
  const couriers = await api('/api/t/achuza/couriers', { token: owner });
  assert.equal(couriers.status, 200);
  const priv = couriers.json.couriers.find(c => c.model === 'private');
  assert.ok(priv);
  const assign = await api('/api/t/achuza/orders/' + order.id + '/assign', { method: 'POST', token: owner, body: { courier_id: priv.id } });
  assert.equal(assign.status, 200, JSON.stringify(assign.json));

  // שליח רואה את המסלול ומסמן נאסף
  const route = await api('/api/courier/route', { token: courierUser });
  assert.equal(route.status, 200);
  assert.ok(route.json.route.find(o => o.id === order.id));
  const mark = await api('/api/courier/orders/' + order.id + '/mark', { method: 'POST', token: courierUser, body: { action: 'picked_up' } });
  assert.equal(mark.status, 200, JSON.stringify(mark.json));

  // בעל מכבסה: בעבודה -> מוכן
  for (const st of ['in_work', 'ready']) {
    const r = await api('/api/t/achuza/orders/' + order.id + '/status', { method: 'POST', token: owner, body: { status: st } });
    assert.equal(r.status, 200, st);
  }
  // שליח: יצא למסירה -> נמסר
  for (const act of ['out_for_delivery', 'delivered']) {
    const r = await api('/api/courier/orders/' + order.id + '/mark', { method: 'POST', token: courierUser, body: { action: act } });
    assert.equal(r.status, 200, act);
  }

  // אי אפשר לחזור אחורה בסטטוס
  const back = await api('/api/t/achuza/orders/' + order.id + '/status', { method: 'POST', token: owner, body: { status: 'new' } });
  assert.equal(back.status, 409);

  // נקודות נזקפו במסירה: 42 - 11 + 6 = 37
  const club = await api('/api/orders/club/summary', { token: customer });
  assert.equal(club.status, 200);
  const bal = club.json.balances.find(b => b.slug === 'achuza');
  assert.equal(bal.balance, 37);

  // אירועי הזמנה מתועדים
  const detail = await api('/api/orders/' + order.id, { token: customer });
  const statuses = detail.json.events.map(e => e.status);
  for (const s of ['new', 'confirmed', 'picked_up', 'in_work', 'ready', 'out_for_delivery', 'delivered']) assert.ok(statuses.includes(s), s);
  assert.equal(detail.json.order.payment_status, 'paid_cash');

  // ביקורת אחרי מסירה
  const review = await api('/api/orders/' + order.id + '/review', { method: 'POST', token: customer, body: { rating: 5, text: 'מעולה' } });
  assert.equal(review.status, 200);
  const page2 = await api('/api/laundries/achuza');
  assert.ok(Number(page2.json.laundry.rating) > 0);

  // ביטול הזמנה חדשה עובד, ביטול אחרי איסוף נדחה
  const c2 = await api('/api/orders', { method: 'POST', token: customer, body: { slug: 'achuza', items: [{ item_id: bag.id, qty: 1 }], address: 'הרצל 12' } });
  const cancel = await api('/api/orders/' + c2.json.order.id + '/cancel', { method: 'POST', token: customer });
  assert.equal(cancel.status, 200);
});

test('orders: משתמש שאינו חבר מכבסה מקבל 403 על לוח מכבסה', async (t) => {
  const { api } = await startApp(t);
  const rando = await api.login('+972500000077');
  const res = await api('/api/t/achuza/orders', { token: rando });
  assert.equal(res.status, 403);
  const noTenant = await api('/api/t/no-such/orders', { token: rando });
  assert.equal(noTenant.status, 404);
});

test('QA: ביקורת כפולה על אותה הזמנה נחסמת ב-409', async (t) => {
  const { api } = await startApp(t);
  const owner = await api.login('+972500000003');
  const customer = await api.login('+972500000002');
  const courierUser = await api.login('+972500000004');
  const item = (await api('/api/laundries/achuza')).json.items[0];
  const o = await api('/api/orders', { method: 'POST', token: customer, body: { slug: 'achuza', items: [{ item_id: item.id, qty: 2 }], address: 'בדיקת ביקורת כפולה', payment_method: 'cash' } });
  const oid = o.json.order.id;
  await api(`/api/t/achuza/orders/${oid}/status`, { method: 'POST', token: owner, body: { status: 'confirmed' } });
  const couriers = await api('/api/t/achuza/couriers', { token: owner });
  const priv = couriers.json.couriers.find(c => c.model === 'private');
  await api(`/api/t/achuza/orders/${oid}/assign`, { method: 'POST', token: owner, body: { courier_id: priv.id } });
  await api(`/api/courier/orders/${oid}/mark`, { method: 'POST', token: courierUser, body: { action: 'picked_up' } });
  for (const st of ['in_work', 'ready']) await api(`/api/t/achuza/orders/${oid}/status`, { method: 'POST', token: owner, body: { status: st } });
  for (const act of ['out_for_delivery', 'delivered']) await api(`/api/courier/orders/${oid}/mark`, { method: 'POST', token: courierUser, body: { action: act } });
  const r1 = await api(`/api/orders/${oid}/review`, { method: 'POST', token: customer, body: { rating: 5, text: 'מעולה' } });
  assert.equal(r1.status, 200, JSON.stringify(r1.json));
  const r2 = await api(`/api/orders/${oid}/review`, { method: 'POST', token: customer, body: { rating: 1, text: 'ניסיון כפול' } });
  assert.equal(r2.status, 409, JSON.stringify(r2.json));
});
