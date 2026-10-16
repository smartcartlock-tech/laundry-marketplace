const { test } = require('node:test');
const assert = require('node:assert');
const { startApp } = require('./helpers');

test('receipt: קבלה PDF מונפקת להזמנה, הרשאות נאכפות', async (t) => {
  const { api, base } = await startApp(t);
  const customer = await api.login('+972500000002');
  const other = await api.login('+972500000099');

  const page = await api('/api/laundries/achuza');
  const bag = page.json.items.find(i => i.name.includes('שק'));
  const created = await api('/api/orders', { method: 'POST', token: customer, body: { slug: 'achuza', items: [{ item_id: bag.id, qty: 1 }], address: 'הרצל 12, תל אביב' } });
  const oid = created.json.order.id;

  const r = await fetch(`${base}/api/orders/${oid}/receipt.pdf`, { headers: { authorization: 'Bearer ' + customer } });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /application\/pdf/);
  const buf = Buffer.from(await r.arrayBuffer());
  assert.ok(buf.length > 1500, 'PDF לא ריק');
  assert.equal(buf.slice(0, 5).toString(), '%PDF-');

  // לקוח אחר — 403
  const r2 = await fetch(`${base}/api/orders/${oid}/receipt.pdf`, { headers: { authorization: 'Bearer ' + other } });
  assert.equal(r2.status, 403);
});
