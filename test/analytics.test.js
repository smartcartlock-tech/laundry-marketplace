const { test } = require('node:test');
const assert = require('node:assert');
const { startApp } = require('./helpers');
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5433/laundry_test';
const { parseRange } = require('../src/routes/analytics');

test('analytics: parseRange', () => {
  assert.equal(parseRange({ from: '2026-10-10', to: '2026-10-01' }), null);
  assert.equal(parseRange({ from: '2024-01-01', to: '2026-10-01' }), null);
  const r = parseRange({ days: '7', to: '2026-10-16' });
  assert.deepEqual(r, { from: '2026-10-10', to: '2026-10-16' });
});

test('analytics: מכבסה ואדמין - הכנסות, שירותים, חוזרים, CSV והרשאות', async (t) => {
  const { api, base } = await startApp(t);
  const customer = await api.login('+972500000002');
  const owner = await api.login('+972500000003');
  const admin = await api.login('+972500000001');
  const l = await api('/api/laundries/achuza');
  const itemId = l.json.items[0].id;
  for (let i = 0; i < 2; i++) {
    const o = await api('/api/orders', { method: 'POST', token: customer, body: { slug: 'achuza', items: [{ item_id: itemId, qty: 2 }], address: 'רחוב בדיקה 1' } });
    assert.equal(o.status, 201);
  }
  const a = await api('/api/t/achuza/analytics?days=7', { token: owner });
  assert.equal(a.status, 200, JSON.stringify(a.json));
  assert.equal(a.json.daily.length, 7);
  assert.ok(a.json.totals.orders >= 2);
  assert.ok(Number(a.json.totals.revenue) > 0);
  assert.ok(a.json.daily.reduce((s, d) => s + d.orders, 0) >= 2);
  assert.ok(a.json.services.length >= 1 && a.json.services[0].service);
  assert.ok(a.json.customers.returning >= 1, 'לקוח עם 2 הזמנות נחשב חוזר');
  assert.ok(a.json.customers.repeat_pct > 0);

  assert.equal((await api('/api/t/achuza/analytics', { token: customer })).status, 403);
  assert.equal((await api('/api/t/achuza/analytics?days=7')).status, 401);
  assert.equal((await api('/api/t/achuza/analytics?from=2026-02-01&to=2026-01-01', { token: owner })).status, 400);

  const csv = await fetch(base + '/api/t/achuza/analytics.csv?days=7', { headers: { Authorization: 'Bearer ' + owner } });
  assert.equal(csv.status, 200);
  const buf = Buffer.from(await csv.arrayBuffer());
  assert.deepEqual([...buf.subarray(0, 3)], [0xEF, 0xBB, 0xBF]);
  assert.ok(buf.toString('utf8').includes('מסמך דמו'));
  assert.ok(buf.toString('utf8').includes('הזמנות לפי שירות'));

  const ad = await api('/api/admin/analytics?days=7', { token: admin });
  assert.equal(ad.status, 200);
  assert.ok(ad.json.by_tenant.some(x => x.name === 'מכבסת האחוזה'));
  const adT = await api('/api/admin/analytics?days=7&tenant=achuza', { token: admin });
  assert.equal(adT.status, 200);
  assert.equal(adT.json.by_tenant.length, 0);
  assert.equal((await api('/api/admin/analytics?tenant=nope', { token: admin })).status, 404);
  assert.equal((await api('/api/admin/analytics', { token: owner })).status, 403);
  const acsv = await fetch(base + '/api/admin/analytics.csv', { headers: { Authorization: 'Bearer ' + admin } });
  assert.equal(acsv.status, 200);
});

test('analytics: קובץ לקוח נטען ב-index.html ו-sw.js', () => {
  const fs = require('fs'), path = require('path');
  const pub = p => fs.readFileSync(path.join(__dirname, '..', 'public', p), 'utf8');
  assert.ok(pub('js/analytics.js').includes('anRange'));
  assert.ok(pub('index.html').includes('/js/analytics.js'));
  assert.ok(pub('sw.js').includes('./js/analytics.js'));
});

test('analytics: שליחים וזמני טיפול', async (t) => {
  const { api, base } = await startApp(t);
  const customer = await api.login('+972500000002');
  const owner = await api.login('+972500000003');
  const admin = await api.login('+972500000001');
  const l = await api('/api/laundries/achuza');
  const o = await api('/api/orders', { method: 'POST', token: customer, body: { slug: 'achuza', items: [{ item_id: l.json.items[0].id, qty: 1 }], address: 'רחוב בדיקה 1' } });
  assert.equal(o.status, 201);
  const oid = o.json.order.id;
  await api(`/api/t/achuza/orders/${oid}/status`, { method: 'POST', token: owner, body: { status: 'confirmed' } });
  const cs = await api('/api/t/achuza/couriers', { token: owner });
  const priv = cs.json.couriers.find(c => c.model === 'private');
  const asg = await api(`/api/t/achuza/orders/${oid}/assign`, { method: 'POST', token: owner, body: { courier_id: priv.id } });
  assert.ok(asg.status < 300, JSON.stringify(asg.json));
  for (const status of ['picked_up', 'in_work', 'ready', 'out_for_delivery', 'delivered']) {
    const s = await api(`/api/t/achuza/orders/${oid}/status`, { method: 'POST', token: owner, body: { status } });
    assert.ok(s.status < 300, status + ' ' + JSON.stringify(s.json));
  }
  const c = await api('/api/t/achuza/analytics/couriers?days=7', { token: owner });
  assert.equal(c.status, 200, JSON.stringify(c.json));
  assert.ok(c.json.handling.delivered >= 1);
  assert.ok(c.json.handling.avg_to_delivery_min !== null);
  assert.ok(c.json.couriers.length >= 1);
  assert.equal((await api('/api/t/achuza/analytics/couriers', { token: customer })).status, 403);
  assert.equal((await api('/api/admin/analytics/couriers', { token: owner })).status, 403);
  assert.equal((await api('/api/admin/analytics/couriers?days=7', { token: admin })).status, 200);
  const csv = await fetch(base + '/api/t/achuza/analytics/couriers.csv?days=7', { headers: { Authorization: 'Bearer ' + owner } });
  const buf = Buffer.from(await csv.arrayBuffer());
  assert.deepEqual([...buf.subarray(0, 3)], [0xEF, 0xBB, 0xBF]);
  assert.ok(buf.toString('utf8').includes('מסמך דמו'));
});
