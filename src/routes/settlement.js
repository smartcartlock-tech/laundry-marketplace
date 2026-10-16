// חשבוניות והתחשבנות למכבסה (דמו בלבד — בלי חיוב אמיתי ובלי הגשות לרשות המסים):
// דוח תשלומים, התחשבנות עמלה חודשית (ציפייה מול בפועל + הפרש), ייצוא לרואה חשבון,
// ובדיקת רצף מספור מסמכים. כל הייצוא מסומן "מסמך דמו".
const express = require('express');
const { q } = require('../db');
const { requireAuth, requireTenantMember } = require('../auth');
const { sendCsv } = require('../csv');
const { KIND_HE } = require('../documents');

const r = express.Router({ mergeParams: true });
r.use(requireAuth, requireTenantMember);

const TZ = 'Asia/Jerusalem';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function period(req) {
  let { from, to } = req.query || {};
  if (from && !DATE_RE.test(from)) return { error: 'תאריך from לא תקין (YYYY-MM-DD)' };
  if (to && !DATE_RE.test(to)) return { error: 'תאריך to לא תקין (YYYY-MM-DD)' };
  if (!from || !to) {
    // ברירת מחדל: החודש הקלנדרי הנוכחי בשעון ישראל
    const nowIL = new Date(new Date().toLocaleString('en-US', { timeZone: TZ }));
    const y = nowIL.getFullYear(), m = nowIL.getMonth();
    if (!from) from = `${y}-${String(m + 1).padStart(2, '0')}-01`;
    if (!to) to = `${y}-${String(m + 1).padStart(2, '0')}-${String(new Date(y, m + 1, 0).getDate()).padStart(2, '0')}`;
  }
  if (from > to) return { error: 'from מאוחר מ-to' };
  return { from, to };
}

const PAY_METHOD_HE = { cash: 'מזומן', demo_online: 'אונליין (דמו)' };
const PAY_STATUS_HE = { pending: 'ממתין לגבייה', paid_demo: 'שולם (דמו)', paid_cash: 'שולם במזומן' };
const PAID = "('paid_demo','paid_cash')";

// --- דוח תשלומים: מצטבר + פילוח אמצעי×סטטוס + יומי ---
r.get('/settlement/payments', async (req, res) => {
  const p = period(req);
  if (p.error) return res.status(400).json({ error: p.error });
  const tid = req.tenant.id;
  const [kpi, byMethod, byDay, cancelled] = await Promise.all([
    q(`SELECT count(*)::int AS orders, COALESCE(sum(o.total),0)::numeric(10,2) AS revenue,
         COALESCE(sum(o.total) FILTER (WHERE o.payment_status IN ${PAID}),0)::numeric(10,2) AS collected,
         COALESCE(sum(o.total) FILTER (WHERE o.payment_status='pending'),0)::numeric(10,2) AS pending
       FROM orders o WHERE o.tenant_id=$1 AND o.status<>'cancelled'
         AND (o.created_at AT TIME ZONE '${TZ}')::date BETWEEN $2 AND $3`, [tid, p.from, p.to]),
    q(`SELECT o.payment_method, o.payment_status, count(*)::int AS orders, COALESCE(sum(o.total),0)::numeric(10,2) AS total
       FROM orders o WHERE o.tenant_id=$1 AND o.status<>'cancelled'
         AND (o.created_at AT TIME ZONE '${TZ}')::date BETWEEN $2 AND $3
       GROUP BY 1,2 ORDER BY 1,2`, [tid, p.from, p.to]),
    q(`SELECT to_char(o.created_at AT TIME ZONE '${TZ}','YYYY-MM-DD') AS day, count(*)::int AS orders,
         COALESCE(sum(o.total),0)::numeric(10,2) AS total,
         COALESCE(sum(o.total) FILTER (WHERE o.payment_status IN ${PAID}),0)::numeric(10,2) AS collected
       FROM orders o WHERE o.tenant_id=$1 AND o.status<>'cancelled'
         AND (o.created_at AT TIME ZONE '${TZ}')::date BETWEEN $2 AND $3
       GROUP BY 1 ORDER BY 1`, [tid, p.from, p.to]),
    q(`SELECT count(*)::int AS orders, COALESCE(sum(o.total),0)::numeric(10,2) AS total
       FROM orders o WHERE o.tenant_id=$1 AND o.status='cancelled'
         AND (o.created_at AT TIME ZONE '${TZ}')::date BETWEEN $2 AND $3`, [tid, p.from, p.to]),
  ]);
  res.json({
    from: p.from, to: p.to, demo: true,
    kpis: kpi.rows[0],
    by_method: byMethod.rows.map(x => ({ ...x, method_he: PAY_METHOD_HE[x.payment_method] || x.payment_method, status_he: PAY_STATUS_HE[x.payment_status] || x.payment_status, total: Number(x.total) })),
    by_day: byDay.rows.map(x => ({ ...x, total: Number(x.total), collected: Number(x.collected) })),
    cancelled: { orders: cancelled.rows[0].orders, total: Number(cancelled.rows[0].total) },
  });
});

// --- דוח תשלומים CSV (פירוט הזמנות) ---
r.get('/settlement/payments.csv', async (req, res) => {
  const p = period(req);
  if (p.error) return res.status(400).json({ error: p.error });
  const { rows } = await q(
    `SELECT o.id, to_char(o.created_at AT TIME ZONE '${TZ}','YYYY-MM-DD') AS day, u.name AS customer, o.status,
            o.payment_method, o.payment_status, o.subtotal, o.delivery_fee, o.discount, o.total
     FROM orders o LEFT JOIN users u ON u.id=o.customer_id
     WHERE o.tenant_id=$1 AND (o.created_at AT TIME ZONE '${TZ}')::date BETWEEN $2 AND $3
     ORDER BY day, o.created_at LIMIT 5000`, [req.tenant.id, p.from, p.to]);
  const HE = { new:'התקבלה',confirmed:'אושרה',picked_up:'נאספה',in_work:'בעבודה',ready:'מוכנה',out_for_delivery:'בדרך',delivered:'הוחזרה',cancelled:'בוטלה' };
  const out = [
    ['מסמך דמו — דוח תשלומים, נוצר במערכת דמו ללא חיוב אמיתי'],
    [`תקופה: ${p.from} עד ${toSafe(p.to)}`],
    [],
    ['תאריך','מספר הזמנה','לקוח','סטטוס הזמנה','אמצעי תשלום','סטטוס גבייה','סכום ביניים','משלוח','הנחה','סה"כ'],
  ];
  for (const o of rows) {
    out.push([o.day, String(o.id).slice(0,8), o.customer || '', HE[o.status] || o.status,
      PAY_METHOD_HE[o.payment_method] || o.payment_method, PAY_STATUS_HE[o.payment_status] || o.payment_status,
      Number(o.subtotal).toFixed(2), Number(o.delivery_fee).toFixed(2), Number(o.discount).toFixed(2), Number(o.total).toFixed(2)]);
  }
  sendCsv(res, `payments-${p.from}-${p.to}-demo.csv`, out);
});
function toSafe(s) { return String(s).replace(/[\[\]\/\\]/g, '-'); }

// --- עמלה: ציפייה מחושבת מההזמנות לחודש נתון (אותו פיצול ערוצים כמו בדוחות) ---
async function commissionExpected(tid, year, month) {
  const { rows: rates } = await q(`SELECT key, value FROM platform_settings WHERE key IN ('branded_commission_pct','marketplace_commission_pct')`);
  const rate = Object.fromEntries(rates.map(x => [x.key, Number(x.value)]));
  const ownPct = rate.branded_commission_pct || 5, mktPct = rate.marketplace_commission_pct || 12;
  const { rows: split } = await q(
    `SELECT CASE WHEN o.source='branded' OR u.signup_tenant_id=o.tenant_id THEN 'own' ELSE 'marketplace' END AS channel,
            count(*)::int AS orders, COALESCE(sum(o.total),0)::numeric(10,2) AS revenue
     FROM orders o JOIN users u ON u.id=o.customer_id
     WHERE o.tenant_id=$1 AND o.status<>'cancelled'
       AND EXTRACT(YEAR FROM o.created_at AT TIME ZONE '${TZ}')=$2
       AND EXTRACT(MONTH FROM o.created_at AT TIME ZONE '${TZ}')=$3
     GROUP BY 1`, [tid, year, month]);
  const m = Object.fromEntries(split.map(x => [x.channel, x]));
  const own = m.own || { orders: 0, revenue: 0 }, mkt = m.marketplace || { orders: 0, revenue: 0 };
  const ownRev = Number(own.revenue), mktRev = Number(mkt.revenue);
  const ownComm = Math.round(ownRev * ownPct) / 100, mktComm = Math.round(mktRev * mktPct) / 100;
  return {
    own: { orders: own.orders, revenue: ownRev, pct: ownPct, commission: ownComm },
    marketplace: { orders: mkt.orders, revenue: mktRev, pct: mktPct, commission: mktComm },
    total: Math.round((ownComm + mktComm) * 100) / 100,
  };
}

r.get('/settlement/commission', async (req, res) => {
  const year = Number(req.query.year), month = Number(req.query.month);
  if (!Number.isInteger(year) || year < 2000 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) {
    return res.status(400).json({ error: 'חודש/שנה לא תקינים' });
  }
  const expected = await commissionExpected(req.tenant.id, year, month);
  const { rows: st } = await q('SELECT * FROM commission_statements WHERE tenant_id=$1 AND year=$2 AND month=$3', [req.tenant.id, year, month]);
  const s = st[0];
  const statement = s ? {
    year: s.year, month: s.month, expected_total: Number(s.expected_total),
    actual_total: s.actual_total === null ? null : Number(s.actual_total),
    diff: s.actual_total === null ? null : Math.round((Number(s.actual_total) - Number(s.expected_total)) * 100) / 100,
    note: s.note, updated_at: s.updated_at,
  } : null;
  const { rows: hist } = await q(
    `SELECT year, month, expected_total, actual_total,
            CASE WHEN actual_total IS NULL THEN NULL ELSE round((actual_total - expected_total)::numeric, 2) END AS diff,
            note, updated_at
     FROM commission_statements WHERE tenant_id=$1 ORDER BY year DESC, month DESC LIMIT 12`, [req.tenant.id]);
  res.json({ year, month, expected, statement, history: hist.map(h => ({ ...h, expected_total: Number(h.expected_total), actual_total: h.actual_total === null ? null : Number(h.actual_total), diff: h.diff === null ? null : Number(h.diff) })), demo: true });
});

// רישום החיוב בפועל (הזנה ידנית של המכבסה) + צילום הציפייה באותו רגע
r.post('/settlement/commission', async (req, res) => {
  const year = Number(req.body?.year), month = Number(req.body?.month);
  const actual = req.body?.actual_total;
  const note = req.body?.note ? String(req.body.note).slice(0, 300) : null;
  if (!Number.isInteger(year) || year < 2000 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) {
    return res.status(400).json({ error: 'חודש/שנה לא תקינים' });
  }
  if (actual !== null && !(Number(actual) >= 0 && Number(actual) < 10000000)) {
    return res.status(400).json({ error: 'סכום חיוב בפועל לא תקין' });
  }
  const e = await commissionExpected(req.tenant.id, year, month);
  const { rows } = await q(
    `INSERT INTO commission_statements(tenant_id, year, month, own_orders, own_revenue, own_pct,
        marketplace_orders, marketplace_revenue, marketplace_pct, expected_total, actual_total, note, recorded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (tenant_id, year, month) DO UPDATE SET
        own_orders=EXCLUDED.own_orders, own_revenue=EXCLUDED.own_revenue, own_pct=EXCLUDED.own_pct,
        marketplace_orders=EXCLUDED.marketplace_orders, marketplace_revenue=EXCLUDED.marketplace_revenue,
        marketplace_pct=EXCLUDED.marketplace_pct, expected_total=EXCLUDED.expected_total,
        actual_total=EXCLUDED.actual_total, note=EXCLUDED.note, recorded_by=EXCLUDED.recorded_by, updated_at=now()
     RETURNING *`,
    [req.tenant.id, year, month, e.own.orders, e.own.revenue, e.own.pct, e.marketplace.orders, e.marketplace.revenue, e.marketplace.pct, e.total, actual === null ? null : Number(actual), note, req.user.id]);
  const s = rows[0];
  res.json({ statement: { year: s.year, month: s.month, expected_total: Number(s.expected_total), actual_total: s.actual_total === null ? null : Number(s.actual_total), diff: s.actual_total === null ? null : Math.round((Number(s.actual_total) - Number(s.expected_total)) * 100) / 100, note: s.note, updated_at: s.updated_at }, demo: true });
});

// --- ייצוא לרואה חשבון: כל המסמכים בתקופה (מסומן דמו) ---
r.get('/settlement/accountant-export.csv', async (req, res) => {
  const p = period(req);
  if (p.error) return res.status(400).json({ error: p.error });
  const { rows } = await q(
    `SELECT d.kind, d.doc_number, d.doc_year, to_char(d.issued_at AT TIME ZONE '${TZ}','YYYY-MM-DD') AS day,
            u.name AS customer, d.amount, d.vat, d.total, d.status, d.credited_amount, d.allocation_number
     FROM documents d LEFT JOIN users u ON u.id=d.customer_id
     WHERE d.tenant_id=$1 AND (d.issued_at AT TIME ZONE '${TZ}')::date BETWEEN $2 AND $3
     ORDER BY d.kind, d.doc_number LIMIT 10000`, [req.tenant.id, p.from, p.to]);
  const ST_HE = { issued: 'הופק', partially_credited: 'זוכה חלקית', credited: 'זוכה' };
  const out = [
    ['מסמך דמו — ייצוא לרואה חשבון, נוצר במערכת דמו. לא חשבונית מס ולא לצורכי מע"מ'],
    [`מכבסה: ${req.tenant.name} · תקופה: ${p.from} עד ${p.to}`],
    [],
    ['סוג מסמך','מספר','שנה','תאריך הפקה','לקוח','סכום לפני מע"מ','מע"מ','סה"כ','סטטוס','זוכה בסה"כ','מספר הקצאה'],
  ];
  let sumTotal = 0, sumVat = 0;
  for (const d of rows) {
    sumTotal += Number(d.total); sumVat += Number(d.vat);
    out.push([KIND_HE[d.kind] || d.kind, d.doc_number, d.doc_year, d.day, d.customer || '',
      Number(d.amount).toFixed(2), Number(d.vat).toFixed(2), Number(d.total).toFixed(2),
      ST_HE[d.status] || d.status, Number(d.credited_amount).toFixed(2), d.allocation_number || '']);
  }
  out.push([]);
  out.push(['סיכום', rows.length + ' מסמכים', '', '', '', '', sumVat.toFixed(2), sumTotal.toFixed(2), '', '', '']);
  sendCsv(res, `accountant-export-${p.from}-${p.to}-demo.csv`, out);
});

// --- בדיקת רצף מספור: פערים בין מספרי המסמכים שהונפקו, לכל סוג ---
r.get('/settlement/sequence-check', async (req, res) => {
  const { rows } = await q(
    `SELECT d.kind, count(*)::int AS docs, min(d.doc_number) AS min_n, max(d.doc_number) AS max_n,
            (SELECT c.next_number FROM doc_counters c WHERE c.tenant_id=d.tenant_id AND c.kind=d.kind AND c.year=0) AS counter_next
     FROM documents d WHERE d.tenant_id=$1 GROUP BY d.kind, d.tenant_id`, [req.tenant.id]);
  const kinds = ['invoice', 'receipt', 'credit', 'consolidated'];
  const out = [];
  for (const kind of kinds) {
    const row = rows.find(x => x.kind === kind);
    if (!row) { out.push({ kind, kind_he: KIND_HE[kind], docs: 0, ok: true, missing: [] }); continue; }
    const { rows: nums } = await q('SELECT doc_number FROM documents WHERE tenant_id=$1 AND kind=$2 ORDER BY doc_number', [req.tenant.id, kind]);
    const missing = [];
    let prev = 0;
    for (const n of nums) {
      const cur = Number(n.doc_number);
      if (prev && cur > prev + 1) for (let g = prev + 1; g < cur && missing.length < 50; g++) missing.push(g);
      prev = cur;
    }
    const counterOk = row.counter_next === null || Number(row.counter_next) === Number(row.max_n) + 1;
    out.push({ kind, kind_he: KIND_HE[kind], docs: row.docs, min: Number(row.min_n), max: Number(row.max_n), counter_next: row.counter_next === null ? null : Number(row.counter_next), missing, ok: missing.length === 0 && counterOk });
  }
  res.json({ kinds: out, ok: out.every(k => k.ok), demo: true });
});

module.exports = r;
