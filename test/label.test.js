// C4: תווית שקית/דף איסוף PDF — הרשאות, תוכן, הפרדת מכבסות
const { test } = require('node:test');
const assert = require('node:assert');
const { startApp } = require('./helpers');

test('label: PDF תקין, הרשאות, הזמנה של מכבסה אחרת נדחית', async (t) => {
  const { base, api } = await startApp(t);
  const owner = await api.login('+972500000003'); // בעל אחוזה
  const otherOwner = await api.login('+972500000004'); // בעל מכבסה אחרת
  const customer = await api.login('+972500000002');

  const raw = (p, token) => fetch(base + p, { headers: token ? { authorization: 'Bearer ' + token } : {} });

  const it = await api('/api/t/achuza/items', { method: 'POST', token: owner, body: { name: 'שק תווית', price: 30, unit: 'bag', category: 'כביסה' } });
  assert.equal(it.status, 201, JSON.stringify(it.json));
  const o = await api('/api/orders', { method: 'POST', token: customer, body: { slug: 'achuza', items: [{ item_id: it.json.item.id, qty: 2 }], address: 'רחוב התווית 4, תל אביב' } });
  assert.equal(o.status, 201, JSON.stringify(o.json));
  const id = o.json.order.id;

  // ללא אימות
  assert.equal((await raw(`/api/t/achuza/orders/${id}/label.pdf`)).status, 401);

  // לקוח שאינו חבר מכבסה
  assert.ok([401, 403].includes((await raw(`/api/t/achuza/orders/${id}/label.pdf`, customer)).status));

  // בעל מכבסה אחרת — לא רואה הזמנה שלא שלו
  assert.ok([401, 403, 404].includes((await raw(`/api/t/achuza/orders/${id}/label.pdf`, otherOwner)).status));

  // בעל המכבסה — PDF תקין
  const ok = await raw(`/api/t/achuza/orders/${id}/label.pdf`, owner);
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('content-type') || '', /application\/pdf/);
  const buf = Buffer.from(await ok.arrayBuffer());
  assert.ok(buf.length > 500, 'PDF לא ריק');
  assert.equal(buf.slice(0, 5).toString('latin1'), '%PDF-');

  // הזמנה לא קיימת
  assert.equal((await raw('/api/t/achuza/orders/00000000-0000-0000-0000-000000000000/label.pdf', owner)).status, 404);
});
