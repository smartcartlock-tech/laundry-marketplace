// D2: ETag לדף מכבסה (/api/laundries/:slug) — 304 בטעינה חוזרת, וביטול תג אחרי שינוי מחירון.
const test = require('node:test');
const assert = require('node:assert');
const { startApp } = require('./helpers');

test('ETag: טעינה חוזרת מחזירה 304; שינוי מחיר מחדש את התג', async (t) => {
  const { base, api } = await startApp(t);

  const r1 = await fetch(base + '/api/laundries/achuza');
  assert.equal(r1.status, 200);
  const etag = r1.headers.get('etag');
  assert.ok(etag, 'יש ETag');
  assert.match(r1.headers.get('cache-control') || '', /max-age=30/);
  const body1 = await r1.json();
  assert.ok(body1.items.length > 0);

  const r2 = await fetch(base + '/api/laundries/achuza', { headers: { 'if-none-match': etag } });
  assert.equal(r2.status, 304, 'טעינה חוזרת עם התג מחזירה 304');
  assert.equal(await r2.text(), '', 'אין גוף ב-304');

  // בעל המכבסה משנה מחיר → התג מתחדש
  const ownerToken = await api.login('+972500000003');
  const item = body1.items[0];
  const patch = await api(`/api/t/achuza/items/${item.id}`, { method: 'PATCH', token: ownerToken, body: { price: Number(item.price) + 1 } });
  assert.equal(patch.status, 200);

  const r3 = await fetch(base + '/api/laundries/achuza', { headers: { 'if-none-match': etag } });
  assert.equal(r3.status, 200, 'אחרי שינוי מחירון התג השתנה — מוחזר מטען מלא');
  const etag2 = r3.headers.get('etag');
  assert.notEqual(etag2, etag);
  const body3 = await r3.json();
  assert.equal(Number(body3.items.find(i => i.id === item.id).price), Number(item.price) + 1);
});
