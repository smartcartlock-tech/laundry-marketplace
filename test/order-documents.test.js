// E12.T2/T3/T5: הנפקה אוטומטית בעת delivered לפי סוג עוסק, PDF מקור/העתק, זיכוי, ולידציית פרטי עוסק.
const { test } = require('node:test');
const assert = require('node:assert');
const { startApp } = require('./helpers');

async function deliverOrder(api, { owner, customer, courierUser, slug, items, address, payment }) {
  const created = await api('/api/orders', { method: 'POST', token: customer, body: { slug, items, address, payment_method: payment || 'cash' } });
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

test('E12: הנפקה מסמכים מהזמנה — מורשה, פטור, PDF, זיכוי, פרטי עוסק', async (t) => {
  const { api } = await startApp(t);
  const owner = await api.login('+972500000003');
  const customer = await api.login('+972500000002');
  const courierUser = await api.login('+972500000004');
  const page = await api('/api/laundries/achuza');
  const bag = page.json.items.find(i => i.name.includes('שק'));

  // E12.T3: ולידציית פרטי עוסק
  const badId = await api('/api/t/achuza/settings', { method: 'PATCH', token: owner, body: { dealer_id: '123' } });
  assert.equal(badId.status, 400);
  const noId = await api('/api/t/achuza/settings', { method: 'PATCH', token: owner, body: { dealer_type: 'morasha', dealer_id: null } });
  assert.equal(noId.status, 400);
  const good = await api('/api/t/achuza/settings', { method: 'PATCH', token: owner, body: { dealer_type: 'morasha', dealer_id: '512345678' } });
  assert.equal(good.status, 200, JSON.stringify(good.json));

  // הזמנה 1 (מזומן): delivered → חשבונית עסקה + קבלה
  const o1 = await deliverOrder(api, { owner, customer, courierUser, slug: 'achuza', items: [{ item_id: bag.id, qty: 2 }], address: 'בדיקת מסמכים 1' });
  const docs1 = await api('/api/t/achuza/documents', { token: owner });
  assert.equal(docs1.status, 200);
  const mine1 = docs1.json.documents.filter(d => d.order_id === o1.id);
  assert.equal(mine1.length, 2, JSON.stringify(mine1.map(d => d.kind)));
  const inv = mine1.find(d => d.kind === 'invoice');
  const rec = mine1.find(d => d.kind === 'receipt');
  assert.ok(inv && rec);
  assert.equal(inv.kind_he, 'חשבונית מס');
  const total = Number(o1.total);
  assert.equal(Number(inv.total), total);
  const expectedNet = Math.round((total / 1.18) * 100) / 100;
  assert.equal(Number(inv.amount), expectedNet);
  assert.equal(Number(inv.vat), Math.round((total - expectedNet) * 100) / 100);
  assert.equal(inv.doc_number, 1); // ראשונה בסדרה
  assert.equal(rec.doc_number, 1); // סדרת קבלות נפרדת
  assert.equal(Number(rec.vat), 0);

  // PDF מקור (מהאחסון) — לקוח מוריד
  const pdf1 = await api(`/api/documents/${inv.id}/pdf`, { token: customer });
  assert.equal(pdf1.status, 200);
  const copy = await api(`/api/documents/${inv.id}/pdf?copy=1`, { token: customer });
  assert.equal(copy.status, 200);
  // לקוח אחר לא יכול
  const other = await api.login('+972500000098');
  const forbidden = await api(`/api/documents/${inv.id}/pdf`, { token: other });
  assert.equal(forbidden.status, 403);
  // מכבסה מורידה דרך הנתיב שלה
  const tpdf = await api(`/api/t/achuza/documents/${inv.id}/pdf`, { token: owner });
  assert.equal(tpdf.status, 200);

  // הזמנה 2: אותה מכבסה — מספור ממשיך (2), ואין שכפול מסמכים להזמנה 1
  const o2 = await deliverOrder(api, { owner, customer, courierUser, slug: 'achuza', items: [{ item_id: bag.id, qty: 1 }], address: 'בדיקת מסמכים 2', payment: 'demo_online' });
  const docs2 = await api('/api/t/achuza/documents', { token: owner });
  const forO1 = docs2.json.documents.filter(d => d.order_id === o1.id);
  assert.equal(forO1.length, 2);
  const inv2 = docs2.json.documents.find(d => d.order_id === o2.id && d.kind === 'invoice');
  assert.equal(inv2.doc_number, 2);

  // E12.T5: זיכוי חלקי ומלא דרך ה-API של המכבסה
  const partial = await api(`/api/t/achuza/documents/${inv2.id}/credit`, { method: 'POST', token: owner, body: { amount: 10 } });
  assert.equal(partial.status, 201, JSON.stringify(partial.json));
  assert.equal(Number(partial.json.credit.total), -10);
  const over = await api(`/api/t/achuza/documents/${inv2.id}/credit`, { method: 'POST', token: owner, body: { amount: 9999 } });
  assert.equal(over.status, 409);
  const full = await api(`/api/t/achuza/documents/${inv2.id}/credit`, { method: 'POST', token: owner, body: {} });
  assert.equal(full.status, 201);
  const docs3 = await api('/api/t/achuza/documents', { token: owner });
  const inv2After = docs3.json.documents.find(d => d.id === inv2.id);
  assert.equal(inv2After.status, 'credited');

  // עוסק פטור: רק קבלה, בלי מע"מ
  await api('/api/t/achuza/settings', { method: 'PATCH', token: owner, body: { dealer_type: 'patur' } });
  const o3 = await deliverOrder(api, { owner, customer, courierUser, slug: 'achuza', items: [{ item_id: bag.id, qty: 1 }], address: 'בדיקת מסמכים 3' });
  const docs4 = await api('/api/t/achuza/documents', { token: owner });
  const mine3 = docs4.json.documents.filter(d => d.order_id === o3.id);
  assert.equal(mine3.length, 2);
  assert.ok(mine3.some(d=>d.kind==='invoice' && d.kind_he==='חשבונית עסקה'));
  assert.ok(mine3.some(d=>d.kind==='receipt'));
  assert.equal(Number(mine3[0].vat), 0);

  // בלי סוג עוסק — לא מונפק כלום
  await api('/api/t/achuza/settings', { method: 'PATCH', token: owner, body: { dealer_type: null } });
  const o4 = await deliverOrder(api, { owner, customer, courierUser, slug: 'achuza', items: [{ item_id: bag.id, qty: 1 }], address: 'בדיקת מסמכים 4' });
  const docs5 = await api('/api/t/achuza/documents', { token: owner });
  assert.equal(docs5.json.documents.filter(d => d.order_id === o4.id).length, 0);
});
