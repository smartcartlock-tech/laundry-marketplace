// E12.T6: חשבונית מרכזת (בחירת אופן הפקה), קוד אימות + עמוד אימות ציבורי, QR/ברקוד.
const { test } = require('node:test');
const assert = require('node:assert');
const { startApp, TEST_DB } = require('./helpers');
const { Pool } = require('pg');

async function deliverOrder(api, { owner, customer, courierUser, slug, items, address }) {
  const created = await api('/api/orders', { method: 'POST', token: customer, body: { slug, items, address, payment_method: 'cash' } });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const order = created.json.order;
  await api(`/api/t/${slug}/orders/${order.id}/status`, { method: 'POST', token: owner, body: { status: 'confirmed' } });
  const couriers = await api(`/api/t/${slug}/couriers`, { token: owner });
  const priv = couriers.json.couriers.find(c => c.model === 'private');
  await api(`/api/t/${slug}/orders/${order.id}/assign`, { method: 'POST', token: owner, body: { courier_id: priv.id } });
  await api(`/api/courier/orders/${order.id}/mark`, { method: 'POST', token: courierUser, body: { action: 'picked_up' } });
  for (const st of ['in_work', 'ready']) await api(`/api/t/${slug}/orders/${order.id}/status`, { method: 'POST', token: owner, body: { status: st } });
  for (const act of ['out_for_delivery', 'delivered']) await api(`/api/courier/orders/${order.id}/mark`, { method: 'POST', token: courierUser, body: act === 'delivered' ? { action: act, cash: { outcome: 'collected' } } : { action: act } });
  return order;
}

test('E12.T6: חשבונית מרכזת + אימות ציבורי + מצב הפקה', async (t) => {
  const { api } = await startApp(t);
  const owner = await api.login('+972500000003');
  const customer = await api.login('+972500000002');
  const courierUser = await api.login('+972500000004');
  const page = await api('/api/laundries/achuza');
  const bag = page.json.items.find(i => i.name.includes('שק'));

  await api('/api/t/achuza/settings', { method: 'PATCH', token: owner, body: { dealer_type: 'morasha', dealer_id: '512345678' } });

  // ולידציית invoice_mode
  const badMode = await api('/api/t/achuza/settings', { method: 'PATCH', token: owner, body: { invoice_mode: 'banana' } });
  assert.equal(badMode.status, 400);
  const cons = await api('/api/t/achuza/settings', { method: 'PATCH', token: owner, body: { invoice_mode: 'consolidated' } });
  assert.equal(cons.status, 200, JSON.stringify(cons.json));

  // שתי הזמנות delivered במצב מרכז — לא מונפק להן מסמך אוטומטי
  const o1 = await deliverOrder(api, { owner, customer, courierUser, slug: 'achuza', items: [{ item_id: bag.id, qty: 2 }], address: 'מרכז 1' });
  const o2 = await deliverOrder(api, { owner, customer, courierUser, slug: 'achuza', items: [{ item_id: bag.id, qty: 1 }], address: 'מרכז 2' });
  const docs0 = await api('/api/t/achuza/documents', { token: owner });
  assert.equal(docs0.json.documents.length, 0, 'במצב consolidated לא מונפקים מסמכים אוטומטית');

  // זכאות
  const elig = await api('/api/t/achuza/documents/consolidated/eligible', { token: owner });
  assert.equal(elig.status, 200);
  const custGroup = elig.json.customers.find(c => c.customer.id === o1.customer_id);
  assert.ok(custGroup, 'לקוח עם הזמנות זכאיות');
  assert.equal(custGroup.orders.length, 2);

  // הפקת חשבונית מרכזת על שתי ההזמנות
  const mk = await api('/api/t/achuza/documents/consolidated', { method: 'POST', token: owner, body: { customer_id: o1.customer_id, order_ids: [o1.id, o2.id] } });
  assert.equal(mk.status, 201, JSON.stringify(mk.json));
  const total = Math.round((Number(o1.total) + Number(o2.total)) * 100) / 100;
  assert.equal(Number(mk.json.document.total), total);
  assert.ok(mk.json.document.verify_code, 'קוד אימות');

  // אימות ציבורי — ללא טוקן
  const ver = await api(`/api/verify/${mk.json.document.verify_code}`);
  assert.equal(ver.status, 200);
  assert.equal(ver.json.found, true);
  assert.equal(ver.json.kind, 'consolidated');
  assert.equal(ver.json.orders_count, 2);
  assert.equal(ver.json.demo, true);
  assert.equal(ver.json.result, 'authentic', 'חתימת HMAC תקינה');
  assert.equal(ver.json.signature_valid, true);
  assert.ok(!ver.json.customer_phone && !ver.json.customer_name, 'אימות ציבורי בלי פרטי לקוח');
  const nf = await api('/api/verify/ZZZZZZZZZ1');
  assert.equal(nf.status, 404);
  const bad = await api('/api/verify/x!');
  assert.equal(bad.status, 400);

  // הזמנות שכוסו כבר לא זכאיות; הנפקה חוזרת נחסמת
  const elig2 = await api('/api/t/achuza/documents/consolidated/eligible', { token: owner });
  assert.ok(!elig2.json.customers.some(c => c.orders.some(o => o.id === o1.id || o.id === o2.id)));
  const dup = await api('/api/t/achuza/documents/consolidated', { method: 'POST', token: owner, body: { customer_id: o1.customer_id, order_ids: [o1.id] } });
  assert.equal(dup.status, 409, JSON.stringify(dup.json));

  // המסמך מופיע ברשימה עם ספירת הזמנות; PDF מקור זמין
  const docs1 = await api('/api/t/achuza/documents', { token: owner });
  const cd = docs1.json.documents.find(d => d.kind === 'consolidated');
  assert.ok(cd);
  assert.equal(cd.orders_count, 2);
  const pdf = await api(`/api/t/achuza/documents/${cd.id}/pdf`, { token: owner });
  assert.equal(pdf.status, 200);

  // הלקוח רואה את החשבונית המרכזת בכרטיס ההזמנה המכוסה
  const mine = await api('/api/documents/mine', { token: customer });
  const mineCd = mine.json.documents.find(d => d.kind === 'consolidated');
  assert.ok(mineCd && mineCd.covered_order_ids.includes(o1.id) && mineCd.covered_order_ids.includes(o2.id));

  // זיכוי חלקי של חשבונית מרכזת
  const cr = await api(`/api/t/achuza/documents/${cd.id}/credit`, { method: 'POST', token: owner, body: { amount: 10 } });
  assert.equal(cr.status, 201, JSON.stringify(cr.json));
  const docs2 = await api('/api/t/achuza/documents', { token: owner });
  assert.equal(docs2.json.documents.find(d => d.id === cd.id).status, 'partially_credited');

  // חזרה למצב per_order — ההזמנה הבאה מנפיקה אוטומטית, ולא זכאית למרכזת
  await api('/api/t/achuza/settings', { method: 'PATCH', token: owner, body: { invoice_mode: 'per_order' } });
  const o3 = await deliverOrder(api, { owner, customer, courierUser, slug: 'achuza', items: [{ item_id: bag.id, qty: 1 }], address: 'מרכז 3' });
  const docs3 = await api('/api/t/achuza/documents', { token: owner });
  const o3docs = docs3.json.documents.filter(d => d.order_id === o3.id);
  assert.equal(o3docs.length, 2, 'חשבונית + קבלה אוטומטיות חזרו לפעול');
  const elig3 = await api('/api/t/achuza/documents/consolidated/eligible', { token: owner });
  assert.ok(!elig3.json.customers.some(c => c.orders.some(o => o.id === o3.id)), 'הזמנה עם מסמך לא זכאית');
});

test('E12.T7-hotfix: מקור ללא sha256 (דור קדם-QR) מוגש ברינדור חוזר עם רצועת אימות', async (t) => {
  const { api, schema, base } = await startApp(t);
  const owner = await api.login('+972500000003');
  const customer = await api.login('+972500000002');
  const courierUser = await api.login('+972500000004');
  const page = await api('/api/laundries/achuza');
  const bag = page.json.items.find(i => i.name.includes('שק'));
  await api('/api/t/achuza/settings', { method: 'PATCH', token: owner, body: { dealer_type: 'morasha', dealer_id: '512345678' } });
  const o = await deliverOrder(api, { owner, customer, courierUser, slug: 'achuza', items: [{ item_id: bag.id, qty: 1 }], address: 'דור ישן 1' });
  const docs = await api('/api/t/achuza/documents', { token: owner });
  const inv = docs.json.documents.find(d => d.order_id === o.id && d.kind === 'invoice');
  const rawGet = async () => {
    const r = await fetch(`${base}/api/t/achuza/documents/${inv.id}/pdf`, { headers: { authorization: 'Bearer ' + owner } });
    return { status: r.status, buf: Buffer.from(await r.arrayBuffer()) };
  };
  const orig = await rawGet();
  assert.equal(orig.status, 200);
  // דמיון לדור ישן: מחיקת sha256 (PDF המקור נשאר — רק ההגשה משתנה).
  // מאז 096 sha256 הוא write-once גם מול NULL — סימולציית דור-ישן עוקפת את הטריגר ברמת הסשן (טסט בלבד).
  const pool = new Pool({ connectionString: TEST_DB, options: `-c search_path=${schema},public` });
  await pool.query(`SET session_replication_role = 'replica'`);
  await pool.query('UPDATE documents SET sha256=NULL WHERE id=$1', [inv.id]);
  await pool.query(`SET session_replication_role = 'origin'`);
  const legacy = await rawGet();
  await pool.end();
  assert.equal(legacy.status, 200);
  assert.ok(legacy.buf.length > 1000 && legacy.buf.slice(0, 5).toString() === '%PDF-');
  assert.notEqual(legacy.buf.length, orig.buf.length, 'רינדור חוזר (עם QR) שונה מהמקור השמור');
});
