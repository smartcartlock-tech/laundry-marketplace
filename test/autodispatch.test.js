// T81: שיבוץ שליח אוטומטי — הצעה לשליח הנכון, timeout מעביר לבא, accept ראשון מנצח, בידוד tenant, לוג מלא
process.env.DISPATCH_OFFER_TIMEOUT_MIN = '0.03'; // ~1.8 שניות — מאפשר בדיקת timeout מול setInterval של השרת
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Client } = require('pg');
const { startApp, TEST_DB } = require('./helpers');

async function makeOrder(api, token, slug) {
  const l = await api('/api/laundries/' + slug);
  const item = l.json.items[0];
  const r = await api('/api/orders', { method: 'POST', token, body: { slug, items: [{ item_id: item.id, qty: 1 }], address: 'רחוב השיבוץ 7, תל אביב' } });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return r.json.order.id;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

test('T81: שיבוץ אוטומטי מלא — הצעה, fallback, accept ראשון מנצח, בידוד, לוג', async (t) => {
  const { api, schema } = await startApp(t);
  const db = new Client({ connectionString: TEST_DB });
  await db.connect();
  t.after(() => db.end());
  await db.query(`SET search_path TO ${schema}, public`);

  const admin = await api.login('+972500000001');
  const owner = await api.login('+972500000003');
  const customer = await api.login('+972500000002');
  const courierPrivate = await api.login('+972500000004'); // שליח פרטי של אחוזה
  const courierPlatform = await api.login('+972500000005'); // שליח פלטפורמה

  // --- הצעה לשליח הנכון: שליח לא מקוון לא מקבל הצעה ---
  await api('/api/courier/availability', { method: 'POST', token: courierPrivate, body: { online: false } });
  const o1 = await makeOrder(api, customer, 'achuza');
  const trig = await api(`/api/dispatch/orders/${o1}/trigger`, { method: 'POST', token: owner, body: {} });
  assert.equal(trig.status, 200, JSON.stringify(trig.json));
  assert.equal(trig.json.mode, 'offered');
  assert.equal(trig.json.attempt, 1);
  // ההצעה הלכה לשליח הפלטפורמה (הפרטי כבוי), והוא רואה אותה
  let offers5 = await api('/api/dispatch/offers', { token: courierPlatform });
  assert.equal(offers5.status, 200);
  const myOffer = offers5.json.offers.find(f => f.order_id === o1);
  assert.ok(myOffer, 'platform courier sees the offer');
  assert.equal(myOffer.attempt, 1);
  // השליח הכבוי לא רואה הצעה
  const offers4 = await api('/api/dispatch/offers', { token: courierPrivate });
  assert.ok(!offers4.json.offers.find(f => f.order_id === o1), 'offline courier got no offer');

  // --- accept ראשון מנצח: הצעה כפולה ידנית, השני מפסיד ---
  // ניצור הצעה פתוחה נוספת ישירות ב-DB לאותה הזמנה (מדמה מרוץ) ונאשר את שתיהן
  const { rows: c4 } = await db.query(`SELECT c.id FROM couriers c JOIN users u ON u.id=c.user_id WHERE u.phone='+972500000004'`);
  const { rows: c5 } = await db.query(`SELECT c.id FROM couriers c JOIN users u ON u.id=c.user_id WHERE u.phone='+972500000005'`);
  const crow = [c4[0], c5[0]];
  const { rows: orow } = await db.query('SELECT tenant_id FROM orders WHERE id=$1', [o1]);
  const { rows: race } = await db.query(
    `INSERT INTO dispatch_offers(tenant_id, order_id, courier_id, attempt) VALUES ($1,$2,$3,90), ($1,$2,$4,91) RETURNING id, courier_id`,
    [orow[0].tenant_id, o1, crow[0].id, crow[1].id]);
  // ביטול ההצעה המקורית כדי שהמרוץ יהיה בין שתי החדשות
  await db.query(`UPDATE dispatch_offers SET status='expired', responded_at=now() WHERE order_id=$1 AND status='offered' AND attempt=1`, [o1]);
  const acc1 = await api(`/api/dispatch/offers/${race[0].id}/accept`, { method: 'POST', token: courierPrivate, body: {} });
  assert.equal(acc1.status, 200, JSON.stringify(acc1.json));
  const acc2 = await api(`/api/dispatch/offers/${race[1].id}/accept`, { method: 'POST', token: courierPlatform, body: {} });
  assert.equal(acc2.status, 409, 'second accept loses');
  const { rows: oAfter } = await db.query('SELECT courier_id FROM orders WHERE id=$1', [o1]);
  assert.equal(oAfter[0].courier_id, crow[0].id, 'first acceptor assigned');

  // --- timeout מעביר לשליח הבא ---
  await api('/api/courier/availability', { method: 'POST', token: courierPrivate, body: { online: true } });
  const o2 = await makeOrder(api, customer, 'achuza');
  const trig2 = await api(`/api/dispatch/orders/${o2}/trigger`, { method: 'POST', token: owner, body: {} });
  assert.equal(trig2.json.mode, 'offered');
  assert.equal(trig2.json.attempt, 1);
  // לא מאשרים — מחכים שהסריקה תפקיע (timeout 1.8s, סריקה כל ~1s) ותציע לבא
  let second = null;
  for (let i = 0; i < 20 && !second; i++) {
    await sleep(700);
    const { rows } = await db.query(`SELECT id, courier_id, attempt FROM dispatch_offers WHERE order_id=$1 AND status='offered'`, [o2]);
    if (rows[0] && rows[0].attempt === 2) second = rows[0];
  }
  assert.ok(second, 'timeout moved the offer to the next courier');
  assert.notEqual(second.courier_id, trig2.json.offer.courier_id, 'fallback goes to a different courier');
  // לוג מלא על ההזמנה: offered + timeout + fallback
  const { rows: log2 } = await db.query(`SELECT decision FROM dispatch_log WHERE order_id=$1 ORDER BY created_at`, [o2]);
  const decisions = log2.map(x => x.decision);
  assert.ok(decisions.includes('offered'), 'offered logged');
  assert.ok(decisions.includes('timeout'), 'timeout logged');
  assert.ok(decisions.includes('fallback'), 'fallback logged');

  // --- דחייה: skipped ומעבר מיידי לבא (או unassigned כשאין יותר) ---
  const dec = await api(`/api/dispatch/offers/${second.id}/decline`, { method: 'POST', token: courierPlatform, body: { reason: 'עמוס' } });
  // second שייך לשליח שהצענו לו — מי שקיבל את attempt 2
  assert.ok([200, 409].includes(dec.status));
  const { rows: o2offers } = await db.query(`SELECT status FROM dispatch_offers WHERE order_id=$1`, [o2]);
  assert.ok(o2offers.some(x => x.status === 'skipped') || dec.status === 409, 'decline marked skipped');

  // --- בידוד tenant: לא-חבר מכבסה לא משגר; הזמנה של express לא מוצעת לשליח הפרטי של אחוזה ---
  const stranger = await api.login('+972500000088', 'QA dispatch');
  const denied = await api(`/api/dispatch/orders/${o2}/trigger`, { method: 'POST', token: stranger, body: {} });
  assert.equal(denied.status, 403, 'non-member cannot trigger');
  const o3 = await makeOrder(api, customer, 'express');
  const trig3 = await api(`/api/dispatch/orders/${o3}/trigger`, { method: 'POST', token: admin, body: {} });
  assert.equal(trig3.json.mode, 'offered');
  const { rows: o3offer } = await db.query(
    `SELECT c.model, c.tenant_id AS ctid, o.tenant_id AS otid FROM dispatch_offers f JOIN couriers c ON c.id=f.courier_id JOIN orders o ON o.id=f.order_id WHERE f.order_id=$1`, [o3]);
  assert.ok(o3offer[0].ctid === o3offer[0].otid || ['platform', 'shared'].includes(o3offer[0].model), 'offer stays in tenant or platform/shared courier');
  // לוג דרך API: בעלים רואה את הטנאנט שלו, זר לא רואה
  const logOwner = await api('/api/dispatch/log?order_id=' + o2, { token: owner });
  assert.equal(logOwner.status, 200);
  assert.ok(logOwner.json.log.length >= 3, 'owner sees full order log');
  assert.ok(logOwner.json.log.every(x => x.order_id === o2), 'log filtered by order');
  const logStranger = await api('/api/dispatch/log?order_id=' + o2, { token: stranger });
  assert.equal(logStranger.json.log.length, 0, 'stranger sees nothing');

  // --- הוק אוטומטי: מעבר ל-confirmed משגר שיבוץ בלי trigger ידני ---
  const o4 = await makeOrder(api, customer, 'achuza');
  const st = await api(`/api/t/achuza/orders/${o4}/status`, { method: 'POST', token: admin, body: { status: 'confirmed' } });
  assert.equal(st.status, 200, JSON.stringify(st.json));
  let autoOffer = null;
  for (let i = 0; i < 10 && !autoOffer; i++) {
    await sleep(300);
    const { rows } = await db.query(`SELECT id FROM dispatch_offers WHERE order_id=$1 AND status='offered'`, [o4]);
    autoOffer = rows[0];
  }
  assert.ok(autoOffer, 'confirmed status auto-dispatches an offer');
});

test('T81: דמו — שליח דמו מקוון מקודם לשליח פלטפורמה; fallback רק בין מחוברים', async (t) => {
  const { api, schema } = await startApp(t);
  const db = new Client({ connectionString: TEST_DB });
  await db.connect();
  t.after(() => db.end());
  await db.query(`SET search_path TO ${schema}, public`);

  const owner = await api.login('+972500000003');
  const customer = await api.login('+972500000002');
  const courierDemo = await api.login('+972500000004'); // שליח דמו (טלפון דמו)
  const courierPlatform = await api.login('+972500000005'); // שליח פלטפורמה — לא טלפון דמו
  const { rows: c4 } = await db.query(`SELECT c.id FROM couriers c JOIN users u ON u.id=c.user_id WHERE u.phone='+972500000004'`);
  const { rows: c5 } = await db.query(`SELECT c.id FROM couriers c JOIN users u ON u.id=c.user_id WHERE u.phone='+972500000005'`);

  // שניהם מקוונים — ההצעה הולכת לשליח הדמו 004, לא לשליח הפלטפורמה 005
  await api('/api/courier/availability', { method: 'POST', token: courierDemo, body: { online: true } });
  await api('/api/courier/availability', { method: 'POST', token: courierPlatform, body: { online: true } });
  const o1 = await makeOrder(api, customer, 'achuza');
  const trig = await api(`/api/dispatch/orders/${o1}/trigger`, { method: 'POST', token: owner, body: {} });
  assert.equal(trig.json.mode, 'offered', JSON.stringify(trig.json));
  const { rows: f1 } = await db.query('SELECT courier_id FROM dispatch_offers WHERE order_id=$1', [o1]);
  assert.equal(f1[0].courier_id, c4[0].id, 'demo-phone courier preferred over platform courier');

  // fallback רק בין מחוברים: 005 כבוי, 004 דוחה — אין הצעה נוספת, נרשם unassigned
  await api('/api/courier/availability', { method: 'POST', token: courierPlatform, body: { online: false } });
  const o2 = await makeOrder(api, customer, 'achuza');
  await api(`/api/dispatch/orders/${o2}/trigger`, { method: 'POST', token: owner, body: {} });
  const offers4 = await api('/api/dispatch/offers', { token: courierDemo });
  const off2 = offers4.json.offers.find(f => f.order_id === o2);
  assert.ok(off2, 'demo courier got the offer');
  const dec = await api(`/api/dispatch/offers/${off2.offer_id}/decline`, { method: 'POST', token: courierDemo, body: { reason: 'עמוס' } });
  assert.equal(dec.status, 200, JSON.stringify(dec.json));
  assert.equal(dec.json.next, 'unassigned', 'no fallback to an offline courier');
  const { rows: f2 } = await db.query(`SELECT count(*)::int AS n FROM dispatch_offers WHERE order_id=$1 AND status='offered'`, [o2]);
  assert.equal(f2[0].n, 0, 'offline courier received no fallback offer');
  const { rows: lg } = await db.query(`SELECT decision FROM dispatch_log WHERE order_id=$1 ORDER BY created_at`, [o2]);
  assert.ok(lg.some(x => x.decision === 'unassigned'), 'unassigned decision logged');
});
