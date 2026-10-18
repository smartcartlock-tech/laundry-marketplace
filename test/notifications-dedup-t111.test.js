// T111: התראות — הודעה אחת לשינוי סטטוס (דה-דופ גם בין נקודות שליחה), מזהה עקבי בכותרת ובגוף
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Client } = require('pg');
const { startApp, TEST_DB } = require('./helpers');

test('T111: delivered דרך mark מייצר הודעה אחת בלבד (mark + completeDelivery מתאחדים), מזהה עקבי', async t => {
  const { api, schema } = await startApp(t);
  const db = new Client({ connectionString: TEST_DB });
  await db.connect();
  t.after(() => db.end());
  await db.query(`SET search_path TO ${schema}, public`);

  const customer = await api.login('+972500000002');
  const owner = await api.login('+972500000003');
  const item = (await api('/api/laundries/achuza')).json.items[0];
  const made = await api('/api/orders', { method: 'POST', token: customer, body: { slug: 'achuza', items: [{ item_id: item.id, qty: 2 }], address: 'רחוב הבדיקה 1, תל אביב' } });
  assert.equal(made.status, 201);
  const orderId = made.json.order.id;
  const { rows: cr } = await db.query('SELECT id, user_id FROM couriers LIMIT 1');
  await api(`/api/t/achuza/orders/${orderId}/assign`, { method: 'POST', token: owner, body: { courier_id: cr[0].id } });
  for (const st of ['confirmed', 'picked_up', 'in_work', 'ready'])
    await api(`/api/t/achuza/orders/${orderId}/status`, { method: 'POST', token: owner, body: { status: st } });
  const { rows: ph } = await db.query('SELECT phone FROM users WHERE id=$1', [cr[0].user_id]);
  const courier = await api.login(ph[0].phone);
  const { rows: tc } = await db.query('SELECT tracking_code FROM orders WHERE id=$1', [orderId]);
  const code = tc[0].tracking_code;

  // out_for_delivery ואז delivered — delivered עובר גם ב-mark וגם ב-completeDelivery (שתי נקודות שליחה)
  await api(`/api/courier/orders/${orderId}/mark`, { method: 'POST', token: courier, body: { action: 'out_for_delivery' } });
  await api(`/api/courier/orders/${orderId}/mark`, { method: 'POST', token: courier, body: { action: 'delivered' } });
  await new Promise(r => setTimeout(r, 800)); // ההודעות נשלחות אסינכרונית אחרי ה-commit

  const { rows: cust } = await db.query('SELECT id FROM users WHERE phone=$1', ['+972500000002']);
  const { rows: msgs } = await db.query(
    `SELECT title, body, dedup_key FROM user_messages WHERE user_id=$1 AND kind='order' AND dedup_key LIKE $2 ORDER BY created_at`,
    [cust[0].id, 'order-status:' + orderId + ':%']);
  const delivered = msgs.filter(m => m.dedup_key === `order-status:${orderId}:delivered`);
  assert.equal(delivered.length, 1, 'delivered נרשם פעם אחת בלבד למרות שתי נקודות השליחה');
  const ofd = msgs.filter(m => m.dedup_key === `order-status:${orderId}:out_for_delivery`);
  assert.equal(ofd.length, 1);

  // מזהה עקבי: אותו קוד מעקב בכותרת ובגוף, בלי uuid חתוך
  for (const m of msgs) {
    assert.ok(m.title.includes(code), 'הכותרת מכילה את קוד המעקב');
    assert.ok(m.body.includes(code), 'הגוף מכילה את אותו קוד מעקב');
    assert.ok(!m.body.includes(orderId.slice(0, 8)) || code === orderId.slice(0, 8), 'אין מזהה uuid חתוך בגוף');
  }

  // גם טבלת notifications (ערוץ שליחה) — רשומת delivered אחת בלבד
  const { rows: notifs } = await db.query(
    `SELECT dedup_key FROM notifications WHERE user_id=$1 AND dedup_key=$2`,
    [cust[0].id, `order-status:${orderId}:delivered`]);
  assert.equal(notifs.length, 1);
});
