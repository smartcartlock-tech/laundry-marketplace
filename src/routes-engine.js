// E5.T3: מנוע איחוד מסלולים רב-מכבסתי + E5.T4: צבירת רווחי שליח לנקודה
const { q, pool } = require('./db');

function haversineKm(a, b) {
  const R = 6371, toRad = d => d * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// סדר נקודות מיטבי (nearest neighbor); נקודות ללא קואורדינטות בסוף לפי זמן יצירה
function nearestNeighbor(stops) {
  const withGeo = stops.filter(s => s.lat != null && s.lng != null);
  const noGeo = stops.filter(s => s.lat == null || s.lng == null)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const ordered = [];
  let cur = withGeo.shift();
  while (cur) {
    ordered.push(cur);
    if (!withGeo.length) break;
    let bestI = 0, bestD = Infinity;
    withGeo.forEach((s, i) => { const d = haversineKm(cur, s); if (d < bestD) { bestD = d; bestI = i; } });
    cur = withGeo.splice(bestI, 1)[0];
  }
  return ordered.concat(noGeo);
}

async function getSetting(key, fallback) {
  const { rows } = await q('SELECT value FROM platform_settings WHERE key=$1', [key]);
  return rows[0] ? rows[0].value : fallback;
}

function weekStart(d) {
  const dt = new Date(d);
  dt.setDate(dt.getDate() - dt.getDay()); // ראשון
  return dt.toISOString().slice(0, 10);
}

// בניית מסלולים אוטומטית לתאריך: מאחד איסופים/החזרות לא משובצים לפי אזור (עיר),
// משבץ שליח פלטפורמה/משותף מאושר לפי אזור פעילות וקדימות, ומסדר נקודות nearest-neighbor.
async function buildRoutesForDate(dateStr) {
  const day = dateStr || new Date().toISOString().slice(0, 10);
  const { rows: orders } = await q(
    `SELECT o.id, o.tenant_id, o.address, o.lat, o.lng, o.created_at, o.status,
            t.city, t.lat AS tenant_lat, t.lng AS tenant_lng
     FROM orders o JOIN tenants t ON t.id=o.tenant_id
     WHERE o.courier_id IS NULL AND o.status IN ('confirmed','ready')
       AND o.id NOT IN (SELECT order_id FROM courier_route_stops)
     ORDER BY o.created_at`, []);
  if (!orders.length) return { date: day, routes: [], skipped: 'no unassigned orders' };

  const byCity = {};
  for (const o of orders) {
    const key = (o.city || 'אחר').trim();
    (byCity[key] = byCity[key] || []).push(o);
  }
  const { rows: couriers } = await q(
    `SELECT c.*, u.name FROM couriers c JOIN users u ON u.id=c.user_id
     WHERE c.approved=true AND c.rejected_reason IS NULL AND c.model IN ('platform','shared')
     ORDER BY c.priority DESC NULLS LAST, c.rating DESC, c.created_at`, []);
  if (!couriers.length) return { date: day, routes: [], skipped: 'no approved platform couriers' };

  const client = await pool.connect();
  const built = [];
  const assigned = new Set();
  try {
    await client.query('BEGIN');
    // E5.T6: מסלולים קבועים של קלאסטרים משבצים אוטומטית בימיהם
    const weekday = new Date(day + 'T12:00:00').getDay();
    const { rows: fixed } = await client.query(
      `SELECT fr.courier_id, cl.id AS cluster_id, cl.name AS cluster_name,
              array_agg(DISTINCT cm.tenant_id) AS tenant_ids
       FROM cluster_fixed_routes fr
       JOIN courier_clusters cl ON cl.id=fr.cluster_id AND cl.active
       JOIN courier_cluster_members cm ON cm.cluster_id=cl.id
       WHERE fr.active AND fr.weekday=$1
       GROUP BY fr.courier_id, cl.id, cl.name`, [weekday]);
    for (const fx of fixed) {
      const courier = couriers.find(c => c.id === fx.courier_id);
      if (!courier) continue;
      const memberOrders = [];
      for (const [city, cityOrders] of Object.entries(byCity)) {
        const mine = cityOrders.filter(o => fx.tenant_ids.includes(o.tenant_id) && !assigned.has(o.id));
        if (mine.length) memberOrders.push(...mine);
      }
      if (!memberOrders.length) continue;
      const stops = nearestNeighbor(memberOrders.map(o => ({
        ...o, lat: o.lat != null ? o.lat : o.tenant_lat, lng: o.lng != null ? o.lng : o.tenant_lng,
      })));
      const tenantIds = [...new Set(stops.map(x => x.tenant_id))];
      const { rows: rr } = await client.query(
        `INSERT INTO courier_routes(courier_id, route_date, combined) VALUES ($1,$2,$3) RETURNING id`,
        [courier.id, day, tenantIds.length >= 2]);
      let seq = 1;
      for (const st of stops) {
        await client.query(`INSERT INTO courier_route_stops(route_id, order_id, tenant_id, seq) VALUES ($1,$2,$3,$4)`, [rr[0].id, st.id, st.tenant_id, seq++]);
        await client.query('UPDATE orders SET courier_id=$1, updated_at=now() WHERE id=$2', [courier.id, st.id]);
        await client.query(`INSERT INTO order_events(order_id, status, actor_id, note) VALUES ($1,(SELECT status FROM orders WHERE id=$1),NULL,$2)`, [st.id, `שובץ למסלול קבוע של קלאסטר ${fx.cluster_name}`]);
        assigned.add(st.id);
      }
      built.push({ route_id: rr[0].id, city: fx.cluster_name, courier_id: courier.id, courier_name: courier.name, stops: stops.length, tenants: tenantIds.length, combined: tenantIds.length >= 2, fixed: true });
    }
    for (const [city, cityOrders0] of Object.entries(byCity)) {
      const cityOrders = cityOrders0.filter(o => !assigned.has(o.id));
      if (!cityOrders.length) continue;
      const courier = couriers.find(c => (c.areas || []).some(a => city.includes(a) || a.includes(city))) || couriers[0];
      const stops = nearestNeighbor(cityOrders.map(o => ({
        ...o, lat: o.lat != null ? o.lat : o.tenant_lat, lng: o.lng != null ? o.lng : o.tenant_lng,
      })));
      const tenantIds = [...new Set(stops.map(s => s.tenant_id))];
      const { rows: rr } = await client.query(
        `INSERT INTO courier_routes(courier_id, route_date, combined) VALUES ($1,$2,$3) RETURNING id`,
        [courier.id, day, tenantIds.length >= 2]);
      const routeId = rr[0].id;
      let seq = 1;
      for (const s of stops) {
        await client.query(
          `INSERT INTO courier_route_stops(route_id, order_id, tenant_id, seq) VALUES ($1,$2,$3,$4)`,
          [routeId, s.id, s.tenant_id, seq++]);
        await client.query('UPDATE orders SET courier_id=$1, updated_at=now() WHERE id=$2', [courier.id, s.id]);
        await client.query(
          `INSERT INTO order_events(order_id, status, actor_id, note) VALUES ($1,(SELECT status FROM orders WHERE id=$1),NULL,$2)`,
          [s.id, `שובץ למסלול ${tenantIds.length >= 2 ? 'משולב' : ''} אוטומטי (${city})`]);
        assigned.add(s.id);
      }
      built.push({ route_id: routeId, city, courier_id: courier.id, courier_name: courier.name, stops: stops.length, tenants: tenantIds.length, combined: tenantIds.length >= 2 });
    }
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
  finally { client.release(); }
  return { date: day, routes: built };
}

// E5.T4: צבירת נקודה (איסוף/מסירה) לזכות השליח — פיצול אוטומטי לפי המכבסה של ההזמנה
async function accrueStop(courierId, order, stopKind) {
  const rate = Number(await getSetting('courier_rate_per_stop', '12'));
  const pct = Number(await getSetting('courier_commission_pct', '20'));
  const gross = rate;
  const commission = Math.round(gross * pct) / 100;
  const net = Math.round((gross - commission) * 100) / 100;
  await q(
    `INSERT INTO courier_earnings(courier_id, order_id, tenant_id, kind, stops, gross, commission, net, week_start)
     VALUES ($1,$2,$3,$4,1,$5,$6,$7,$8)
     ON CONFLICT (courier_id, order_id, kind) DO NOTHING`,
    [courierId, order.id, order.tenant_id, stopKind, gross, commission, net, weekStart(new Date())]);
  return { gross, commission, net };
}

module.exports = { buildRoutesForDate, accrueStop, nearestNeighbor, haversineKm, weekStart, getSetting };

// E5.T7: עדכון דירוג מצטבר וקדימות שיבוץ — דירוג נמוך חוזר מוריד קדימות
async function applyCourierRating(courierId, rating) {
  await q(
    `UPDATE couriers SET
       rating = (SELECT COALESCE(avg(rating),0)::numeric(2,1) FROM reviews WHERE target_courier_id=$1),
       rating_count = (SELECT count(*)::int FROM reviews WHERE target_courier_id=$1)
     WHERE id=$1`, [courierId]);
  if (rating <= 2) {
    await q('UPDATE couriers SET priority = GREATEST(0.2, COALESCE(priority,1.0) - 0.15) WHERE id=$1', [courierId]);
  } else if (rating >= 4) {
    await q('UPDATE couriers SET priority = LEAST(1.5, COALESCE(priority,1.0) + 0.05) WHERE id=$1', [courierId]);
  }
}

module.exports.applyCourierRating = applyCourierRating;
