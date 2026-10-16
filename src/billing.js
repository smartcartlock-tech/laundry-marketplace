// E4.T3: חשבונית מרוכזת חודשית לחשבון עסקי — צבירת הזמנות החודש, הפקת PDF + CSV.
// מסמך דמו בלבד: לא חשבונית מס ולא מסמך מערכת documents (E12).
const path = require('path');
const PDFDocument = require('pdfkit');
const { drawRtl, collectPdf } = require('./receipt');
const { toCsv } = require('./csv');

const FONT_REG = path.join(__dirname, '..', 'assets', 'fonts', 'DejaVuSans.ttf');
const FONT_BOLD = path.join(__dirname, '..', 'assets', 'fonts', 'DejaVuSans-Bold.ttf');
const RIGHT = 545;

async function monthOrders(q, accountId, year, month) {
  const { rows } = await q(
    `SELECT o.id, o.created_at, o.subtotal, o.delivery_fee, o.discount, o.total, o.payment_status,
            (SELECT json_agg(json_build_object('name',oi.name,'qty',oi.qty,'price',oi.price)) FROM order_items oi WHERE oi.order_id=o.id) AS items
     FROM orders o
     WHERE o.business_account_id=$1
       AND EXTRACT(YEAR FROM o.created_at AT TIME ZONE 'Asia/Jerusalem')=$2
       AND EXTRACT(MONTH FROM o.created_at AT TIME ZONE 'Asia/Jerusalem')=$3
       AND o.status NOT IN ('cancelled')
     ORDER BY o.created_at`, [accountId, year, month]);
  return rows;
}

async function buildConsolidatedPdf({ tenant, account, orders, year, month }) {
  const pdf = new PDFDocument({ size: 'A4', margin: 50, info: { Title: `חשבונית מרוכזת ${month}/${year} — ${account.name}` } });
  pdf.registerFont('he', FONT_REG);
  pdf.registerFont('heb', FONT_BOLD);
  const out = collectPdf(pdf);
  pdf.font('heb').fontSize(10).fillColor('#b00');
  drawRtl(pdf, 'מסמך דמו — לא חשבונית מס', RIGHT, 30);
  pdf.font('heb').fontSize(20).fillColor(tenant.color || '#0e7a8a');
  drawRtl(pdf, tenant.name, RIGHT, 60);
  pdf.font('heb').fontSize(14).fillColor('#000');
  drawRtl(pdf, `חשבונית מרוכזת לחודש ${month}/${year}`, RIGHT, 95);
  pdf.font('he').fontSize(10).fillColor('#444');
  drawRtl(pdf, `${account.name}${account.company_id ? ' · ח"פ ' + account.company_id : ''}`, RIGHT, 118);
  drawRtl(pdf, `תנאי תשלום: ${account.payment_terms === 'net30' ? 'שוטף+30' : account.payment_terms} · הופק ב-1 לחודש`, RIGHT, 132);
  let y = 160;
  pdf.font('heb').fontSize(11).fillColor('#000');
  drawRtl(pdf, 'מספר', RIGHT, y); drawRtl(pdf, 'תאריך', RIGHT - 110, y); drawRtl(pdf, 'פריטים', RIGHT - 210, y); drawRtl(pdf, 'סכום', RIGHT - 340, y);
  y += 8; pdf.moveTo(50, y).lineTo(RIGHT, y).strokeColor('#ccc').stroke(); y += 10;
  pdf.font('he').fontSize(10);
  for (const o of orders) {
    if (y > 770) { pdf.addPage(); y = 60; }
    const dt = new Date(o.created_at).toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem' });
    const itemsTxt = (o.items || []).map(i => `${i.name} x${i.qty}`).join(', ');
    drawRtl(pdf, String(o.id).slice(0, 8), RIGHT, y);
    drawRtl(pdf, dt, RIGHT - 110, y);
    drawRtl(pdf, itemsTxt.slice(0, 60), RIGHT - 210, y);
    drawRtl(pdf, `₪${Number(o.total).toFixed(2)}`, RIGHT - 340, y);
    y += 18;
  }
  const total = orders.reduce((s, o) => s + Number(o.total), 0);
  y += 10; pdf.moveTo(50, y).lineTo(RIGHT, y).strokeColor('#ccc').stroke(); y += 12;
  pdf.font('heb').fontSize(13);
  drawRtl(pdf, `סה"כ לתשלום: ₪${total.toFixed(2)} (${orders.length} הזמנות)`, RIGHT, y);
  pdf.end();
  return out;
}

function consolidatedCsv(orders) {
  const rows = [['תאריך', 'מספר הזמנה', 'פריטים', 'סכום ביניים', 'משלוח', 'הנחה', 'סה"כ']];
  for (const o of orders) {
    rows.push([
      new Date(o.created_at).toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem' }),
      String(o.id).slice(0, 8),
      (o.items || []).map(i => `${i.name} x${i.qty}`).join('; '),
      Number(o.subtotal).toFixed(2), Number(o.delivery_fee).toFixed(2), Number(o.discount).toFixed(2), Number(o.total).toFixed(2),
    ]);
  }
  return rows;
}

// הפקה/רענון של חשבונית לחודש נתון; מחזיר null אם לא היו הזמנות
async function issueInvoice(q, account, tenant, year, month) {
  const orders = await monthOrders(q, account.id, year, month);
  if (!orders.length) return null;
  const pdfBuf = await buildConsolidatedPdf({ tenant, account, orders, year, month });
  const total = orders.reduce((s, o) => s + Number(o.total), 0);
  const { rows } = await q(
    `INSERT INTO business_invoices(account_id, year, month, orders_count, total, pdf)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (account_id, year, month) DO UPDATE SET orders_count=EXCLUDED.orders_count, total=EXCLUDED.total, pdf=EXCLUDED.pdf, issued_at=now()
     RETURNING id, year, month, orders_count, total, issued_at`,
    [account.id, year, month, orders.length, total, pdfBuf]);
  return rows[0];
}

// job חודשי: ב-1 לחודש (שעון ישראל) מפיק לכל חשבון עם הזמנות בחודש הקודם
async function issueMonthlyInvoices(q) {
  const { rows: dim } = await q(`SELECT EXTRACT(YEAR FROM (now() AT TIME ZONE 'Asia/Jerusalem') - interval '1 month')::int AS y,
                                        EXTRACT(MONTH FROM (now() AT TIME ZONE 'Asia/Jerusalem') - interval '1 month')::int AS m,
                                        EXTRACT(DAY FROM (now() AT TIME ZONE 'Asia/Jerusalem'))::int AS d`);
  const { y, m, d } = dim[0];
  if (d !== 1) return { issued: 0, skipped: 'not 1st of month' };
  const { rows: accounts } = await q(
    `SELECT DISTINCT ba.*, t.name AS tenant_name, t.color AS tenant_color, t.id AS tid FROM business_accounts ba
     JOIN orders o ON o.business_account_id=ba.id JOIN tenants t ON t.id=ba.tenant_id
     WHERE ba.active
       AND EXTRACT(YEAR FROM o.created_at AT TIME ZONE 'Asia/Jerusalem')=$1
       AND EXTRACT(MONTH FROM o.created_at AT TIME ZONE 'Asia/Jerusalem')=$2`, [y, m]);
  let issued = 0;
  for (const a of accounts) {
    const tenant = { id: a.tid, name: a.tenant_name, color: a.tenant_color };
    const inv = await issueInvoice(q, a, tenant, y, m);
    if (inv) issued++;
  }
  return { issued };
}

module.exports = { monthOrders, buildConsolidatedPdf, consolidatedCsv, issueInvoice, issueMonthlyInvoices };
