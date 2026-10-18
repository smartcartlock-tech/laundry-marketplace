// T109: כרטיס הצעת שיבוץ עשיר — תגמול ₪ משוער + מרחק ק"מ + expires_at ב-API,
// קישור מהודעה למשימה (data.url), וטיימר/פג-תוקף ב-UI.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
const { startApp, TEST_DB } = require('./helpers');

async function makeOrder(api, token, slug) {
  const l = await api('/api/laundries/' + slug);
  const item = l.json.items[0];
  const r = await api('/api/orders', { method: 'POST', token, body: { slug, items: [{ item_id: item.id, qty: 1 }], address: 'רחוב התגמול 12, תל אביב' } });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return r.json.order.id;
}

test('T109: ההצעה נושאת תגמול משוער + מרחק + expires_at; ההודעה נושאת קישור למשימה', async (t) => {
  const { api, schema } = await startApp(t);
  const db = new Client({ connectionString: TEST_DB });
  await db.connect();
  t.after(() => db.end());
  await db.query(`SET search_path TO ${schema}, public`);

  const owner = await api.login('+972500000003');
  const customer = await api.login('+972500000002');
  const courierPrivate = await api.login('+972500000004'); // שליח דמו פרטי של אחוזה — מקודם בדמו

  // קואורדינטות דטרמיניסטיות: מכבסה ולקוח במרחק ידוע (~2.78 ק"מ בין שתי נקודות בתל אביב)
  await db.query(`UPDATE tenants SET lat=32.0800, lng=34.7800 WHERE slug='achuza'`);
  const o1 = await makeOrder(api, customer, 'achuza');
  await db.query(`UPDATE orders SET lat=32.1053, lng=34.8000 WHERE id=$1`, [o1]);

  const trig = await api(`/api/dispatch/orders/${o1}/trigger`, { method: 'POST', token: owner, body: {} });
  assert.equal(trig.status, 200, JSON.stringify(trig.json));
  assert.equal(trig.json.mode, 'offered');

  // 1. השורה ב-DB נושאת את השדות החדשים (מיגרציה 127 הוחלה)
  const { rows: offerRows } = await db.query(`SELECT payout_estimate, distance_km FROM dispatch_offers WHERE order_id=$1 AND status='offered'`, [o1]);
  assert.equal(offerRows.length, 1);
  assert.equal(Number(offerRows[0].payout_estimate), 24, 'ברירת מחדל: תעריף 12 × איסוף+מסירה = 24');
  assert.ok(offerRows[0].distance_km != null, 'distance computed from tenant+order coords');
  const km = Number(offerRows[0].distance_km);
  assert.ok(km > 2 && km < 4, `distance ~2.8km, got ${km}`);

  // 2. ה-API מחזיר תגמול, מרחק, ו-expires_at עתידי (offered_at + TIMEOUT_MIN)
  const offers = await api('/api/dispatch/offers', { token: courierPrivate });
  assert.equal(offers.status, 200);
  const mine = offers.json.offers.find(f => f.order_id === o1);
  assert.ok(mine, 'courier sees the offer');
  assert.equal(Number(mine.payout_estimate), 24);
  assert.ok(mine.distance_km != null);
  assert.ok(mine.expires_at, 'expires_at returned');
  assert.ok(new Date(mine.expires_at) > new Date(mine.offered_at), 'expires after offered_at');
  assert.ok(new Date(mine.expires_at) > new Date(), 'expires in the future');

  // 3. הודעת ההצעה במרכז ההודעות נושאת קישור למשימה + פרטי תגמול/מרחק בגוף
  // (notifyOffer רץ אסינכרוני — ממתינים עד שההודעה נשמרת, בסבלנות לעומס מקבילי)
  const { rows: urow } = await db.query(`SELECT id FROM users WHERE phone='+972500000004'`);
  let msgs = [];
  for (let i = 0; i < 30 && !msgs.length; i++) {
    ({ rows: msgs } = await db.query(
      `SELECT title, body, data FROM user_messages WHERE user_id=$1 AND kind='order' ORDER BY created_at DESC LIMIT 1`, [urow[0].id]));
    if (!msgs.length) await new Promise(r => setTimeout(r, 200));
  }
  assert.ok(msgs.length, 'offer message posted');
  assert.equal(msgs[0].data && msgs[0].data.url, '#/courier/day', 'message carries task link');
  assert.match(msgs[0].body, /₪24/, 'payout in message body');
  assert.match(msgs[0].body, /ק"מ/, 'distance in message body');

  // 4. בידוד: ההצעה לא דלפה לטנאנט אחר
  const { rows: cross } = await db.query(
    `SELECT count(*)::int AS n FROM dispatch_offers f JOIN tenants t2 ON t2.id=f.tenant_id WHERE f.order_id=$1 AND t2.slug<>'achuza'`, [o1]);
  assert.equal(cross[0].n, 0);
});

test('T109: UI — כרטיס ההצעה מציג תגמול/מרחק/חלון/טיימר/פג-תוקף; מרכז ההודעות מציג קישור', () => {
  const cd = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'courier-day.js'), 'utf8');
  assert.match(cd, /תגמול משוער: ₪/, 'payout on offer card');
  assert.match(cd, /מרחק: /, 'distance on offer card');
  assert.match(cd, /חלון איסוף/, 'time window on offer card');
  assert.match(cd, /offer-timer/, 'timer element');
  assert.match(cd, /פג תוקף ההצעה/, 'expired state shown, not silent');
  assert.match(cd, /startOfferTimers/, 'timer engine');
  const mj = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'messages.js'), 'utf8');
  assert.match(mj, /m\.data && m\.data\.url/, 'message center renders data.url link');
  assert.match(mj, /פתיחת המשימה/, 'link label');
});
