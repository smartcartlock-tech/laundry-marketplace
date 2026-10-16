// הנהלת חשבונות אמיתית (לא דמו) — ספר תנועות כפול, כרטיסים, סגירת תקופה.
// הרשאות קשיחות: בעלים בלבד (tenant_members.role='owner'), יומן ביקורת על כל שינוי.
// גבולות: בלי הגשה לרשות המסים, בלי מספרי הקצאה, בלי תשלומים, בלי שליחה החוצה.
const express = require('express');
const { q } = require('../db');
const { requireAuth, requireTenantMember } = require('../auth');
const { audit } = require('../audit');

const r = express.Router({ mergeParams: true });
r.use(requireAuth, requireTenantMember, requireTenantOwner);

// בעלים בלבד — אפילו staff לא נוגע בנתוני הנה"ח אמיתיים
async function requireTenantOwner(req, res, next) {
  if (req.user.role === 'admin') return next();
  const { rows } = await q(
    `SELECT 1 FROM tenant_members WHERE tenant_id=$1 AND user_id=$2 AND role='owner'`,
    [req.tenant.id, req.user.id]);
  if (!rows[0]) return res.status(403).json({ error: 'נדרשת הרשאת בעלים להנהלת החשבונות' });
  next();
}

// תרשים חשבונות ישראלי בסיסי — נזרע פעם אחת לטננט, idempotent
const DEFAULT_CHART = [
  ['1000','קופה - מזומן','asset'], ['1010','בנק - עו"ש','asset'], ['1020','לקוחות','asset'],
  ['1030','מלאי','asset'], ['1040','מקדמות לספקים','asset'],
  ['2000','ספקים','liability'], ['2010','מע"מ עסקאות','liability'], ['2020','מע"מ תשומות','liability'],
  ['2030','התחייבויות שוטפות','liability'],
  ['3000','הון עצמי','equity'], ['3010','יתרת פתיחה','equity'], ['3020','משיכות בעלים','equity'],
  ['4000','הכנסות משירותי כביסה','income'], ['4010','הכנסות אחרות','income'],
  ['5000','חומרי ניקוי וכביסה','expense'], ['5010','שכירות','expense'], ['5020','חשמל, מים וגז','expense'],
  ['5030','שכר עבודה','expense'], ['5040','דלק ומשלוחים','expense'], ['5050','שיווק ופרסום','expense'],
  ['5060','עמלות פלטפורמה','expense'], ['5070','הוצאות משרדיות','expense'], ['5090','הוצאות אחרות','expense'],
];

// --- אתחול תרשים חשבונות (idempotent) ---
r.post('/bookkeeping/init', async (req, res) => {
  const tid = req.tenant.id;
  let inserted = 0;
  for (const [code, name, type] of DEFAULT_CHART) {
    const { rowCount } = await q(
      `INSERT INTO bk_accounts (tenant_id, code, name_he, type, system)
       VALUES ($1,$2,$3,$4,true) ON CONFLICT (tenant_id, code) DO NOTHING`,
      [tid, code, name, type]);
    inserted += rowCount;
  }
  await audit(req, 'bk_init', 'tenant', tid, { inserted });
  res.json({ ok: true, accounts: DEFAULT_CHART.length, inserted });
});

// --- חשבונות ---
r.get('/bookkeeping/accounts', async (req, res) => {
  const { rows } = await q(
    `SELECT id, code, name_he, type, system, active FROM bk_accounts
     WHERE tenant_id=$1 ORDER BY code`, [req.tenant.id]);
  res.json({ accounts: rows });
});

r.post('/bookkeeping/accounts', async (req, res) => {
  const { code, name_he, type } = req.body || {};
  if (!/^[0-9]{4}$/.test(String(code || ''))) return res.status(400).json({ error: 'קוד חשבון חייב להיות 4 ספרות' });
  if (!name_he || String(name_he).length > 100) return res.status(400).json({ error: 'שם חשבון חסר או ארוך מדי' });
  if (!['asset','liability','equity','income','expense'].includes(type)) return res.status(400).json({ error: 'סוג חשבון לא תקין' });
  const { rows } = await q(
    `INSERT INTO bk_accounts (tenant_id, code, name_he, type) VALUES ($1,$2,$3,$4)
     ON CONFLICT (tenant_id, code) DO NOTHING RETURNING id, code, name_he, type`,
    [req.tenant.id, code, String(name_he).trim(), type]);
  if (!rows[0]) return res.status(409).json({ error: 'קוד חשבון כבר קיים' });
  await audit(req, 'bk_account_create', 'bk_account', rows[0].id, { code });
  res.status(201).json({ account: rows[0] });
});

// --- כרטיסי לקוחות/ספקים ---
r.get('/bookkeeping/parties', async (req, res) => {
  const kind = req.query.kind;
  if (kind && !['customer','supplier'].includes(kind)) return res.status(400).json({ error: 'kind לא תקין' });
  const { rows } = await q(
    `SELECT id, kind, name, tax_id, email, phone, address, active FROM bk_parties
     WHERE tenant_id=$1 ${kind ? 'AND kind=$2' : ''} ORDER BY name`,
    kind ? [req.tenant.id, kind] : [req.tenant.id]);
  res.json({ parties: rows });
});

r.post('/bookkeeping/parties', async (req, res) => {
  const { kind, name, tax_id, email, phone, address, notes } = req.body || {};
  if (!['customer','supplier'].includes(kind)) return res.status(400).json({ error: 'סוג כרטיס לא תקין (customer/supplier)' });
  if (!name || String(name).trim().length < 2 || String(name).length > 100) return res.status(400).json({ error: 'שם כרטיס חסר או לא תקין' });
  if (tax_id && !/^[0-9]{5,9}$/.test(String(tax_id))) return res.status(400).json({ error: 'מספר עוסק/ח.פ לא תקין' });
  const { rows } = await q(
    `INSERT INTO bk_parties (tenant_id, kind, name, tax_id, email, phone, address, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, kind, name, tax_id`,
    [req.tenant.id, kind, String(name).trim(), tax_id || null, email || null, phone || null, address || null, notes || null]);
  await audit(req, 'bk_party_create', 'bk_party', rows[0].id, { kind, name: rows[0].name });
  res.status(201).json({ party: rows[0] });
});

// --- עזר: תקופה סגורה? ---
async function periodClosed(tid, dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const { rows } = await q(
    `SELECT 1 FROM bk_periods WHERE tenant_id=$1 AND year=$2 AND month=$3`,
    [tid, d.getUTCFullYear(), d.getUTCMonth() + 1]);
  return !!rows[0];
}

// --- פקודות יומן ---
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

r.get('/bookkeeping/entries', async (req, res) => {
  let { from, to } = req.query || {};
  if (from && !DATE_RE.test(from)) return res.status(400).json({ error: 'תאריך from לא תקין' });
  if (to && !DATE_RE.test(to)) return res.status(400).json({ error: 'תאריך to לא תקין' });
  const { rows } = await q(
    `SELECT e.id, e.entry_no, e.entry_date, e.description, e.source, e.reversal_of, e.created_at,
            json_agg(json_build_object('account_code', a.code, 'account_name', a.name_he,
              'party_name', p.name, 'debit', l.debit, 'credit', l.credit, 'details', l.details)
              ORDER BY (l.debit > 0) DESC, l.id) AS lines
     FROM bk_entries e
     JOIN bk_lines l ON l.entry_id = e.id
     JOIN bk_accounts a ON a.id = l.account_id
     LEFT JOIN bk_parties p ON p.id = l.party_id
     WHERE e.tenant_id=$1
       ${from ? 'AND e.entry_date >= $2' : ''} ${to ? `AND e.entry_date <= $${from ? 3 : 2}` : ''}
     GROUP BY e.id ORDER BY e.entry_no DESC LIMIT 500`,
    [req.tenant.id, ...(from ? [from] : []), ...(to ? [to] : [])]);
  res.json({ entries: rows });
});

r.post('/bookkeeping/entries', async (req, res) => {
  const tid = req.tenant.id;
  const { entry_date, description, lines, source } = req.body || {};
  if (!entry_date || !DATE_RE.test(entry_date)) return res.status(400).json({ error: 'תאריך לא תקין (YYYY-MM-DD)' });
  if (!description || String(description).trim().length < 2) return res.status(400).json({ error: 'תיאור פקודה חסר' });
  if (!Array.isArray(lines) || lines.length < 2 || lines.length > 50) return res.status(400).json({ error: 'פקודה דורשת לפחות 2 שורות (עד 50)' });
  const src = source || 'manual';
  if (!['manual','expense','bank'].includes(src)) return res.status(400).json({ error: 'source לא תקין' });
  if (await periodClosed(tid, entry_date)) return res.status(409).json({ error: 'התקופה סגורה — לא ניתן לרשום פקודה' });

  // ולידציית שורות + איזון
  let sumD = 0, sumC = 0;
  const clean = [];
  for (const l of lines) {
    const debit = Number(l.debit || 0), credit = Number(l.credit || 0);
    if (isNaN(debit) || isNaN(credit) || debit < 0 || credit < 0) return res.status(400).json({ error: 'סכום לא תקין בשורה' });
    if ((debit > 0) === (credit > 0)) return res.status(400).json({ error: 'כל שורה חייבת להיות חובה או זכות בלבד' });
    if (!/^[0-9]{4}$/.test(String(l.account_code || ''))) return res.status(400).json({ error: 'קוד חשבון לא תקין בשורה' });
    sumD += debit; sumC += credit;
    clean.push({ code: String(l.account_code), debit, credit, details: l.details || null, party_id: l.party_id || null });
  }
  if (Math.abs(sumD - sumC) > 0.004 || sumD <= 0) {
    return res.status(400).json({ error: `פקודה לא מאוזנת: חובה ${sumD.toFixed(2)} מול זכות ${sumC.toFixed(2)}` });
  }

  // כל החשבונות קיימים, פעילים, ושייכים לטננט
  const codes = [...new Set(clean.map(c => c.code))];
  const { rows: accts } = await q(
    `SELECT id, code FROM bk_accounts WHERE tenant_id=$1 AND active AND code = ANY($2)`,
    [tid, codes]);
  const byCode = Object.fromEntries(accts.map(a => [a.code, a.id]));
  const missing = codes.filter(c => !byCode[c]);
  if (missing.length) return res.status(400).json({ error: `חשבונות לא קיימים או לא פעילים: ${missing.join(', ')}` });

  // פרטיות מקושרות (אם נשלחו) שייכות לטננט
  const partyIds = [...new Set(clean.map(c => c.party_id).filter(Boolean))];
  if (partyIds.length) {
    const { rows: pr } = await q(`SELECT id FROM bk_parties WHERE tenant_id=$1 AND id = ANY($2)`, [tid, partyIds]);
    if (pr.length !== partyIds.length) return res.status(400).json({ error: 'כרטיס לקוח/ספק לא שייך למכבסה' });
  }

  // הכנסה בטרנזקציה אחת עם מספור רציף לטננט
  const client = await require('../db').pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: n } = await client.query(
      `INSERT INTO bk_entries (tenant_id, entry_no, entry_date, description, source, created_by)
       SELECT $1, COALESCE((SELECT max(entry_no) FROM bk_entries WHERE tenant_id=$1), 0) + 1, $2, $3, $4, $5
       RETURNING id, entry_no`,
      [tid, entry_date, String(description).trim(), src, req.user.id]);
    const eid = n[0].id;
    for (const c of clean) {
      await client.query(
        `INSERT INTO bk_lines (tenant_id, entry_id, account_id, party_id, debit, credit, details)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [tid, eid, byCode[c.code], c.party_id, c.debit, c.credit, c.details]);
    }
    await client.query('COMMIT');
    await audit(req, 'bk_entry_create', 'bk_entry', eid, { entry_no: n[0].entry_no, total: sumD.toFixed(2) });
    res.status(201).json({ entry: { id: eid, entry_no: n[0].entry_no, total: sumD.toFixed(2) } });
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally { client.release(); }
});

// --- סטורנו: תיקון רק בפקודת היפוכה (אין מחיקה/עריכה של פקודות) ---
r.post('/bookkeeping/entries/:id/reverse', async (req, res) => {
  const tid = req.tenant.id;
  const { rows: orig } = await q(
    `SELECT e.id, e.entry_no, e.entry_date, e.description FROM bk_entries e
     WHERE e.id=$1 AND e.tenant_id=$2`, [req.params.id, tid]);
  if (!orig[0]) return res.status(404).json({ error: 'פקודה לא נמצאה' });
  const todayIL = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' })).toISOString().slice(0, 10);
  if (await periodClosed(tid, todayIL)) return res.status(409).json({ error: 'התקופה הנוכחית סגורה — לא ניתן לבצע סטורנו' });
  const { rows: dup } = await q(`SELECT 1 FROM bk_entries WHERE reversal_of=$1`, [orig[0].id]);
  if (dup[0]) return res.status(409).json({ error: 'לפקודה זו כבר בוצע סטורנו' });
  const { rows: lines } = await q(
    `SELECT account_id, party_id, debit, credit, details FROM bk_lines WHERE entry_id=$1`, [orig[0].id]);

  const client = await require('../db').pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: n } = await client.query(
      `INSERT INTO bk_entries (tenant_id, entry_no, entry_date, description, source, reversal_of, created_by)
       SELECT $1, COALESCE((SELECT max(entry_no) FROM bk_entries WHERE tenant_id=$1), 0) + 1, $2, $3, 'reversal', $4, $5
       RETURNING id, entry_no`,
      [tid, todayIL, `סטורנו לפקודה ${orig[0].entry_no}: ${orig[0].description}`, orig[0].id, req.user.id]);
    for (const l of lines) {
      await client.query(
        `INSERT INTO bk_lines (tenant_id, entry_id, account_id, party_id, debit, credit, details)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [tid, n[0].id, l.account_id, l.party_id, l.credit, l.debit, l.details]); // הפיכת חובה/זכות
    }
    await client.query('COMMIT');
    await audit(req, 'bk_entry_reverse', 'bk_entry', n[0].id, { reversed: orig[0].entry_no });
    res.status(201).json({ reversal: { id: n[0].id, entry_no: n[0].entry_no }, reversed_entry_no: orig[0].entry_no });
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally { client.release(); }
});

// --- מאזן בוחן ---
r.get('/bookkeeping/trial-balance', async (req, res) => {
  let { from, to } = req.query || {};
  if (from && !DATE_RE.test(from)) return res.status(400).json({ error: 'תאריך from לא תקין' });
  if (to && !DATE_RE.test(to)) return res.status(400).json({ error: 'תאריך to לא תקין' });
  const { rows } = await q(
    `SELECT a.code, a.name_he, a.type,
            COALESCE(sum(l.debit),0)::numeric(12,2) AS debit,
            COALESCE(sum(l.credit),0)::numeric(12,2) AS credit
     FROM bk_accounts a
     LEFT JOIN bk_lines l ON l.account_id = a.id AND l.tenant_id = a.tenant_id
     LEFT JOIN bk_entries e ON e.id = l.entry_id
     WHERE a.tenant_id=$1 AND a.active
       ${from ? 'AND (e.entry_date >= $2 OR e.id IS NULL)' : ''}
       ${to ? `AND (e.entry_date <= $${from ? 3 : 2} OR e.id IS NULL)` : ''}
     GROUP BY a.id ORDER BY a.code`,
    [req.tenant.id, ...(from ? [from] : []), ...(to ? [to] : [])]);
  const totals = rows.reduce((t, x) => ({ d: t.d + Number(x.debit), c: t.c + Number(x.credit) }), { d: 0, c: 0 });
  res.json({ accounts: rows, totals: { debit: totals.d.toFixed(2), credit: totals.c.toFixed(2), balanced: Math.abs(totals.d - totals.c) < 0.005 } });
});

// --- סגירת תקופה ---
r.post('/bookkeeping/periods/close', async (req, res) => {
  const { year, month } = req.body || {};
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return res.status(400).json({ error: 'שנה/חודש לא תקינים' });
  }
  const { rows } = await q(
    `INSERT INTO bk_periods (tenant_id, year, month, closed_by) VALUES ($1,$2,$3,$4)
     ON CONFLICT (tenant_id, year, month) DO NOTHING RETURNING closed_at`,
    [req.tenant.id, year, month, req.user.id]);
  if (!rows[0]) return res.status(409).json({ error: 'התקופה כבר סגורה' });
  await audit(req, 'bk_period_close', 'tenant', req.tenant.id, { year, month });
  res.status(201).json({ closed: { year, month, closed_at: rows[0].closed_at } });
});

r.get('/bookkeeping/periods', async (req, res) => {
  const { rows } = await q(
    `SELECT year, month, closed_at FROM bk_periods WHERE tenant_id=$1 ORDER BY year DESC, month DESC`,
    [req.tenant.id]);
  res.json({ closed_periods: rows });
});

module.exports = r;
