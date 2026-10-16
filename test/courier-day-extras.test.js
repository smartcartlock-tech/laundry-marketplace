// מסך שליח — תוספות: מתג זמינות + שיבוץ מתחשב, רווחים יומי/שבועי לפי משימה,
// היסטוריה ודירוג, סידור מסלול לפי קרבה גיאוגרפית (haversine)
const { test } = require('node:test');
const assert = require('node:assert');
const { startApp } = require('./helpers');
const { Client } = require('pg');

const TEST_DB = process.env.TEST_DATABASE_URL || 'postgres://postgres@127.0.0.1:5433/laundry_test';

async function makeOrder(api, token, slug) {
  const l = await api('/api/laundries/' + slug);
  const item = l.json.items[0];
  const r = await api('/api/orders', { method: 'POST', token, body: { slug, items: [{ item_id: item.id, qty: 1 }], address: 'רחוב הבדיקה 1, תל אביב' } });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return r.json.order.id;
}

async function deliver(api, admin, courier, oid) {
  assert.equal((await api(`/api/t/achuza/orders/${oid}/status`, { method: 'POST', token: admin, body: { status: 'confirmed' } })).status, 200);
  assert.equal((await api('/api/admin/routes/auto-build', { method: 'POST', token: admin, body: {} })).status, 200);
  await api(`/api/courier/orders/${oid}/mark`, { method: 'POST', token: courier, body: { action: 'picked_up' } });
  await api(`/api/t/achuza/orders/${oid}/status`, { method: 'POST', token: admin, body: { status: 'in_work' } });
  await api(`/api/t/achuza/orders/${oid}/status`, { method: 'POST', token: admin, body: { status: 'ready' } });
  await api(`/api/courier/orders/${oid}/mark`, { method: 'POST', token: courier, body: { action: 'out_for_delivery' } });
  const ok = await api(`/api/courier/orders/${oid}/confirm-delivery`, { method: 'POST', token: courier, body: { method: 'code', code: '0002' } });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
}

test('מתג זמינות: ברירת מחדל זמין, אופליין מוצא משיבוץ אוטומטי, חזרה לאונליין משבצת', async (t) => {
  const { api } = await startApp(t);
  const admin = await api.login('+972500000001');
  const customer = await api.login('+972500000002');
  const courier = await api.login('+972500000005');

  // הרשאות
  assert.equal((await api('/api/courier/availability')).status, 401);
  assert.equal((await api('/api/courier/availability', { token: customer })).status, 403);

  // ברירת מחדל: זמין
  let av = await api('/api/courier/availability', { token: courier });
  assert.equal(av.status, 200);
  assert.equal(av.json.online, true);

  // מעבר לאופליין → השיבוץ האוטומטי לא משבץ אליו
  av = await api('/api/courier/availability', { method: 'POST', token: courier, body: { online: false } });
  assert.equal(av.json.online, false);
  assert.equal((await api('/api/courier/availability', { token: courier })).json.online, false);

  const o1 = await makeOrder(api, customer, 'achuza');
  await api(`/api/t/achuza/orders/${o1}/status`, { method: 'POST', token: admin, body: { status: 'confirmed' } });
  let build = await api('/api/admin/routes/auto-build', { method: 'POST', token: admin, body: {} });
  assert.equal(build.status, 200);
  let tasks = await api('/api/courier/tasks', { token: courier });
  assert.ok(!tasks.json.tasks.pickups.find(x => x.id === o1), 'offline courier not assigned');

  // חזרה לאונליין → משובץ
  await api('/api/courier/availability', { method: 'POST', token: courier, body: { online: true } });
  build = await api('/api/admin/routes/auto-build', { method: 'POST', token: admin, body: {} });
  assert.equal(build.status, 200);
  tasks = await api('/api/courier/tasks', { token: courier });
  assert.ok(tasks.json.tasks.pickups.find(x => x.id === o1), 'online courier assigned');
});

test('רווחים יומי/שבועי לפי משימה + היסטוריה ודירוג שהשליח רואה', async (t) => {
  const { api } = await startApp(t);
  const admin = await api.login('+972500000001');
  const customer = await api.login('+972500000002');
  const courier = await api.login('+972500000005');

  assert.equal((await api('/api/courier/earnings/detail', { token: customer })).status, 403);
  assert.equal((await api('/api/courier/history', { token: customer })).status, 403);

  const o1 = await makeOrder(api, customer, 'achuza');
  await deliver(api, admin, courier, o1);

  // רווחים יומי: רשומת delivery על המשימה שהושלמה
  const day = await api('/api/courier/earnings/detail?period=day', { token: courier });
  assert.equal(day.status, 200, JSON.stringify(day.json));
  assert.equal(day.json.period, 'day');
  const row = day.json.tasks.find(x => x.kind === 'delivery');
  assert.ok(row, 'delivery earning row exists');
  assert.ok(Number(row.net) > 0, 'net positive');
  assert.ok(day.json.totals.stops >= 1);

  // רווחים שבועי: אותה רשומה + קיבוץ לפי יום
  const week = await api('/api/courier/earnings/detail?period=week', { token: courier });
  assert.equal(week.status, 200);
  assert.ok(week.json.tasks.find(x => x.id === row.id), 'same row in weekly view');
  assert.ok(week.json.by_day.length >= 1, 'by_day grouping exists');

  // תאריך עבר בלי פעילות → ריק
  const past = await api('/api/courier/earnings/detail?period=day&date=2020-01-01', { token: courier });
  assert.equal(past.json.tasks.length, 0);

  // היסטוריה: המשימה שהושלמה עם פרטי האישור, בלי דירוג עדיין
  let h = await api('/api/courier/history', { token: courier });
  assert.equal(h.status, 200);
  const hrow = h.json.rows.find(x => x.id === o1);
  assert.ok(hrow, 'delivered order in history');
  assert.equal(hrow.confirmation && hrow.confirmation.method, 'code');
  assert.equal(hrow.review, null);

  // לקוח מדרג את השליח → השליח רואה את הדירוג והממוצע התעדכן
  const rev = await api(`/api/orders/${o1}/review`, { method: 'POST', token: customer, body: { rating: 5, courier_rating: 4 } });
  assert.equal(rev.status, 200, JSON.stringify(rev.json));
  h = await api('/api/courier/history', { token: courier });
  const hrow2 = h.json.rows.find(x => x.id === o1);
  assert.equal(hrow2.review && hrow2.review.rating, 4);
  assert.ok(Number(h.json.rating.rating) > 0, 'aggregate rating updated');
  assert.ok(h.json.rating.rating_count >= 1);
});

test('סידור מסלול לפי קרבה גיאוגרפית: ?order=proximity עם מיקום מתחיל מהנקודה הקרובה', async (t) => {
  const { api, schema } = await startApp(t);
  const admin = await api.login('+972500000001');
  const customer = await api.login('+972500000002');
  const courier = await api.login('+972500000005');

  const oA = await makeOrder(api, customer, 'achuza'); // יוגדר מערב
  const oB = await makeOrder(api, customer, 'achuza'); // יוגדר מזרח
  for (const oid of [oA, oB]) {
    await api(`/api/t/achuza/orders/${oid}/status`, { method: 'POST', token: admin, body: { status: 'confirmed' } });
  }
  assert.equal((await api('/api/admin/routes/auto-build', { method: 'POST', token: admin, body: {} })).status, 200);

  // קביעת קואורדינטות ישירות בסכימת הבדיקה (אין API לעדכון geo של הזמנה)
  const pg = new Client({ connectionString: TEST_DB });
  await pg.connect();
  await pg.query(`SET search_path TO "${schema}"`);
  await pg.query('UPDATE orders SET lat=32.00, lng=34.70 WHERE id=$1', [oA]);
  await pg.query('UPDATE orders SET lat=32.10, lng=34.90 WHERE id=$1', [oB]);
  await pg.end();

  // סידור רגיל: לפי זמן/מסלול
  const plain = await api('/api/courier/day-route', { token: courier });
  assert.equal(plain.json.ordered_by, 'schedule');

  // קרבה מנקודה צמודה ל-B → B ראשון
  const near = await api('/api/courier/day-route?order=proximity&lat=32.10&lng=34.90', { token: courier });
  assert.equal(near.status, 200);
  assert.equal(near.json.ordered_by, 'proximity');
  const open = near.json.stops.filter(s => !s.done);
  assert.equal(open[0].order.id, oB, 'nearest stop first');
  assert.equal(open[1].order.id, oA);
  assert.equal(open[0].seq, 1);

  // קרבה בלי מיקום → שרשרת nearest-neighbor מהנקודה הראשונה
  const chain = await api('/api/courier/day-route?order=proximity', { token: courier });
  assert.equal(chain.json.ordered_by, 'proximity');
  assert.equal(chain.json.stops.filter(s => !s.done).length, 2);
});
