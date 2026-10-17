// הנהלת חשבונות אמיתית (לא דמו) — ספר תנועות כפול, כרטיסים, סגירת תקופה.
// הרשאות קשיחות: בעלים בלבד (tenant_members.role='owner'), יומן ביקורת על כל שינוי.
// גבולות: בלי הגשה לרשות המסים, בלי מספרי הקצאה, בלי תשלומים, בלי שליחה החוצה.
const express = require('express');
const { q } = require('../db');
const { requireAuth } = require('../auth');
const { requireTenantOwner } = require('../authz'); // תשתית משותפת (מפתח C): בעלים/אדמין בלבד
const { audit } = require('../audit');
const { encryptField, maskField } = require('../fieldcrypto'); // הצפנת שדות רגישים (מספרי עוסק)
const multer = require('multer');
const { fileFilter, verifyFile, IMAGES } = require('../uploads');

const r = express.Router({ mergeParams: true });
r.use(requireAuth, requireTenantOwner, loadTenant, requireBookOwner);

// טעינת הטננט ל-req.tenant אחרי בדיקת ההרשאה המשותפת
async function loadTenant(req, res, next) {
  const { rows } = await q('SELECT * FROM tenants WHERE slug=$1', [req.params.slug]);
  if (!rows[0]) return res.status(404).json({ error: 'מכבסה לא נמצאה' });
  req.tenant = rows[0];
  next();
}

// T66: no platform-admin override for private books. Actual owner membership is required.
async function requireBookOwner(req, res, next) {
  const { rows } = await q("SELECT 1 FROM tenant_members WHERE tenant_id=$1 AND user_id=$2 AND role='owner'", [req.tenant.id, req.user.id]);
  if (!rows[0]) return res.status(403).json({ error: 'ספרי הנהלת חשבונות זמינים לבעל המכבסה בלבד' });
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
  // מספר עוסק מוצפן במסד — מוצג מוסתר בלבד
  res.json({ parties: rows.map(x => ({ ...x, tax_id: maskField(x.tax_id) })) });
});

r.post('/bookkeeping/parties', async (req, res) => {
  const { kind, name, tax_id, email, phone, address, notes } = req.body || {};
  if (!['customer','supplier'].includes(kind)) return res.status(400).json({ error: 'סוג כרטיס לא תקין (customer/supplier)' });
  if (!name || String(name).trim().length < 2 || String(name).length > 100) return res.status(400).json({ error: 'שם כרטיס חסר או לא תקין' });
  if (tax_id && !/^[0-9]{5,9}$/.test(String(tax_id))) return res.status(400).json({ error: 'מספר עוסק/ח.פ לא תקין' });
  const { rows } = await q(
    `INSERT INTO bk_parties (tenant_id, kind, name, tax_id, email, phone, address, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, kind, name, tax_id`,
    [req.tenant.id, kind, String(name).trim(), tax_id ? encryptField(String(tax_id)) : null, email || null, phone || null, address || null, notes || null]);
  await audit(req, 'bk_party_create', 'bk_party', rows[0].id, { kind, name: rows[0].name });
  res.status(201).json({ party: { ...rows[0], tax_id: maskField(rows[0].tax_id) } });
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
    `SELECT e.id, e.entry_no, e.entry_date, e.description, e.source FROM bk_entries e
     WHERE e.id=$1 AND e.tenant_id=$2`, [req.params.id, tid]);
  if (!orig[0]) return res.status(404).json({ error: 'פקודה לא נמצאה' });
  // T42: bypassing the originating workflow would leave an issued/posted object inconsistent.
  if (['invoice', 'expense', 'bank'].includes(orig[0].source)) {
    return res.status(409).json({ error: 'פקודה מקושרת למסמך, הוצאה או בנק. יש להשתמש בזיכוי/ביטול דרך רשומת המקור', code: 'USE_SOURCE_REVERSAL' });
  }
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
async function detailedTrial(tid, from, to) {
  const { rows } = await q(`SELECT a.code,a.name_he,a.type,
    COALESCE(sum(l.debit-l.credit) FILTER (WHERE e.entry_date < $2),0)::numeric(14,2) AS opening_balance,
    COALESCE(sum(l.debit) FILTER (WHERE e.entry_date BETWEEN $2 AND $3),0)::numeric(14,2) AS debit,
    COALESCE(sum(l.credit) FILTER (WHERE e.entry_date BETWEEN $2 AND $3),0)::numeric(14,2) AS credit
    FROM bk_accounts a LEFT JOIN bk_lines l ON l.account_id=a.id AND l.tenant_id=a.tenant_id
    LEFT JOIN bk_entries e ON e.id=l.entry_id AND e.tenant_id=l.tenant_id
    WHERE a.tenant_id=$1 GROUP BY a.id ORDER BY a.code`,[tid,from,to]);
  return rows.map(r=>({...r, closing_balance:(Number(r.opening_balance)+Number(r.debit)-Number(r.credit)).toFixed(2)}));
}
r.get('/bookkeeping/trial-balance', async (req,res)=>{
  const p=dateRange(req);if(p.error)return res.status(400).json({error:p.error});
  // Legacy no-range caller expects full-book movement, not current-year movement.
  const from=req.query.from || '0001-01-01';
  const accounts=await detailedTrial(req.tenant.id,from,p.to);
  const sum=key=>accounts.reduce((v,a)=>v+Number(a[key]),0);
  const d=sum('debit'),c=sum('credit');
  res.json({from,to:p.to,accounts,totals:{debit:d.toFixed(2),credit:c.toFixed(2),opening_balance:sum('opening_balance').toFixed(2),closing_balance:sum('closing_balance').toFixed(2),balanced:Math.abs(d-c)<0.005 && Math.abs(sum('closing_balance'))<0.005}});
});
r.get('/bookkeeping/reports/balance-sheet',async(req,res)=>{
  const p=dateRange(req);if(p.error)return res.status(400).json({error:p.error});
  const accounts=await detailedTrial(req.tenant.id,'0001-01-01',p.to);
  const select=type=>accounts.filter(a=>a.type===type).map(a=>({...a,balance:(Number(a.closing_balance)*(type==='asset'?1:-1)).toFixed(2)}));
  const assets=select('asset'),liabilities=select('liability'),equity=select('equity');
  const total=rs=>rs.reduce((v,a)=>v+Number(a.balance),0);
  const retained=accounts.filter(a=>['income','expense'].includes(a.type)).reduce((v,a)=>v-Number(a.closing_balance),0);
  res.json({as_of:p.to,assets,liabilities,equity,accumulated_profit:retained.toFixed(2),totals:{assets:total(assets).toFixed(2),liabilities:total(liabilities).toFixed(2),equity:(total(equity)+retained).toFixed(2),balanced:Math.abs(total(assets)-total(liabilities)-total(equity)-retained)<0.005}});
});

// T47/T69: account and party ledgers. Debit-positive running balance; supplier aging is credit-positive.
async function ledgerResponse(req,res,party) {
  const p=dateRange(req);if(p.error)return res.status(400).json({error:p.error});
  const tid=req.tenant.id;
  const {rows:[entity]}=await q(party?'SELECT id,kind,name FROM bk_parties WHERE id::text=$1 AND tenant_id=$2':'SELECT id,code,name_he,type FROM bk_accounts WHERE code=$1 AND tenant_id=$2',[party?req.params.id:req.params.code,tid]);
  if(!entity)return res.status(404).json({error:party?'כרטיס לא נמצא':'חשבון לא נמצא'});
  const {rows}=await q(`SELECT l.id,e.id AS entry_id,e.entry_no,e.entry_date,e.description,e.source,l.debit,l.credit,a.code AS account_code
    FROM bk_lines l JOIN bk_entries e ON e.id=l.entry_id AND e.tenant_id=l.tenant_id
    JOIN bk_accounts a ON a.id=l.account_id AND a.tenant_id=l.tenant_id
    WHERE l.tenant_id=$1 AND ${party?"l.party_id=$2 AND a.code IN ('1020','2000')":"l.account_id=$2"} AND e.entry_date <= $3
    ORDER BY e.entry_date,e.entry_no,l.id`,[tid,entity.id,p.to]);
  let balance=0,opening=0;const movements=[];
  for(const l of rows){balance+=Number(l.debit)-Number(l.credit);if(l.entry_date.toISOString().slice(0,10)<p.from){opening=balance;}else movements.push({...l,running_balance:balance.toFixed(2)});}
  const out={from:p.from,to:p.to,opening_balance:opening.toFixed(2),closing_balance:balance.toFixed(2),movements};
  if(party){
    // FIFO netting of credits against oldest charges, explicitly aged by posting date (no due-date data).
    const sign=entity.kind==='supplier'?-1:1;let credits=0;const charges=[];
    for(const l of rows){const delta=(Number(l.debit)-Number(l.credit))*sign;if(delta>0)charges.push({date:l.entry_date,amount:delta});else credits-=delta;}
    const buckets={'0_30':0,'31_60':0,'61_90':0,'over_90':0};
    for(const charge of charges){const applied=Math.min(credits,charge.amount);credits-=applied;const unpaid=charge.amount-applied;const days=Math.floor((Date.parse(p.to+'T00:00:00Z')-new Date(charge.date).getTime())/86400000);const key=days<=30?'0_30':days<=60?'31_60':days<=90?'61_90':'over_90';buckets[key]+=unpaid;}
    out.party=entity;out.aging={as_of:p.to,basis:'posting_date_fifo',note:'גיול לפי תאריך רישום וזקיפת תשלומים לחוב הישן תחילה, לא לפי מועד פירעון',buckets:Object.fromEntries(Object.entries(buckets).map(([k,v])=>[k,v.toFixed(2)])),unapplied_credit:credits.toFixed(2),balance:(balance*sign).toFixed(2)};
  }else out.account=entity;
  res.json(out);
}
r.get('/bookkeeping/parties/:id/ledger',(req,res)=>ledgerResponse(req,res,true));
r.get('/bookkeeping/accounts/:code/ledger',(req,res)=>ledgerResponse(req,res,false));

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

// --- 091: הוצאות וספקים עם צירוף קובץ חשבונית ספק (PDF/תמונה, אימות magic bytes) ---
const EXPENSE_FILES = ['application/pdf', ...IMAGES];
const expenseUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: fileFilter(EXPENSE_FILES),
});

async function getSupplier(tid, partyId) {
  const { rows } = await q(
    `SELECT id, name FROM bk_parties WHERE id=$1 AND tenant_id=$2 AND kind='supplier' AND active`,
    [partyId, tid]);
  return rows[0] || null;
}

async function getExpenseAccount(tid, code) {
  const { rows } = await q(
    `SELECT id, code, name_he FROM bk_accounts WHERE tenant_id=$1 AND code=$2 AND type='expense' AND active`,
    [tid, code]);
  return rows[0] || null;
}

// יצירת פקודה בתוך טרנזקציה פתוחה (client) — משמש גם רישום הוצאה וגם סטורנו שלה
async function insertEntryTx(client, tid, { date, description, source, lines, createdBy }) {
  const { rows: n } = await client.query(
    `INSERT INTO bk_entries (tenant_id, entry_no, entry_date, description, source, created_by)
     SELECT $1, COALESCE((SELECT max(entry_no) FROM bk_entries WHERE tenant_id=$1), 0) + 1, $2, $3, $4, $5
     RETURNING id, entry_no`,
    [tid, date, description, source, createdBy]);
  for (const l of lines) {
    await client.query(
      `INSERT INTO bk_lines (tenant_id, entry_id, account_id, party_id, debit, credit, details)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [tid, n[0].id, l.account_id, l.party_id || null, l.debit || 0, l.credit || 0, l.details || null]);
  }
  return n[0];
}

r.post('/bookkeeping/expenses', expenseUpload.single('invoice'), async (req, res) => {
  const tid = req.tenant.id;
  const { party_id, expense_date, description, account_code } = req.body || {};
  const amountNet = Number(req.body.amount_net), vat = Number(req.body.vat_amount || 0);
  if (!expense_date || !DATE_RE.test(expense_date)) return res.status(400).json({ error: 'תאריך לא תקין (YYYY-MM-DD)' });
  if (!description || String(description).trim().length < 2) return res.status(400).json({ error: 'תיאור הוצאה חסר' });
  if (!Number.isFinite(amountNet) || amountNet <= 0) return res.status(400).json({ error: 'סכום נטו חייב להיות חיובי' });
  if (!Number.isFinite(vat) || vat < 0) return res.status(400).json({ error: 'סכום מע"מ לא תקין' });
  if (vat > 0 && req.tenant.dealer_type !== 'morasha') {
    return res.status(400).json({ error: 'עוסק שאינו מורשה אינו מנכה מס תשומות — יש להזין מע"מ 0 ולכלול את מלוא הסכום בהוצאה' });
  }
  if (vat > vatCeiling(amountNet)) return res.status(400).json({ error: `תשומות: ${vatOverMsg(amountNet)}` });
  const party = await getSupplier(tid, party_id);
  if (!party) return res.status(400).json({ error: 'כרטיס ספק לא נמצא' });
  const acct = await getExpenseAccount(tid, String(account_code || ''));
  if (!acct) return res.status(400).json({ error: 'חשבון הוצאה לא קיים או לא פעיל' });
  if (req.file && !verifyFile(req.file, EXPENSE_FILES)) return res.status(400).json({ error: 'תוכן הקובץ לא תואם לסוג המדווח — מתקבלים PDF/JPG/PNG/WebP בלבד' });

  const { rows } = await q(
    `INSERT INTO bk_expenses (tenant_id, party_id, expense_date, description, account_code, amount_net, vat_amount,
                              file_name, file_mime, file_data, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING id, expense_date, status`,
    [tid, party.id, expense_date, String(description).trim(), acct.code, amountNet.toFixed(2), vat.toFixed(2),
     req.file ? req.file.originalname : null, req.file ? req.file.mimetype : null, req.file ? req.file.buffer : null, req.user.id]);
  await audit(req, 'bk_expense_create', 'bk_expense', rows[0].id, { supplier: party.name, total: (amountNet + vat).toFixed(2), has_file: !!req.file });
  res.status(201).json({ expense: { ...rows[0], has_file: !!req.file } });
});

r.get('/bookkeeping/expenses', async (req, res) => {
  let { from, to } = req.query || {};
  if (from && !DATE_RE.test(from)) return res.status(400).json({ error: 'תאריך from לא תקין' });
  if (to && !DATE_RE.test(to)) return res.status(400).json({ error: 'תאריך to לא תקין' });
  const { rows } = await q(
    `SELECT x.id, x.expense_date, x.description, x.account_code, a.name_he AS account_name,
            p.name AS supplier, x.amount_net, x.vat_amount, (x.amount_net + x.vat_amount) AS total,
            x.status, x.entry_id, (x.file_data IS NOT NULL) AS has_file, x.file_name, x.created_at
     FROM bk_expenses x
     JOIN bk_parties p ON p.id = x.party_id
     JOIN bk_accounts a ON a.tenant_id = x.tenant_id AND a.code = x.account_code
     WHERE x.tenant_id=$1 ${from ? 'AND x.expense_date >= $2' : ''} ${to ? `AND x.expense_date <= $${from ? 3 : 2}` : ''}
     ORDER BY x.expense_date DESC, x.created_at DESC LIMIT 500`,
    [req.tenant.id, ...(from ? [from] : []), ...(to ? [to] : [])]);
  res.json({ expenses: rows });
});

r.get('/bookkeeping/expenses/:id/file', async (req, res) => {
  const { rows } = await q(
    `SELECT file_name, file_mime, file_data FROM bk_expenses WHERE id=$1 AND tenant_id=$2`,
    [req.params.id, req.tenant.id]);
  if (!rows[0] || !rows[0].file_data) return res.status(404).json({ error: 'קובץ לא נמצא' });
  res.setHeader('Content-Type', rows[0].file_mime);
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(rows[0].file_name || 'invoice')}`);
  res.send(rows[0].file_data);
});

// רישום הוצאה לספר: חובה הוצאה (נטו) + חובה מע"מ תשומות (מורשה בלבד) / זכות ספקים (ברוטו)
r.post('/bookkeeping/expenses/:id/post', async (req, res) => {
  const tid = req.tenant.id;
  const { rows: xs } = await q(`SELECT * FROM bk_expenses WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
  const x = xs[0];
  if (!x) return res.status(404).json({ error: 'הוצאה לא נמצאה' });
  if (x.status !== 'draft') return res.status(409).json({ error: `לא ניתן לרשום הוצאה בסטטוס ${x.status}` });
  if (await periodClosed(tid, x.expense_date.toISOString().slice(0, 10))) return res.status(409).json({ error: 'התקופה סגורה — לא ניתן לרשום' });

  const expAcct = await getExpenseAccount(tid, x.account_code);
  const vatAcct = x.vat_amount > 0 ? await acctByCode(tid, '2020') : null;
  const supAcct = await acctByCode(tid, '2000');
  if (!expAcct || !supAcct || (x.vat_amount > 0 && !vatAcct)) return res.status(400).json({ error: 'חשבון חסר — יש לאתחל את תרשים החשבונות' });

  const client = await require('../db').pool.connect();
  try {
    await client.query('BEGIN');
    const lines = [
      { account_id: expAcct.id, party_id: x.party_id, debit: Number(x.amount_net), details: x.description },
    ];
    if (Number(x.vat_amount) > 0) lines.push({ account_id: vatAcct.id, party_id: x.party_id, debit: Number(x.vat_amount), details: 'מע"מ תשומות' });
    lines.push({ account_id: supAcct.id, party_id: x.party_id, credit: Number(x.amount_net) + Number(x.vat_amount), details: x.description });
    const e = await insertEntryTx(client, tid, {
      date: x.expense_date.toISOString().slice(0, 10), description: `הוצאה: ${x.description}`,
      source: 'expense', lines, createdBy: req.user.id,
    });
    await client.query(`UPDATE bk_expenses SET status='posted', entry_id=$1, updated_at=now() WHERE id=$2`, [e.id, x.id]);
    await client.query('COMMIT');
    await audit(req, 'bk_expense_post', 'bk_expense', x.id, { entry_no: e.entry_no });
    res.json({ posted: true, entry_no: e.entry_no });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally { client.release(); }
});

// ביטול הוצאה: מטיוטה — סימון בלבד; מרשומה — סטורנו בספר
r.post('/bookkeeping/expenses/:id/void', async (req, res) => {
  const tid = req.tenant.id;
  const { rows: xs } = await q(`SELECT * FROM bk_expenses WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
  const x = xs[0];
  if (!x) return res.status(404).json({ error: 'הוצאה לא נמצאה' });
  if (x.status === 'void') return res.status(409).json({ error: 'ההוצאה כבר מבוטלת' });
  if (x.status === 'draft') {
    await q(`UPDATE bk_expenses SET status='void', updated_at=now() WHERE id=$1`, [x.id]);
    await audit(req, 'bk_expense_void', 'bk_expense', x.id, { from: 'draft' });
    return res.json({ voided: true, from: 'draft' });
  }
  // posted — סטורנו: שורות הפוכות לפקודה המקורית
  const todayIL = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' })).toISOString().slice(0, 10);
  if (await periodClosed(tid, todayIL)) return res.status(409).json({ error: 'התקופה הנוכחית סגורה — לא ניתן לבטל' });
  const { rows: lines } = await q(`SELECT account_id, party_id, debit, credit, details FROM bk_lines WHERE entry_id=$1`, [x.entry_id]);
  const client = await require('../db').pool.connect();
  try {
    await client.query('BEGIN');
    const e = await insertEntryTx(client, tid, {
      date: todayIL, description: `ביטול הוצאה: ${x.description}`, source: 'reversal',
      lines: lines.map(l => ({ account_id: l.account_id, party_id: l.party_id, debit: Number(l.credit), credit: Number(l.debit), details: l.details })),
      createdBy: req.user.id,
    });
    await client.query(`UPDATE bk_expenses SET status='void', void_entry_id=$1, updated_at=now() WHERE id=$2`, [e.id, x.id]);
    await client.query('COMMIT');
    await audit(req, 'bk_expense_void', 'bk_expense', x.id, { from: 'posted', reversal_entry_no: e.entry_no });
    res.json({ voided: true, from: 'posted', reversal_entry_no: e.entry_no });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally { client.release(); }
});

// --- 092: מסמכי הכנסה. T44 replaces the original unconditional allocation gate. ---
const DOC_KINDS = {
  tax_invoice: { code: 305, he: 'חשבונית מס', needsAllocation: true, morashaOnly: true },
  tax_invoice_receipt: { code: 320, he: 'חשבונית מס/קבלה', needsAllocation: true, morashaOnly: true },
  invoice: { code: 300, he: 'חשבונית עסקה', needsAllocation: false, morashaOnly: false },
  receipt: { code: 400, he: 'קבלה', needsAllocation: false, morashaOnly: false },
  credit_note: { code: 330, he: 'חשבונית זיכוי', needsAllocation: false, morashaOnly: true },
};
const ALLOC_RE = /^[0-9]{9,10}$/; // 9 הספרות הימניות מודפסות על החשבונית; מזהה מלא עד 10

// T41: תקרת מע"מ חוקית (18% מ-1.1.2025) — חסימת שיעור שגוי מעל התקרה.
// מרווח אגורה לעיגול מטבע בלבד; מע"מ נמוך מהתקרה מותר (סל מעורב/פטור). חל על מסמכים ועל תשומות.
const VAT_RATE = 0.18;
const vatCeiling = (net) => Math.round(Number(net) * VAT_RATE * 100) / 100 + 0.01;
const vatOverMsg = (net) => `מע"מ מעל השיעור החוקי (${(VAT_RATE*100).toFixed(0)}%): עד ${(Number(net)*VAT_RATE).toFixed(2)} ₪ לנטו ${Number(net).toFixed(2)} ₪`;

// T44 owner decision 2026-10-17: replaces blanket allocation blocking.
// Official: https://www.gov.il/he/service/request-assignment-number-for-tax-invoice
// Net must be strictly above the date threshold AND customer explicitly registered morasha.
// Advisory only. Connector remains off; a manual number is never described as verified.
function allocationAdvice(d, date) {
  const day = date || new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jerusalem',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const threshold = day >= '2026-06-01' ? 5000 : day >= '2026-01-01' ? 10000 : day >= '2025-01-01' ? 20000 : null;
  const recommended = ['tax_invoice','tax_invoice_receipt'].includes(d.kind) && d.customer_dealer_type === 'morasha' && threshold !== null && Number(d.amount_net) > threshold;
  return { allocation_recommended: recommended, allocation_threshold: threshold,
    allocation_warning: recommended && !d.allocation_number ? 'מומלץ לבקש מספר הקצאה: סכום הנטו מעל התקרה והלקוח עוסק מורשה. מספר ידני אינו מאומת; ההנפקה אינה חסומה.' : null };
}

function docStatusHe(d) {
  if (d.status === 'issued') return 'הונפק';
  if (d.status === 'cancelled') return 'בוטל';
  return allocationAdvice(d).allocation_warning ? 'טיוטה — מומלץ מספר הקצאה' : 'טיוטה';
}

r.post('/bookkeeping/documents', async (req, res) => {
  const tid = req.tenant.id;
  let { kind, customer_name, party_id, customer_tax_id, amount_net, vat_amount, lines, notes, source_document_id, customer_dealer_type } = req.body || {};
  const K = DOC_KINDS[kind];
  if (customer_dealer_type != null && !['morasha','patur','private'].includes(customer_dealer_type)) return res.status(400).json({error:'סוג עוסק של הלקוח לא תקין'});
  if (!K) return res.status(400).json({ error: 'סוג מסמך לא תקין' });
  if (K.morashaOnly && req.tenant.dealer_type !== 'morasha') {
    return res.status(400).json({ error: `עוסק פטור אינו מפיק ${K.he} — מפיק חשבונית עסקה (300)` });
  }
  if (!customer_name || String(customer_name).trim().length < 2) return res.status(400).json({ error: 'שם לקוח חסר' });
  const net = Number(amount_net), vat = Number(vat_amount || 0);
  if (!Number.isFinite(net) || net <= 0) return res.status(400).json({ error: 'סכום נטו חייב להיות חיובי' });
  if (!Number.isFinite(vat) || vat < 0) return res.status(400).json({ error: 'סכום מע"מ לא תקין' });
  if (vat > 0 && req.tenant.dealer_type !== 'morasha') return res.status(400).json({ error: 'עוסק פטור אינו גובה מע"מ' });
  if (vat > vatCeiling(net)) return res.status(400).json({ error: vatOverMsg(net) });
  if (party_id) {
    const { rows: pr } = await q(`SELECT 1 FROM bk_parties WHERE id=$1 AND tenant_id=$2 AND kind='customer'`, [party_id, tid]);
    if (!pr[0]) return res.status(400).json({ error: 'כרטיס לקוח לא נמצא' });
  }
  if (source_document_id && !['receipt','credit_note'].includes(kind)) return res.status(400).json({ error: 'קישור מקור מיועד לקבלה או זיכוי בלבד' });
  if (kind === 'credit_note' && !source_document_id) return res.status(400).json({ error: 'חשבונית זיכוי דורשת מסמך מקור' });
  if (kind === 'receipt' && vat !== 0) return res.status(400).json({ error: 'בקבלה אין רכיב מע״מ נוסף; סכום התשלום הוא הסכום הכולל' });
  if (source_document_id) {
    const { rows: [src] } = await q('SELECT * FROM bk_documents WHERE id=$1 AND tenant_id=$2', [source_document_id, tid]);
    if (!src) return res.status(404).json({ error: 'מסמך מקור לא נמצא' });
    if (src.status !== 'issued' || !['invoice','tax_invoice', 'tax_invoice_receipt'].includes(src.kind)) return res.status(409).json({ error: 'מקור חייב להיות חשבונית מונפקת' });
    customer_dealer_type = src.customer_dealer_type; customer_name = src.customer_name; party_id = src.party_id; customer_tax_id = src.customer_tax_id ? safeDecryptField(src.customer_tax_id, 'customer_tax_id') : null;
    if (kind === 'receipt' && src.kind === 'tax_invoice_receipt') return res.status(409).json({ error: 'חשבונית מס/קבלה כבר כוללת תשלום' });
    if (kind === 'credit_note' && (Math.abs(net-Number(src.amount_net)) > 0.004 || Math.abs(vat-Number(src.vat_amount)) > 0.004)) return res.status(400).json({ error: 'בשלב זה נתמך זיכוי מלא בלבד, בסכומי מסמך המקור' });
  }
  let cleanLines = [];
  if (Array.isArray(lines) && lines.length) {
    if (lines.length > 100) return res.status(400).json({ error: 'יותר מדי שורות (עד 100)' });
    let sum = 0;
    for (const l of lines) {
      const qty = Number(l.quantity || 1), price = Number(l.unit_price), total = Number(l.total ?? qty * price);
      if (!l.description || isNaN(qty) || qty <= 0 || isNaN(price) || price < 0 || isNaN(total) || total < 0) {
        return res.status(400).json({ error: 'שורת מסמך לא תקינה' });
      }
      sum += total;
      cleanLines.push({ description: String(l.description).slice(0, 200), quantity: qty, unit_price: price, total });
    }
    if (Math.abs(sum - net) > 0.01) return res.status(400).json({ error: `סכום השורות (${sum.toFixed(2)}) לא תואם את סכום המסמך (${net.toFixed(2)})` });
  }
  const client = await require('../db').pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: d } = await client.query(
      `INSERT INTO bk_documents (tenant_id, party_id, customer_name, customer_tax_id, kind, amount_net, vat_amount, notes, created_by, source_document_id, customer_dealer_type)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id, kind, status, amount_net, customer_dealer_type`,
      [tid, party_id || null, String(customer_name).trim(), customer_tax_id ? encryptField(String(customer_tax_id)) : null,
       kind, net.toFixed(2), vat.toFixed(2), notes || null, req.user.id, source_document_id || null, customer_dealer_type || null]);
    if (kind === 'credit_note' && cleanLines.length === 0) {
      const { rows: originals } = await client.query('SELECT description,quantity,unit_price,total FROM bk_document_lines WHERE tenant_id=$1 AND document_id=$2',[tid,source_document_id]);
      cleanLines = originals;
    }
    for (const l of cleanLines) {
      await client.query(
        `INSERT INTO bk_document_lines (tenant_id, document_id, description, quantity, unit_price, total)
         VALUES ($1,$2,$3,$4,$5,$6)`, [tid, d[0].id, l.description, l.quantity, l.unit_price, l.total]);
    }
    await client.query('COMMIT');
    await audit(req, 'bk_doc_create', 'bk_document', d[0].id, { kind, source_document_id: source_document_id || null, total: (net + vat).toFixed(2) });
    res.status(201).json({ document: { ...d[0], status_he: docStatusHe(d[0]), ...allocationAdvice(d[0]) } });
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
});

r.get('/bookkeeping/documents', async (req, res) => {
  const { rows } = await q(
    `SELECT d.id, d.kind, d.doc_year, d.doc_number, d.issue_date, d.status, d.customer_name,
            d.amount_net, d.vat_amount, d.customer_dealer_type, d.source_document_id, d.entry_id, (d.amount_net + d.vat_amount) AS total,
            (SELECT COALESCE(sum(p.amount_net),0) FROM bk_documents p WHERE p.tenant_id=d.tenant_id AND p.source_document_id=d.id AND p.kind='receipt' AND p.status='issued') AS paid_amount,
            EXISTS(SELECT 1 FROM bk_documents c WHERE c.tenant_id=d.tenant_id AND c.source_document_id=d.id AND c.kind='credit_note' AND c.status='issued') AS fully_credited,
            d.allocation_number, CASE WHEN d.allocation_number IS NULL THEN 'not_provided' ELSE 'manual_unverified' END AS allocation_verification_status,
            (d.allocation_number IS NOT NULL) AS has_allocation, d.created_at,
            (SELECT count(*)::int FROM bk_document_lines l WHERE l.document_id = d.id) AS lines
     FROM bk_documents d WHERE d.tenant_id=$1 ORDER BY d.created_at DESC LIMIT 500`, [req.tenant.id]);
  res.json({ documents: rows.map(d => ({ ...d, kind_he: DOC_KINDS[d.kind].he, status_he: docStatusHe(d), ...allocationAdvice(d, d.issue_date ? d.issue_date.toISOString().slice(0,10) : undefined) })) });
});

// T14: same E12 PDF template, permanent demo mark, no public verification URL for bk records.
r.get('/bookkeeping/documents/:id/pdf',async(req,res)=>{
  const {rows:[d]}=await q('SELECT * FROM bk_documents WHERE id::text=$1 AND tenant_id=$2',[req.params.id,req.tenant.id]);
  if(!d)return res.status(404).json({error:'מסמך לא נמצא'});
  if(d.status!=='issued')return res.status(409).json({error:'ניתן להוריד מסמך מונפק בלבד'});
  const {rows:ls}=await q('SELECT description,quantity,unit_price FROM bk_document_lines WHERE document_id=$1 AND tenant_id=$2 ORDER BY id',[d.id,req.tenant.id]);
  let note='מסמך דמו בלבד. מספר הקצאה ידני אינו מאומת מול רשות המסים.';
  if(d.source_document_id){const {rows:[src]}=await q('SELECT kind,doc_year,doc_number FROM bk_documents WHERE id=$1 AND tenant_id=$2',[d.source_document_id,req.tenant.id]);if(src)note+=` מקור: ${DOC_KINDS[src.kind].he} ${src.doc_year}-${src.doc_number}`;}
  const {buildDocumentPDF,collectPdf}=require('../receipt');
  const pdf=buildDocumentPDF({doc:{...d,amount:d.amount_net,vat:d.vat_amount,total:Number(d.amount_net)+Number(d.vat_amount),issued_at:d.issue_date},tenant:req.tenant,customer:{name:d.customer_name},items:ls.map(l=>({name:l.description,qty:l.quantity,price:l.unit_price})),copy:true,note});
  const buf=await collectPdf(pdf);
  res.type('application/pdf').set('Content-Disposition',`attachment; filename="bookkeeping-${d.doc_year}-${d.doc_number}.pdf"`).send(buf);
});

// הזנת מספר הקצאה ידנית — הבעלים מעתיק מהאזור האישי ברשות (אין קריאה אוטומטית לרשות)
r.post('/bookkeeping/documents/:id/allocate', async (req, res) => {
  const num = String((req.body || {}).allocation_number || '').replace(/[^0-9]/g, '');
  if (!ALLOC_RE.test(num)) return res.status(400).json({ error: 'מספר הקצאה חייב להיות 9-10 ספרות' });
  const { rows } = await q(
    `UPDATE bk_documents SET allocation_number=$1, allocation_at=now(), updated_at=now()
     WHERE id=$2 AND tenant_id=$3 AND status='draft'
       AND kind IN ('tax_invoice','tax_invoice_receipt')
     RETURNING id, kind`,
    [num, req.params.id, req.tenant.id]);
  if (!rows[0]) return res.status(409).json({ error: 'מסמך לא נמצא, אינו טיוטה, או שאינו חשבונית מס' });
  await audit(req, 'bk_doc_allocate', 'bk_document', rows[0].id, {});
  res.json({ allocated: true });
});

// הנפקה: מספר סידורי רציף + פקודת יומן. T44: הקצאה היא אזהרה מותנית בלבד.
r.post('/bookkeeping/documents/:id/issue', async (req, res) => {
  const tid = req.tenant.id;
  const { rows: ds } = await q(`SELECT * FROM bk_documents WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
  const d = ds[0];
  if (!d) return res.status(404).json({ error: 'מסמך לא נמצא' });
  if (d.status !== 'draft') return res.status(409).json({ error: 'ניתן להנפיק טיוטה בלבד' });
  const K = DOC_KINDS[d.kind];
  const todayIL = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' })).toISOString().slice(0, 10);
  if (await periodClosed(tid, todayIL)) return res.status(409).json({ error: 'התקופה הנוכחית סגורה — לא ניתן להנפיק' });

  const income = await acctByCode(tid, '4000');
  const debitAcct = await acctByCode(tid, d.kind === 'tax_invoice_receipt' || d.kind === 'receipt' ? '1000' : '1020');
  const vatAcct = Number(d.vat_amount) > 0 ? await acctByCode(tid, '2010') : null;
  if (!income || !debitAcct || (Number(d.vat_amount) > 0 && !vatAcct)) return res.status(400).json({ error: 'חשבון חסר — יש לאתחל את תרשים החשבונות' });
  const total = Number(d.amount_net) + Number(d.vat_amount);

  const lines = [
    { account_id: debitAcct.id, party_id: d.party_id, debit: total, details: K.he + ' - ' + d.customer_name },
    { account_id: d.kind === 'receipt' && d.source_document_id ? (await acctByCode(tid,'1020')).id : income.id, party_id: d.party_id, credit: Number(d.amount_net), details: K.he },
  ];
  if (Number(d.vat_amount)>0) lines.push({account_id:vatAcct.id,party_id:d.party_id,credit:Number(d.vat_amount),details:'מע״מ עסקאות'});
  const client = await require('../db').pool.connect();
  try {
    await client.query('BEGIN');
    // Serialize issuance per tenant, then lock/revalidate the draft and source.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [tid]);
    const { rows: [locked] } = await client.query('SELECT status FROM bk_documents WHERE id=$1 AND tenant_id=$2 FOR UPDATE', [d.id, tid]);
    if (!locked || locked.status !== 'draft') { await client.query('ROLLBACK'); return res.status(409).json({ error: 'המסמך כבר הונפק או בוטל' }); }
    if (d.source_document_id) {
      const { rows: [src] } = await client.query('SELECT * FROM bk_documents WHERE id=$1 AND tenant_id=$2 FOR UPDATE', [d.source_document_id,tid]);
      if (!src || src.status !== 'issued') { await client.query('ROLLBACK'); return res.status(409).json({ error: 'מסמך מקור אינו מונפק' }); }
      const { rows: [paid] } = await client.query("SELECT COALESCE(sum(amount_net),0) AS paid, count(*) FILTER (WHERE kind='credit_note') AS credits FROM bk_documents WHERE tenant_id=$1 AND source_document_id=$2 AND status='issued'",[tid,src.id]);
      if (Number(paid.credits)>0 || (d.kind==='receipt' && Number(paid.paid)+total > Number(src.amount_net)+Number(src.vat_amount)+0.004)) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'המקור זוכה או שהתשלום עולה על יתרת החשבונית' }); }
      if (d.kind==='credit_note') {
        const { rows: originalLines } = await client.query('SELECT account_id,party_id,debit,credit,details FROM bk_lines WHERE entry_id=$1 AND tenant_id=$2',[src.entry_id,tid]);
        if (!originalLines.length) throw new Error('Source ledger entry missing');
        lines.splice(0,lines.length,...originalLines.map(l=>({account_id:l.account_id,party_id:l.party_id,debit:Number(l.credit),credit:Number(l.debit),details:'זיכוי: '+l.details})));
      }
    }
    const year = Number(todayIL.slice(0, 4));
    await client.query(
      `INSERT INTO bk_doc_counters (tenant_id, kind, year, next_number) VALUES ($1,$2,$3,1) ON CONFLICT DO NOTHING`,
      [tid, d.kind, year]);
    const { rows: cn } = await client.query(
      `UPDATE bk_doc_counters SET next_number = next_number + 1 WHERE tenant_id=$1 AND kind=$2 AND year=$3 RETURNING next_number`,
      [tid, d.kind, year]);
    const docNumber = cn[0].next_number - 1;

    const e = await insertEntryTx(client, tid, {
      date: todayIL, description: `${K.he} מס׳ ${docNumber} ל${d.customer_name}`, source: 'invoice', lines, createdBy: req.user.id,
    });
    await client.query(
      `UPDATE bk_documents SET status='issued', doc_year=$1, doc_number=$2, issue_date=$3, entry_id=$4, updated_at=now() WHERE id=$5`,
      [year, docNumber, todayIL, e.id, d.id]);
    await client.query('COMMIT');
    await audit(req, 'bk_doc_issue', 'bk_document', d.id, { kind: d.kind, source_document_id: d.source_document_id, doc_number: docNumber, total: total.toFixed(2) });
    res.json({ issued: true, doc_year: year, doc_number: docNumber, entry_no: e.entry_no, ...allocationAdvice(d, todayIL) });
  } catch (err) { await client.query('ROLLBACK'); throw err; } finally { client.release(); }
});

// ביטול טיוטה בלבד (ביטול מסמך מונפק = חשבונית זיכוי, בהמשך)
r.post('/bookkeeping/documents/:id/cancel', async (req, res) => {
  const { rows } = await q(
    `UPDATE bk_documents SET status='cancelled', updated_at=now() WHERE id=$1 AND tenant_id=$2 AND status='draft' RETURNING id`,
    [req.params.id, req.tenant.id]);
  if (!rows[0]) return res.status(409).json({ error: 'ניתן לבטל טיוטה בלבד — מסמך מונפק מבטלים בחשבונית זיכוי' });
  await audit(req, 'bk_doc_cancel', 'bk_document', rows[0].id, {});
  res.json({ cancelled: true });
});

// --- 093: ייבוא CSV בנק + התאמת בנק ---
const bankUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => cb(null, true), // CSV טקסטואלי — הולידציה בפועל בפרסינג
});

// פרסר CSV פשוט עם גרשיים; עמודות לפי כותרות עבריות/אנגליות נפוצות בבנקים בישראל
function parseBankCsv(buf) {
  const text = buf.toString('utf8').replace(/^\uFEFF/, '');
  const rows = [];
  let cur = [''], inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { cur[cur.length - 1] += '"'; i++; } else inQ = false; }
      else cur[cur.length - 1] += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') cur.push('');
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      if (cur.length > 1 || cur[0] !== '') { rows.push(cur); cur = ['']; }
    } else cur[cur.length - 1] += c;
  }
  if (cur.length > 1 || cur[0] !== '') rows.push(cur);
  if (!rows.length) return { error: 'קובץ ריק' };
  const head = rows[0].map(h => h.trim().toLowerCase());
  const col = (names) => head.findIndex(h => names.some(n => h.includes(n)));
  const cDate = col(['תאריך', 'date']), cDesc = col(['תיאור', 'desc', 'פרטים']);
  const cRef = col(['אסמכתא', 'ref']);
  const cDebit = col(['חובה', 'debit', 'משולם']), cCredit = col(['זכות', 'credit', 'התקבל']);
  const cBal = col(['יתרה', 'balance']);
  if (cDate < 0 || (cDebit < 0 && cCredit < 0)) {
    return { error: 'כותרות לא מזוהות — נדרשים לפחות תאריך וחובה/זכות' };
  }
  const num = (v) => {
    const n = Number(String(v || '').replace(/[₪,\s]/g, ''));
    return isNaN(n) ? null : n;
  };
  const out = [], skipped = [];
  for (const row of rows.slice(1)) {
    const rawDate = (row[cDate] || '').trim();
    const m = rawDate.match(/^(\d{2})[/.](\d{2})[/.](\d{4})$/) || rawDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    let iso = null;
    if (m) iso = m[1].length === 4 ? rawDate : `${m[3]}-${m[2]}-${m[1]}`;
    const debit = cDebit >= 0 ? num(row[cDebit]) : null;
    const credit = cCredit >= 0 ? num(row[cCredit]) : null;
    const amount = credit ? credit : debit ? -debit : null;
    if (!iso || amount === null) { skipped.push(row.join(',')); continue; }
    out.push({
      date: iso, description: cDesc >= 0 ? row[cDesc].trim() : null,
      reference: cRef >= 0 ? row[cRef].trim() : null,
      amount, balance: cBal >= 0 ? num(row[cBal]) : null,
    });
  }
  return { txs: out, skipped };
}

r.post('/bookkeeping/bank/import', bankUpload.single('statement'), async (req, res) => {
  if (!req.file || !req.file.buffer.length) return res.status(400).json({ error: 'נדרש קובץ CSV של תנועות הבנק' });
  const parsed = parseBankCsv(req.file.buffer);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  if (!parsed.txs.length) return res.status(400).json({ error: 'לא זוהתה אף תנועה תקינה בקובץ' });
  const tid = req.tenant.id;
  const client = await require('../db').pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: imp } = await client.query(
      `INSERT INTO bk_bank_imports (tenant_id, file_name, rows_count, skipped_count, imported_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [tid, req.file.originalname || 'statement.csv', parsed.txs.length, parsed.skipped.length, req.user.id]);
    for (const t of parsed.txs) {
      await client.query(
        `INSERT INTO bk_bank_txs (tenant_id, import_id, tx_date, description, reference, amount, balance_after)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [tid, imp[0].id, t.date, t.description, t.reference, t.amount, t.balance]);
    }
    await client.query('COMMIT');
    await audit(req, 'bk_bank_import', 'bk_bank_import', imp[0].id, { rows: parsed.txs.length, skipped: parsed.skipped.length });
    res.status(201).json({ import_id: imp[0].id, rows: parsed.txs.length, skipped: parsed.skipped.length });
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
});

r.get('/bookkeeping/bank/transactions', async (req, res) => {
  const status = req.query.status;
  if (status && !['unmatched','matched','booked','ignored'].includes(status)) return res.status(400).json({ error: 'status לא תקין' });
  const { rows } = await q(
    `SELECT id, tx_date, description, reference, amount, balance_after, status, matched_line_id, booked_entry_id
     FROM bk_bank_txs WHERE tenant_id=$1 ${status ? 'AND status=$2' : ''}
     ORDER BY tx_date DESC, created_at DESC LIMIT 500`,
    status ? [req.tenant.id, status] : [req.tenant.id]);
  res.json({ transactions: rows });
});

// התאמה לשורת ספר קיימת בחשבון הבנק (1010) באותו סכום וצד
r.post('/bookkeeping/bank/transactions/:id/match', async (req, res) => {
  const tid = req.tenant.id;
  const { line_id } = req.body || {};
  const { rows: txs } = await q(`SELECT * FROM bk_bank_txs WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
  const tx = txs[0];
  if (!tx) return res.status(404).json({ error: 'תנועה לא נמצאה' });
  if (tx.status !== 'unmatched') return res.status(409).json({ error: 'ניתן להתאים תנועה שלא שויכה בלבד' });
  const { rows: ls } = await q(
    `SELECT l.id, l.debit, l.credit FROM bk_lines l
     JOIN bk_accounts a ON a.id = l.account_id
     WHERE l.id=$1 AND l.tenant_id=$2 AND a.code='1010'`, [line_id, tid]);
  const line = ls[0];
  if (!line) return res.status(400).json({ error: 'שורת ספר לא נמצאה בחשבון הבנק (1010)' });
  const lineAmt = Number(line.debit) > 0 ? Number(line.debit) : -Number(line.credit);
  if (Math.abs(lineAmt - Number(tx.amount)) > 0.004) {
    return res.status(400).json({ error: `סכום לא תואם: בבנק ${Number(tx.amount).toFixed(2)} מול ${lineAmt.toFixed(2)} בספר` });
  }
  const { rows: dup } = await q(`SELECT 1 FROM bk_bank_txs WHERE matched_line_id=$1 AND id<>$2`, [line_id, tx.id]);
  if (dup[0]) return res.status(409).json({ error: 'שורת הספר כבר שויכה לתנועה אחרת' });
  await q(`UPDATE bk_bank_txs SET status='matched', matched_line_id=$1 WHERE id=$2`, [line_id, tx.id]);
  await audit(req, 'bk_bank_match', 'bk_bank_tx', tx.id, { line_id });
  res.json({ matched: true });
});

// רישום תנועת בנק לספר: בחירת חשבון נגדי
r.post('/bookkeeping/bank/transactions/:id/book', async (req, res) => {
  const tid = req.tenant.id;
  const { account_code, description } = req.body || {};
  const { rows: txs } = await q(`SELECT * FROM bk_bank_txs WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
  const tx = txs[0];
  if (!tx) return res.status(404).json({ error: 'תנועה לא נמצאה' });
  if (tx.status !== 'unmatched') return res.status(409).json({ error: 'ניתן לרשום תנועה שלא שויכה בלבד' });
  const dateStr = tx.tx_date.toISOString().slice(0, 10);
  if (await periodClosed(tid, dateStr)) return res.status(409).json({ error: 'התקופה סגורה — לא ניתן לרשום' });
  const counter = await acctByCode(tid, String(account_code || ''));
  const bank = await acctByCode(tid, '1010');
  if (!counter || !bank) return res.status(400).json({ error: 'חשבון נגדי לא קיים או תרשים לא אותחל' });
  if (counter.code === '1010') return res.status(400).json({ error: 'החשבון הנגדי לא יכול להיות הבנק עצמו' });
  const amt = Math.abs(Number(tx.amount));
  const lines = Number(tx.amount) > 0
    ? [{ account_id: bank.id, debit: amt }, { account_id: counter.id, credit: amt }]
    : [{ account_id: counter.id, debit: amt }, { account_id: bank.id, credit: amt }];
  const client = await require('../db').pool.connect();
  try {
    await client.query('BEGIN');
    const e = await insertEntryTx(client, tid, {
      date: dateStr, description: description || `בנק: ${tx.description || 'תנועה'}`, source: 'bank', lines, createdBy: req.user.id,
    });
    await client.query(`UPDATE bk_bank_txs SET status='booked', booked_entry_id=$1 WHERE id=$2`, [e.id, tx.id]);
    await client.query('COMMIT');
    await audit(req, 'bk_bank_book', 'bk_bank_tx', tx.id, { entry_no: e.entry_no, amount: amt.toFixed(2) });
    res.json({ booked: true, entry_no: e.entry_no });
  } catch (err) { await client.query('ROLLBACK'); throw err; } finally { client.release(); }
});

// תמונת התאמה: כמה שויך/נרשם/ממתין + יתרת הבנק בספר
r.get('/bookkeeping/bank/reconciliation', async (req, res) => {
  const tid = req.tenant.id;
  const { rows: counts } = await q(
    `SELECT status, count(*)::int AS n, COALESCE(sum(amount),0)::numeric(12,2) AS total
     FROM bk_bank_txs WHERE tenant_id=$1 GROUP BY status`, [tid]);
  const { rows: bal } = await q(
    `SELECT COALESCE(sum(l.debit),0)::numeric(12,2) AS debit, COALESCE(sum(l.credit),0)::numeric(12,2) AS credit
     FROM bk_lines l JOIN bk_accounts a ON a.id=l.account_id
     WHERE l.tenant_id=$1 AND a.code='1010'`, [tid]);
  res.json({
    by_status: Object.fromEntries(counts.map(c => [c.status, { count: c.n, total: c.total }])),
    ledger_bank_balance: (Number(bal[0].debit) - Number(bal[0].credit)).toFixed(2),
  });
});

// --- 094: דוחות — רווח והפסד, מע"מ תקופתי (לעיון בלבד), ממתינים להקצאה, יצוא רו"ח אמיתי ---
const { sendCsv } = require('../csv');

function dateRange(req) {
  let { from, to } = req.query || {};
  if (from && !DATE_RE.test(from)) return { error: 'תאריך from לא תקין' };
  if (to && !DATE_RE.test(to)) return { error: 'תאריך to לא תקין' };
  const nowIL = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }));
  if (!from) from = `${nowIL.getFullYear()}-01-01`;
  if (!to) to = nowIL.toISOString().slice(0, 10);
  if (from > to) return {error:'תאריך התחלה מאוחר מתאריך הסיום'};
  for(const d of [from,to]) { const parsed=new Date(d+'T00:00:00Z'); if(!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,10)!==d)return {error:'תאריך לא תקין'}; }
  return { from, to };
}

// רווח והפסד לפי תנועות הספר בפועל
r.get('/bookkeeping/reports/pnl', async (req, res) => {
  const p = dateRange(req);
  if (p.error) return res.status(400).json({ error: p.error });
  const { rows } = await q(
    `SELECT a.code, a.name_he, a.type,
            COALESCE(sum(l.debit),0)::numeric(12,2) AS debit, COALESCE(sum(l.credit),0)::numeric(12,2) AS credit
     FROM bk_accounts a
     JOIN bk_lines l ON l.account_id = a.id AND l.tenant_id = a.tenant_id
     JOIN bk_entries e ON e.id = l.entry_id
     WHERE a.tenant_id=$1 AND a.type IN ('income','expense') AND e.entry_date BETWEEN $2 AND $3
     GROUP BY a.id ORDER BY a.code`, [req.tenant.id, p.from, p.to]);
  const income = rows.filter(r => r.type === 'income').map(r => ({ ...r, net: (Number(r.credit) - Number(r.debit)).toFixed(2) }));
  const expenses = rows.filter(r => r.type === 'expense').map(r => ({ ...r, net: (Number(r.debit) - Number(r.credit)).toFixed(2) }));
  const totalIncome = income.reduce((t, x) => t + Number(x.net), 0);
  const totalExpenses = expenses.reduce((t, x) => t + Number(x.net), 0);
  res.json({
    from: p.from, to: p.to, income, expenses,
    total_income: totalIncome.toFixed(2), total_expenses: totalExpenses.toFixed(2),
    net_profit: (totalIncome - totalExpenses).toFixed(2),
  });
});

// דוח מע"מ תקופתי מחושב — לעיון בלבד, לא להגשה. ההגשה בפועל: חיים/רו"ח באזור האישי
r.get('/bookkeeping/reports/vat', async (req, res) => {
  const p = dateRange(req);
  if (p.error) return res.status(400).json({ error: p.error });
  if (req.tenant.dealer_type !== 'morasha') {
    return res.json({ applicable: false, note: 'עוסק פטור — מדווח דו"ח שנתי ולא דו"ח מע"מ תקופתי' });
  }
  const sums = async (code) => {
    const { rows } = await q(
      `SELECT COALESCE(sum(l.debit),0)::numeric(12,2) AS debit, COALESCE(sum(l.credit),0)::numeric(12,2) AS credit
       FROM bk_lines l JOIN bk_accounts a ON a.id=l.account_id JOIN bk_entries e ON e.id=l.entry_id
       WHERE l.tenant_id=$1 AND a.code=$2 AND e.entry_date BETWEEN $3 AND $4`,
      [req.tenant.id, code, p.from, p.to]);
    return rows[0];
  };
  const out = await sums('2010'); // מע"מ עסקאות
  const inp = await sums('2020'); // מע"מ תשומות
  const vatOut = Number(out.credit) - Number(out.debit);
  const vatIn = Number(inp.debit) - Number(inp.credit);
  res.json({
    applicable: true, from: p.from, to: p.to,
    vat_on_sales: vatOut.toFixed(2), vat_on_inputs: vatIn.toFixed(2),
    balance: (vatOut - vatIn).toFixed(2),
    disclaimer: 'דוח מחושב לעיון בלבד — אינו דיווח לרשות המסים. ההגשה והתשלום מתבצעים באזור האישי של רשות המסים (עד ה-19 בחודש מקוון).',
  });
});

// דוח ראיה לרו"ח: מסמכי מס שממתינים למספר הקצאה
r.get('/bookkeeping/reports/pending-allocation', async (req, res) => {
  const { rows } = await q(
    `SELECT id, kind, customer_name, customer_dealer_type, allocation_number, amount_net, vat_amount, (amount_net+vat_amount) AS total, created_at
     FROM bk_documents WHERE tenant_id=$1 AND status='draft' AND allocation_number IS NULL AND kind IN ('tax_invoice','tax_invoice_receipt')
     ORDER BY created_at`, [req.tenant.id]);
  res.json({
    pending: rows.filter(d=>allocationAdvice(d).allocation_recommended).map(d => ({ ...d, kind_he: DOC_KINDS[d.kind].he, status_he: docStatusHe(d), ...allocationAdvice(d) })),
    count: rows.filter(d=>allocationAdvice(d).allocation_recommended).length,
    note: rows.some(d=>allocationAdvice(d).allocation_recommended) ? 'מומלץ לבקש מספר הקצאה ולהזינו ידנית. ההנפקה אינה חסומה ואין אימות מול הרשות' : 'אין מסמכים עם המלצת הקצאה',
  });
});

// יצוא רו"ח מהספר האמיתי — מחליף את יצוא הדמו של settlement (CSV משותף עם ניטרול נוסחאות)
r.get('/bookkeeping/accountant-export.csv', async (req, res) => {
  const p = dateRange(req);
  if (p.error) return res.status(400).json({ error: p.error });
  const { rows } = await q(
    `SELECT e.entry_no, e.entry_date, e.description, e.source,
            a.code, a.name_he, p2.name AS party, l.debit, l.credit, l.details
     FROM bk_entries e
     JOIN bk_lines l ON l.entry_id = e.id
     JOIN bk_accounts a ON a.id = l.account_id
     LEFT JOIN bk_parties p2 ON p2.id = l.party_id
     WHERE e.tenant_id=$1 AND e.entry_date BETWEEN $2 AND $3
     ORDER BY e.entry_no, (l.debit > 0) DESC`, [req.tenant.id, p.from, p.to]);
  const SRC_HE = { manual: 'ידנית', invoice: 'מסמך', expense: 'הוצאה', bank: 'בנק', reversal: 'סטורנו' };
  sendCsv(res, `bookkeeping-${p.from}_${p.to}.csv`, [
    ['מספר פקודה', 'תאריך', 'תיאור', 'מקור', 'קוד חשבון', 'שם חשבון', 'כרטיס', 'חובה', 'זכות', 'פרטים'],
    ...rows.map(r => [
      String(r.entry_no), r.entry_date.toISOString().slice(0, 10), r.description, SRC_HE[r.source] || r.source,
      r.code, r.name_he, r.party || '', Number(r.debit) ? Number(r.debit).toFixed(2) : '',
      Number(r.credit) ? Number(r.credit).toFixed(2) : '', r.details || '',
    ]),
  ]);
});

async function acctByCode(tid, code) {
  const { rows } = await q(`SELECT id, code FROM bk_accounts WHERE tenant_id=$1 AND code=$2 AND active`, [tid, code]);
  return rows[0] || null;
}


// --- 095: הפקת קבצים במבנה אחיד (OPENFRMT) לפי הוראות גרסה 1.31 ---
// טיוטה בלבד: שדה רישום התוכנה (1006) מאופס עד לרישום התוכנה ברשות המסים. אין שליחה לרשות.
const { buildFiles, mainId, DOC_TYPES } = require('../openformat');
const { safeDecryptField } = require('../fieldcrypto');

const DRAFT_NOTE = 'טיוטה — התוכנה טרם נרשמה ברשות המסים (שדה רישום התוכנה מאופס). הקבצים לעיון ולרואה החשבון בלבד, לא להגשה לרשות.';

async function assembleUniformData(tid, from, to) {
  const { rows: accounts } = await q(
    `SELECT a.code, a.name_he,
       COALESCE(SUM(l.debit - l.credit) FILTER (WHERE e.entry_date < $2), 0) AS opening,
       COALESCE(SUM(l.debit)  FILTER (WHERE e.entry_date BETWEEN $2 AND $3), 0) AS debit,
       COALESCE(SUM(l.credit) FILTER (WHERE e.entry_date BETWEEN $2 AND $3), 0) AS credit
     FROM bk_accounts a
     LEFT JOIN bk_lines l ON l.account_id = a.id AND l.tenant_id = a.tenant_id
     LEFT JOIN bk_entries e ON e.id = l.entry_id
     WHERE a.tenant_id = $1 AND a.active
     GROUP BY a.code, a.name_he ORDER BY a.code`, [tid, from, to]);

  const { rows: rawLines } = await q(
    `SELECT e.entry_no, e.entry_date, e.description, e.source, e.created_at,
            l.debit, l.credit, a.code AS account_code,
            d.kind AS doc_kind, d.doc_year, d.doc_number,
            ROW_NUMBER() OVER (PARTITION BY e.id ORDER BY l.id) AS line_no
     FROM bk_entries e
     JOIN bk_lines l ON l.entry_id = e.id AND l.tenant_id = e.tenant_id
     JOIN bk_accounts a ON a.id = l.account_id
     LEFT JOIN bk_documents d ON d.entry_id = e.id AND d.tenant_id = e.tenant_id
     WHERE e.tenant_id = $1 AND e.entry_date BETWEEN $2 AND $3
     ORDER BY e.entry_no, line_no`, [tid, from, to]);

  const lines = rawLines.map((l) => {
    const debit = Number(l.debit) > 0;
    const out = {
      entryNo: l.entry_no, lineNo: Number(l.line_no),
      typeHe: { manual: 'פקודת יומן', invoice: 'חשבונית', expense: 'הוצאה', bank: 'בנק', reversal: 'סטורנו' }[l.source] || 'פקודת יומן',
      details: l.description, date: l.entry_date, valueDate: l.entry_date,
      inputDate: (l.created_at || '').toISOString ? l.created_at.toISOString().slice(0, 10) : String(l.created_at).slice(0, 10),
      account: l.account_code, side: debit ? 'debit' : 'credit',
      amount: debit ? Number(l.debit) : Number(l.credit),
    };
    if (l.doc_kind && l.doc_number) {
      out.ref1 = `${l.doc_year}-${l.doc_number}`;
      out.ref1Type = DOC_TYPES[l.doc_kind];
    }
    return out;
  });

  const { rows: docs } = await q(
    `SELECT d.*, src.kind AS source_kind, src.doc_year AS source_doc_year, src.doc_number AS source_doc_number
     FROM bk_documents d LEFT JOIN bk_documents src ON src.id=d.source_document_id AND src.tenant_id=d.tenant_id
     WHERE d.tenant_id = $1 AND d.status = 'issued' AND d.issue_date BETWEEN $2 AND $3
     ORDER BY d.doc_year, d.doc_number`, [tid, from, to]);
  const docIds = docs.map((d) => d.id);
  const { rows: docLines } = docIds.length
    ? await q(`SELECT * FROM bk_document_lines WHERE tenant_id=$1 AND document_id = ANY($2) ORDER BY id`, [tid, docIds])
    : { rows: [] };
  const byDoc = {};
  for (const l of docLines) (byDoc[l.document_id] = byDoc[l.document_id] || []).push(l);
  const documents = docs.map((d) => ({
    ...d,
    customer_tax_id: d.customer_tax_id ? safeDecryptField(d.customer_tax_id, 'customer_tax_id') : null,
    vat_rate_x100: Number(d.amount_net) > 0 ? Math.round((Number(d.vat_amount) / Number(d.amount_net)) * 10000) : 0,
    lines: byDoc[d.id] || [],
  }));

  return {
    accounts: accounts.map((a) => ({ code: a.code, name: a.name_he, opening: Number(a.opening), debit: Number(a.debit), credit: Number(a.credit) })),
    lines, documents,
  };
}

r.post('/bookkeeping/uniform-export', async (req, res) => {
  const tid = req.tenant.id;
  const { from, to } = req.body || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(to || '') || from > to) {
    return res.status(400).json({ error: 'טווח תאריכים חסר או שגוי (from/to בפורמט YYYY-MM-DD)' });
  }
  const dealer = String(req.tenant.dealer_id || '').replace(/\D/g, '');
  if (!/^\d{9}$/.test(dealer)) {
    return res.status(409).json({ error: 'לא הוגדר מספר עוסק (9 ספרות) בהגדרות המכבסה — לא ניתן להפיק מבנה אחיד' });
  }
  const now = new Date();
  const yy = String(now.getFullYear()).slice(2);
  const mmddhhmm = `${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
  const p = {
    dealer, mainId: mainId(),
    bizName: req.tenant.name, street: req.tenant.address || '', city: req.tenant.city || '',
    from, to, now: now.toISOString().slice(0, 10), nowDate: now,
    dirPath: `OPENFRMT\\${dealer.slice(0, 8)}.${yy}\\${mmddhhmm}`, // סעיף 2.2
  };
  const data = await assembleUniformData(tid, from, to);
  const { iniBuf, zipBuf, counts, total } = buildFiles(p, data);
  const sha = (b) => require('crypto').createHash('sha256').update(b).digest('hex');
  const { rows } = await q(
    `INSERT INTO bk_uniform_exports (tenant_id, from_date, to_date, main_identifier, counts, ini_sha256, zip_sha256, ini_data, zip_data, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id, created_at`,
    [tid, from, to, p.mainId, JSON.stringify({ ...counts, total }), sha(iniBuf), sha(zipBuf), iniBuf, zipBuf, req.user.id]);
  await audit(req, 'bk_uniform_export', 'bk_uniform_export', rows[0].id, { from, to, counts });
  res.status(201).json({ id: rows[0].id, draft: true, note: DRAFT_NOTE, from, to, counts: { ...counts, total }, created_at: rows[0].created_at });
});

r.get('/bookkeeping/uniform-export', async (req, res) => {
  const { rows } = await q(
    `SELECT id, from_date, to_date, main_identifier, counts, ini_sha256, zip_sha256, created_at
     FROM bk_uniform_exports WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 50`, [req.tenant.id]);
  res.json({ exports: rows, draft: true, note: DRAFT_NOTE });
});

r.get('/bookkeeping/uniform-export/:id/ini', async (req, res) => {
  const { rows } = await q(`SELECT ini_data, ini_sha256 FROM bk_uniform_exports WHERE id=$1 AND tenant_id=$2`, [req.params.id, req.tenant.id]);
  if (!rows[0]) return res.status(404).json({ error: 'הפקה לא נמצאה' });
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', 'attachment; filename="INI.TXT"');
  res.setHeader('X-Content-SHA256', rows[0].ini_sha256);
  res.send(rows[0].ini_data);
});

r.get('/bookkeeping/uniform-export/:id/bkmv', async (req, res) => {
  const { rows } = await q(`SELECT zip_data, zip_sha256 FROM bk_uniform_exports WHERE id=$1 AND tenant_id=$2`, [req.params.id, req.tenant.id]);
  if (!rows[0]) return res.status(404).json({ error: 'הפקה לא נמצאה' });
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="BKMVDATA.zip"');
  res.setHeader('X-Content-SHA256', rows[0].zip_sha256);
  res.send(rows[0].zip_data);
});

module.exports = r;

// Pure date/threshold rule exported for regression tests; no network access.
module.exports.allocationAdvice = allocationAdvice;
