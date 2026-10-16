// CX5: העדפות התראות — ברירת מחדל, עדכון, ולידציה, והשתקת notifyUser (דרך יצירת הזמנה)
const { test } = require('node:test');
const assert = require('node:assert');
const { startApp, TEST_DB } = require('./helpers');
const { Client } = require('pg');

// מוצא בשכמות test_% את רשומת ההתראה האחרונה של הלקוח על הזמנה מסוימת
async function lastNotificationFor(orderId) {
  const c = new Client({ connectionString: TEST_DB });
  await c.connect();
  try {
    const { rows: sch } = await c.query(`SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'test_%'`);
    for (const s of sch) {
      const { rows } = await c.query(
        `SELECT channel, sent FROM "${s.schema_name}".notifications WHERE body LIKE $1 ORDER BY id DESC LIMIT 1`,
        ['%#' + orderId.slice(0, 8) + '%']).catch(() => ({ rows: [] }));
      if (rows[0]) return rows[0];
    }
    return null;
  } finally { await c.end(); }
}

test('prefs: ברירת מחדל פעיל, PUT נשמר, ולידציה, notifyUser מושתק בהזמנה', async (t) => {
  const { api } = await startApp(t);
  const owner = await api.login('+972500000003');
  const customer = await api.login('+972500000002');

  const it = await api('/api/t/achuza/items', { method: 'POST', token: owner, body: { name: 'שק התראות', price: 30, unit: 'bag', category: 'כביסה' } });
  assert.equal(it.status, 201);
  const mk = () => api('/api/orders', { method: 'POST', token: customer, body: { slug: 'achuza', items: [{ item_id: it.json.item.id, qty: 2 }], address: 'רחוב ההתראות 5, תל אביב' } });

  // ברירת מחדל: הכל פעיל; הזמנה ראשונה שולחת (channel=log בסביבת טסט)
  const d = await api('/api/me/notification-prefs', { token: customer });
  assert.equal(d.status, 200);
  assert.deepEqual(d.json, { status_updates: true, marketing: true });
  const o1 = await mk();
  assert.equal(o1.status, 201);
  const n1 = await lastNotificationFor(o1.json.order.id);
  assert.ok(n1, 'נוצרה רשומת התראה');
  assert.notEqual(n1.channel, 'muted');

  // ולידציה + שמירת השתקה
  assert.equal((await api('/api/me/notification-prefs', { method: 'PUT', token: customer, body: { status_updates: 'no' } })).status, 400);
  const u = await api('/api/me/notification-prefs', { method: 'PUT', token: customer, body: { status_updates: false, marketing: true } });
  assert.equal(u.status, 200);
  assert.equal(u.json.status_updates, false);
  assert.equal((await api('/api/me/notification-prefs', { token: customer })).json.status_updates, false);

  // הזמנה שנייה מושתקת — נרשם muted, לא נשלח דבר
  const o2 = await mk();
  assert.equal(o2.status, 201);
  const n2 = await lastNotificationFor(o2.json.order.id);
  assert.ok(n2, 'נוצרה רשומת התראה');
  assert.equal(n2.channel, 'muted');
  assert.equal(n2.sent, false);
});
