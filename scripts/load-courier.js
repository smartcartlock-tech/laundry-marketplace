// בדיקת עומס קלה למסך שליח: 200 שליחים + 1000 הזמנות דמו מול שרת מקומי (Postgres בדיקות).
// הרצה: TEST_DATABASE_URL='postgres://postgres:postgres@127.0.0.1:5433/laundry_test' node scripts/load-courier.js
const { spawn } = require('child_process');
const path = require('path');
const { Client } = require('pg');

const TEST_DB = process.env.TEST_DATABASE_URL || 'postgres://postgres@127.0.0.1:5433/laundry_test';
const N_COURIERS = 200, N_ORDERS = 1000, SAMPLE = 12, ITERS = 5;

async function waitHealth(base, child) {
  const t0 = Date.now(); let log = '';
  child.stdout.on('data', d => { log += d; });
  child.stderr.on('data', d => { log += d; });
  while (Date.now() - t0 < 30000) {
    try { const r = await fetch(base + '/health'); if (r.ok) return; } catch (e) {}
    if (child.exitCode !== null) throw new Error('server exited early:\n' + log);
    await new Promise(r => setTimeout(r, 400));
  }
  throw new Error('not healthy');
}

(async () => {
  const port = 5900 + Math.floor(Math.random() * 200);
  const schema = 'load_' + Math.random().toString(36).slice(2, 8);
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
    env: { ...process.env, DATABASE_URL: TEST_DB, PGSCHEMA: schema, SEED_DEMO: 'true', DEMO_OTP: 'true', PORT: String(port), JWT_SECRET: 'test-secret', TWILIO_ACCOUNT_SID: '', TWILIO_AUTH_TOKEN: '' },
  });
  const base = `http://127.0.0.1:${port}`;
  process.on('exit', () => { try { child.kill('SIGKILL'); } catch (e) {} });
  await waitHealth(base, child);

  const pg = new Client({ connectionString: TEST_DB });
  await pg.connect();
  await pg.query(`SET search_path TO "${schema}"`);

  // שליחים: משתמש + רשומת שליח פלטפורמה מאושרת
  const t0 = Date.now();
  await pg.query(
    `INSERT INTO users(phone, name, role)
     SELECT '+9726'||lpad(g::text,8,'0'), 'שליח עומס '||g, 'courier' FROM generate_series(1,$1) g`, [N_COURIERS]);
  await pg.query(
    `INSERT INTO couriers(user_id, model, vehicle, areas, approved)
     SELECT id, 'platform', 'רכב', '{תל אביב}', true FROM users WHERE phone LIKE '+9726%'`, []);
  const { rows: couriers } = await pg.query(
    `SELECT c.id, u.phone FROM couriers c JOIN users u ON u.id=c.user_id WHERE u.phone LIKE '+9726%' ORDER BY u.phone`);
  const { rows: tenant } = await pg.query(`SELECT id FROM tenants WHERE slug='achuza'`);
  const { rows: cust } = await pg.query(`SELECT id FROM users WHERE phone='+972500000002'`);

  // הזמנות: תמהיל סטטוסים, שיבוץ round-robin
  await pg.query(
    `INSERT INTO orders(tenant_id, customer_id, status, address, subtotal, total, courier_id, updated_at)
     SELECT $1, $2, 'new', 'רחוב העומס '||g||', תל אביב', 60, 60, c.id,
            now() - ((g % 48)::text ||' hours')::interval
     FROM generate_series(1,$3) g
     JOIN LATERAL (SELECT id FROM unnest($4::uuid[]) WITH ORDINALITY AS u(id,ord) WHERE u.ord = g % $5 + 1) c ON true`,
    [tenant[0].id, cust[0].id, N_ORDERS, couriers.map(c => c.id), couriers.length]);
  // תמהיל סטטוסים בעדכונים
  await pg.query(`UPDATE orders SET status='delivered' WHERE id IN (SELECT id FROM orders WHERE address LIKE 'רחוב העומס%' ORDER BY id LIMIT 500)`);
  await pg.query(`UPDATE orders SET status='confirmed' WHERE id IN (SELECT id FROM orders WHERE address LIKE 'רחוב העומס%' AND status<>'delivered' ORDER BY id LIMIT 200)`);
  await pg.query(`UPDATE orders SET status='ready' WHERE id IN (SELECT id FROM orders WHERE address LIKE 'רחוב העומס%' AND status NOT IN ('delivered','confirmed') ORDER BY id LIMIT 150)`);
  await pg.query(`UPDATE orders SET status='out_for_delivery' WHERE id IN (SELECT id FROM orders WHERE address LIKE 'רחוב העומס%' AND status NOT IN ('delivered','confirmed','ready') ORDER BY id LIMIT 100)`);
  // הצעות ממתינות: אחת לכל שליח על הזמנות confirmed שלו
  await pg.query(
    `INSERT INTO courier_offers(courier_id, order_id, kind)
     SELECT DISTINCT ON (courier_id) courier_id, id, 'pickup' FROM orders
     WHERE status='confirmed' AND courier_id IS NOT NULL`);
  // רווחים על מסירות
  await pg.query(
    `INSERT INTO courier_earnings(courier_id, order_id, tenant_id, kind, stops, gross, commission, net, week_start)
     SELECT courier_id, id, tenant_id, 'delivery', 1, 12, 2.4, 9.6, date_trunc('week', now())::date
     FROM orders WHERE status='delivered' AND courier_id IS NOT NULL`);
  if (process.env.DROP_IDX) {
    await pg.query('DROP INDEX IF EXISTS orders_courier_idx');
    await pg.query('DROP INDEX IF EXISTS route_stops_order_idx');
    console.log('indexes dropped (baseline mode)');
  }
  console.log(`seeded ${N_COURIERS} couriers, ${N_ORDERS} orders in ${Date.now() - t0}ms`);

  const api = async (p, { method = 'GET', token, body } = {}) => {
    const headers = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (token) headers.authorization = 'Bearer ' + token;
    const r = await fetch(base + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    return { status: r.status, json: await r.json().catch(() => null) };
  };
  const login = async (phone) => {
    const req = await api('/api/auth/otp/request', { method: 'POST', body: { target: phone } });
    const ver = await api('/api/auth/otp/verify', { method: 'POST', body: { target: phone, code: req.json.demoCode } });
    return ver.json.token;
  };

  const endpoints = ['/api/courier/day-route', '/api/courier/tasks', '/api/courier/offers', '/api/courier/history', '/api/courier/earnings/detail?period=day'];
  const results = {};
  const step = Math.floor(N_COURIERS / SAMPLE);
  for (let i = 0; i < SAMPLE; i++) {
    const tok = await login(couriers[i * step].phone);
    for (const ep of endpoints) {
      const times = [];
      for (let k = 0; k < ITERS; k++) {
        const a = process.hrtime.bigint();
        const r = await api(ep, { token: tok });
        times.push(Number(process.hrtime.bigint() - a) / 1e6);
        if (r.status !== 200) console.error('FAIL', ep, r.status, JSON.stringify(r.json).slice(0, 120));
      }
      (results[ep] = results[ep] || []).push(...times);
    }
  }
  console.log(`\n${SAMPLE} couriers × ${ITERS} iters per endpoint (ms):`);
  for (const [ep, ts] of Object.entries(results)) {
    ts.sort((a, b) => a - b);
    const avg = ts.reduce((a, b) => a + b, 0) / ts.length;
    console.log(`${ep.padEnd(42)} avg ${avg.toFixed(1)}  p50 ${ts[Math.floor(ts.length * .5)].toFixed(1)}  p95 ${ts[Math.floor(ts.length * .95) - 1] ? ts[Math.floor(ts.length * .95)].toFixed(1) : ts[ts.length-1].toFixed(1)}  max ${ts[ts.length - 1].toFixed(1)}`);
  }
  // פרץ מקבילי: 30 קריאות day-route בבת אחת
  const burstTok = await login(couriers[0].phone);
  const b0 = process.hrtime.bigint();
  const burst = await Promise.all(Array.from({ length: 30 }, () => api('/api/courier/day-route', { token: burstTok })));
  const burstMs = Number(process.hrtime.bigint() - b0) / 1e6;
  console.log(`\nconcurrent burst: 30 × day-route in ${burstMs.toFixed(0)}ms, statuses: ${burst.map(r => r.status).join(',')}`);
  // ===== תרחיש קצה 1: שיבוץ אוטומטי מקבילי (8 קריאות auto-build בו-זמנית) =====
  const adminReq = await api('/api/auth/otp/request', { method: 'POST', body: { target: '+972500000001' } });
  const adminTok = (await api('/api/auth/otp/verify', { method: 'POST', body: { target: '+972500000001', code: adminReq.json.demoCode } })).json.token;
  // 200 הזמנות confirmed לא משובצות
  await pg.query(
    `INSERT INTO orders(tenant_id, customer_id, status, address, subtotal, total)
     SELECT $1, $2, 'confirmed', 'רחוב המקביל '||g||', תל אביב', 60, 60 FROM generate_series(1,200) g`,
    [tenant[0].id, cust[0].id]);
  const b1 = process.hrtime.bigint();
  const builds = await Promise.all(Array.from({ length: 8 }, () =>
    api('/api/admin/routes/auto-build', { method: 'POST', token: adminTok, body: {} })));
  const buildMs = Number(process.hrtime.bigint() - b1) / 1e6;
  console.log(`\nparallel auto-build ×8 in ${buildMs.toFixed(0)}ms: statuses ${builds.map(r => r.status).join(',')}`);
  const { rows: dupCheck } = await pg.query(
    `SELECT (SELECT count(*) FROM courier_route_stops rs JOIN orders o ON o.id=rs.order_id WHERE o.address LIKE 'רחוב המקביל%') AS stops,
            (SELECT count(DISTINCT rs.order_id) FROM courier_route_stops rs JOIN orders o ON o.id=rs.order_id WHERE o.address LIKE 'רחוב המקביל%') AS distinct_orders,
            (SELECT count(*) FROM orders WHERE address LIKE 'רחוב המקביל%' AND courier_id IS NOT NULL) AS assigned`);
  console.log(`assigned orders: ${dupCheck[0].assigned}, route stops: ${dupCheck[0].stops}, distinct orders in stops: ${dupCheck[0].distinct_orders}`);
  if (Number(dupCheck[0].stops) !== Number(dupCheck[0].distinct_orders)) console.error('⚠️ RACE: order appears in multiple route stops (double assignment)');
  else console.log('no double-assignment');

  // ===== תרחיש קצה 2: חריגת חלון איסוף + סימון כפול מקבילי =====
  // הזרקת חלון איסוף ליום השבוע של היום (seed מכסה רק א'-ה')
  await pg.query(`INSERT INTO pickup_windows(tenant_id, weekday, start_time, end_time, capacity, kind)
    VALUES ($1, EXTRACT(ISODOW FROM (now() AT TIME ZONE 'Asia/Jerusalem')::date)::int % 7, '09:00','12:00',10,'pickup')`, [tenant[0].id]);
  // 30 הזמנות confirmed עם pickup_at היום 09:00 (חלון 09:00-12:00; עכשיו מחוץ לחלון+חסד → חריגה)
  const c0 = couriers[0];
  await pg.query(
    `INSERT INTO orders(tenant_id, customer_id, status, address, subtotal, total, courier_id, pickup_at)
     SELECT $1, $2, 'confirmed', 'רחוב החלון '||g||', תל אביב', 60, 60, $3,
            ((now() AT TIME ZONE 'Asia/Jerusalem')::date + interval '9 hours') AT TIME ZONE 'Asia/Jerusalem'
     FROM generate_series(1,30) g`, [tenant[0].id, cust[0].id, c0.id]);
  const tok0 = await login(c0.phone);
  const { rows: winOrders } = await pg.query(
    `SELECT id FROM orders WHERE address LIKE 'רחוב החלון%' AND courier_id=$1`, [c0.id]);
  const w0 = process.hrtime.bigint();
  let violations = 0;
  for (const o of winOrders) {
    const r = await api(`/api/courier/orders/${o.id}/mark`, { method: 'POST', token: tok0, body: { action: 'picked_up' } });
    if (r.json && r.json.window_violation) violations++;
    else if (r.status !== 200) console.error('mark FAIL', r.status, JSON.stringify(r.json).slice(0, 100));
  }
  const wMs = Number(process.hrtime.bigint() - w0) / 1e6;
  console.log(`\nwindow-violation marks: ${winOrders.length} picked_up in ${wMs.toFixed(0)}ms (avg ${(wMs / winOrders.length).toFixed(1)}ms), flagged violations: ${violations}/${winOrders.length}`);
  const { rows: ev } = await pg.query(
    `SELECT count(*) FROM order_events e JOIN orders o ON o.id=e.order_id
     WHERE o.address LIKE 'רחוב החלון%' AND e.note LIKE '%חריגה%'`);
  console.log(`order_events with violation note: ${ev[0].count}`);
  // סימון כפול מקבילי על אותה הזמנה: 5 מקבילים → 1 מצליח
  const { rows: one } = await pg.query(
    `SELECT id FROM orders WHERE address LIKE 'רחוב המקביל%' AND courier_id IS NOT NULL AND status='confirmed' LIMIT 1`);
  if (one[0]) {
    const { rows: oc } = await pg.query('SELECT courier_id FROM orders WHERE id=$1', [one[0].id]);
    const { rows: cph } = await pg.query('SELECT u.phone FROM couriers c JOIN users u ON u.id=c.user_id WHERE c.id=$1', [oc[0].courier_id]);
    const tokC = await login(cph[0].phone);
    const marks = await Promise.all(Array.from({ length: 5 }, () =>
      api(`/api/courier/orders/${one[0].id}/mark`, { method: 'POST', token: tokC, body: { action: 'picked_up' } })));
    console.log(`parallel mark ×5 on one order: statuses ${marks.map(r => r.status).join(',')} (expect one 200, rest 409)`);
  }

  await pg.end();
  child.kill('SIGKILL');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
