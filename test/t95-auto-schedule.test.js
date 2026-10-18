// T95: 'ללא העדפה' באיסוף/החזרה → שיבוץ אוטומטי לחלון הפתוח הקרוב, לא שעת יצירה (+24).
const { test } = require('node:test');
const assert = require('node:assert');
const { startApp } = require('./helpers');

function jerusalemParts(iso) {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false }).formatToParts(d);
  const get = k => parts.find(p => p.type === k).value;
  const WD = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { hour: Number(get('hour')), minute: Number(get('minute')), weekday: WD[get('weekday')] };
}

test('T95: הזמנה בלי העדפה מתוזמנת לחלון הפתוח הקרוב; בלי חלונות — נשארת לתיאום', async (t) => {
  const { api } = await startApp(t);
  const cust = await api.login('+972509991111', 'לקוח תזמון');
  await api('/api/auth/consent', { method: 'POST', token: cust });
  const laundry = (await api('/api/laundries/achuza')).json;
  const shirt = laundry.items.find(i => i.name.includes('חולצה'));

  // 1) בלי העדפה — איסוף 09:00 והחזרה 16:00, בעתיד, לא בשבת, לא שעת יצירה
  const o1 = await api('/api/orders', { method: 'POST', token: cust, body: {
    slug: 'achuza', address: 'הרצל 10', items: [{ item_id: shirt.id, qty: 10 }] } });
  assert.equal(o1.status, 201, JSON.stringify(o1.json));
  const ord = o1.json.order;
  assert.ok(ord.pickup_at, 'pickup_at שובץ אוטומטית');
  assert.ok(ord.delivery_at, 'delivery_at שובץ אוטומטית');
  const p = jerusalemParts(ord.pickup_at), d = jerusalemParts(ord.delivery_at);
  assert.ok(new Date(ord.pickup_at) > new Date(), 'האיסוף בעתיד');
  assert.equal(p.hour, 9, 'איסוף בתחילת חלון 09:00 — לא שעת יצירה'); assert.equal(p.minute, 0);
  assert.equal(d.hour, 16, 'החזרה בתחילת חלון 16:00'); assert.equal(d.minute, 0);
  assert.notEqual(p.weekday, 6); assert.notEqual(d.weekday, 6);
  assert.ok(new Date(ord.delivery_at) >= new Date(ord.pickup_at), 'החזרה לא לפני איסוף');

  // 2) העדפה מפורשת נשמרת כמו שהיא
  const explicit = new Date(Date.now() + 3 * 24 * 3600 * 1000);
  explicit.setMinutes(0, 0, 0);
  const o2 = await api('/api/orders', { method: 'POST', token: cust, body: {
    slug: 'achuza', address: 'הרצל 12', items: [{ item_id: shirt.id, qty: 10 }], pickup_at: explicit.toISOString() } });
  assert.equal(o2.status, 201, JSON.stringify(o2.json));
  assert.equal(new Date(o2.json.order.pickup_at).getTime(), explicit.getTime(), 'חלון מפורש לא הוחלף');

  // 3) מכבסה בלי חלונות איסוף פתוחים — נשאר null ('לתיאום'), בלי תזמון לילי
  const owner = await api.login('+972500000003', 'בעל מכבסה לדמו');
  const wins = await api('/api/t/achuza/windows', { token: owner });
  assert.equal(wins.status, 200, JSON.stringify(wins.json));
  for (const w of (wins.json.windows || wins.json || []).filter(x => x.kind === 'pickup')) {
    await api('/api/t/achuza/windows/' + w.id, { method: 'DELETE', token: owner });
  }
  const o3 = await api('/api/orders', { method: 'POST', token: cust, body: {
    slug: 'achuza', address: 'הרצל 14', items: [{ item_id: shirt.id, qty: 10 }] } });
  assert.equal(o3.status, 201, JSON.stringify(o3.json));
  assert.equal(o3.json.order.pickup_at, null, 'בלי חלון איסוף — נשאר לתיאום');
});
