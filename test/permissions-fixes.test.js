// הרשאות: דירוג שליח מחייב הזמנה משויכת; טוקן מבוטל לא מקבל מחיר הסכם; קטלוג מזוהה לא נשמר במטמון ציבורי
const { test } = require('node:test');
const assert = require('node:assert');
const { startApp, TEST_DB } = require('./helpers');
const { Client } = require('pg');

async function sql(schema, text, params = []) {
  const db = new Client({ connectionString: TEST_DB, options: `-c search_path=${schema}` });
  await db.connect();
  try { return (await db.query(text, params)).rows; } finally { await db.end(); }
}

test('דירוג שליח: חייב order_id תקף ששובץ לשליח, ללא כפילות', async (t) => {
  const { api, schema } = await startApp(t);
  const owner = await api.login('+972500000003');
  // שליח פרטי + הזמנה ששובצה אליו
  const [cu] = await sql(schema, `INSERT INTO users(phone, name, role) VALUES ('+972500000777','שליח בדיקה','courier') RETURNING id`);
  const [ten] = await sql(schema, `SELECT id FROM tenants WHERE slug='achuza'`);
  const [courier] = await sql(schema, `INSERT INTO couriers(user_id, tenant_id) VALUES ($1,$2) RETURNING id`, [cu.id, ten.id]);
  const [cust] = await sql(schema, `SELECT id FROM users WHERE phone='+972500000002'`);
  const mkOrder = () => sql(schema,
    `INSERT INTO orders(tenant_id, customer_id, status, courier_id, address, subtotal, total) VALUES ($1,$2,'delivered',$3,'רחוב בדיקה 9', 50, 65) RETURNING id`, [ten.id, cust.id, courier.id]);
  const [o1] = await mkOrder();
  const [o2] = await mkOrder();
  // בלי order_id — 400
  const noOrder = await api(`/api/t/achuza/couriers/${courier.id}/rate`, { method: 'POST', token: owner, body: { rating: 5 } });
  assert.equal(noOrder.status, 400);
  // order_id שבור — 400
  const badId = await api(`/api/t/achuza/couriers/${courier.id}/rate`, { method: 'POST', token: owner, body: { rating: 5, order_id: 'abc' } });
  assert.equal(badId.status, 400);
  // הזמנה של שליח אחר — 400
  const [otherC] = await sql(schema, `INSERT INTO couriers(user_id, tenant_id) VALUES ((SELECT id FROM users WHERE phone='+972500000004'), $1) RETURNING id`, [ten.id]);
  const mismatch = await api(`/api/t/achuza/couriers/${otherC.id}/rate`, { method: 'POST', token: owner, body: { rating: 5, order_id: o1.id } });
  assert.equal(mismatch.status, 400);
  // תקין — 200; כפילות — 409
  const ok = await api(`/api/t/achuza/couriers/${courier.id}/rate`, { method: 'POST', token: owner, body: { rating: 5, order_id: o1.id } });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  const dup = await api(`/api/t/achuza/couriers/${courier.id}/rate`, { method: 'POST', token: owner, body: { rating: 4, order_id: o1.id } });
  assert.equal(dup.status, 409);
  const ok2 = await api(`/api/t/achuza/couriers/${courier.id}/rate`, { method: 'POST', token: owner, body: { rating: 4, order_id: o2.id } });
  assert.equal(ok2.status, 200);
});

test('טוקן מבוטל לא מקבל מחיר הסכם + קטלוג מזוהה no-store', async (t) => {
  const { api, base, schema } = await startApp(t);
  const owner = await api.login('+972500000003');
  const customer = await api.login('+972500000002');
  // חשבון עסקי עם מחיר הסכם + שיוך הלקוח
  const created = await api('/api/t/achuza/business-accounts', { method: 'POST', token: owner, body: {
    name: 'עסק בדיקה', company_id: '514455668', contact_name: 'א', contact_phone: '+972501111111' } });
  const acc = created.json.account;
  const pub = await api('/api/laundries/achuza');
  const item = pub.json.items[0];
  await api(`/api/t/achuza/business-accounts/${acc.id}/prices`, { method: 'PUT', token: owner, body: { prices: [{ item_id: item.id, price: 1 }] } });
  await api(`/api/t/achuza/business-accounts/${acc.id}/users`, { method: 'POST', token: owner, body: { phone: '+972500000002' } });
  const get = (token) => fetch(base + '/api/laundries/achuza', { headers: token ? { authorization: 'Bearer ' + token } : {} });
  // טוקן פעיל — מחיר הסכם + no-store
  let r = await get(customer);
  let j = await r.json();
  assert.equal(j.laundry.agreement_pricing, true);
  assert.match(r.headers.get('cache-control'), /no-store/);
  // אנונימי — מחיר רגיל + מטמון ציבורי
  r = await get(null);
  j = await r.json();
  assert.equal(j.laundry.agreement_pricing, undefined);
  assert.match(r.headers.get('cache-control'), /public/);
  // ביטול גלובלי של הטוקנים — הטוקן הישן כבר לא מזכה במחיר ההסכם
  await sql(schema, `UPDATE users SET token_version = token_version + 1 WHERE phone='+972500000002'`);
  r = await get(customer);
  j = await r.json();
  assert.equal(j.laundry.agreement_pricing, undefined, 'טוקן מבוטל עדיין קיבל מחיר הסכם');
});
