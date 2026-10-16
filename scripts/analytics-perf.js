// בדיקת ביצועים לאנליטיקה: זורע N הזמנות דמו בסכימה מבודדת ומודד את ה-endpoints. שימוש: N=5000 node scripts/analytics-perf.js
const { Client } = require('pg');
const { startApp, TEST_DB } = require('../test/helpers');
const N = Number(process.env.N || 5000);
(async () => {
  const cleanups = [];
  const t = { after: f => cleanups.push(f) };
  const { api, schema } = await startApp(t);
  const owner = await api.login('+972500000003'), admin = await api.login('+972500000001');
  const db = new Client({ connectionString: process.env.TEST_DATABASE_URL || TEST_DB });
  await db.connect(); await db.query(`SET search_path TO ${schema}`);
  const { rows: [tn] } = await db.query(`SELECT id FROM tenants WHERE slug='achuza'`);
  const { rows: [cu] } = await db.query(`SELECT id FROM users WHERE phone='+972500000002'`);
  await db.query(`INSERT INTO users(phone,name,role) SELECT '+9725100'||lpad(g::text,5,'0'),'לקוח דמו '||g,'customer' FROM generate_series(1,800) g ON CONFLICT DO NOTHING`).catch(e => console.log('users seed:', e.message));
  await db.query(`INSERT INTO orders(tenant_id,customer_id,status,address,subtotal,total,created_at)
    SELECT $1,(SELECT id FROM users ORDER BY md5(g::text) LIMIT 1),(ARRAY['delivered','delivered','delivered','cancelled','new'])[1+g%5],'דמו',50,50+g%40, now()-(g%180||' days')::interval - (g%1440||' minutes')::interval
    FROM generate_series(1,$2) g`, [tn.id, N]);
  await db.query(`INSERT INTO order_items(order_id,name,price,qty) SELECT id,'פריט דמו',25,2 FROM orders WHERE address='דמו'`);
  await db.query(`INSERT INTO order_events(order_id,status,created_at) SELECT id,'confirmed',created_at+interval '10 minutes' FROM orders WHERE address='דמו'`);
  await db.query(`INSERT INTO order_events(order_id,status,created_at) SELECT id,'delivered',created_at+interval '300 minutes' FROM orders WHERE address='דמו' AND status='delivered'`);
  await db.query('ANALYZE');
  const { rows: [c] } = await db.query('SELECT count(*)::int n FROM orders'); console.log('orders in schema:', c.n);
  for (const [name, p, tok] of [['tenant analytics 90d', '/api/t/achuza/analytics?days=90', owner], ['tenant analytics 366d', '/api/t/achuza/analytics?days=366', owner], ['tenant couriers 90d', '/api/t/achuza/analytics/couriers?days=90', owner], ['admin analytics 90d', '/api/admin/analytics?days=90', admin], ['admin couriers 90d', '/api/admin/analytics/couriers?days=90', admin]]) {
    const t0 = Date.now(); const r = await api(p, { token: tok }); console.log(name, r.status, (Date.now() - t0) + 'ms');
  }
  await db.end(); cleanups.forEach(f => f()); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
