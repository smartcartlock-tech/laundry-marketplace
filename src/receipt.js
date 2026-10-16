// הפקת קבלה/חשבונית PDF בעברית (RTL) לכל הזמנה — pdfkit + DejaVu Sans + bidi-js.
// pdfkit/fontkit לא מטפל נכון ב-bidi (מספרים מתהפכים, רווחים נבלעים), לכן אנחנו
// מחשבים סדר חזותי בעצמנו עם bidi-js, מפצלים לרצפים חד-כיווניים ומציירים כל רצף
// במיקום מדויק — רצף עברי מועבר לפונט בסדר לוגי (הפונט הופך אותו נכון), רצף
// מספרים/אנגלית מועבר כמו שהוא.
const PDFDocument = require('pdfkit');
const path = require('path');
const bidiFactory = require('bidi-js');

const bidi = bidiFactory();
const FONT_REG = path.join(__dirname, '..', 'assets', 'fonts', 'DejaVuSans.ttf');
const FONT_BOLD = path.join(__dirname, '..', 'assets', 'fonts', 'DejaVuSans-Bold.ttf');

const PAGE_RIGHT = 545; // שול ימין של אזור התוכן בעמוד A4 עם margin 50

const HEB_RE = /[\u0590-\u05FF]/;
const LTR_RE = /[0-9A-Za-z]/;

function reverseStr(s) { return Array.from(s).reverse().join(''); }

// פיצול מחרוזת בסדר חזותי לרצפים: עברית(+ניטרליים) מול LTR (ספרות/אנגלית)
function splitRuns(visual) {
  const runs = [];
  for (const ch of Array.from(visual)) {
    const heb = HEB_RE.test(ch) ? true : (LTR_RE.test(ch) ? false : null);
    if (heb === null) {
      // ניטרלי (רווח/פיסוק/₪) — מצטרף לרצף הנוכחי, או פותח רצף עברי
      if (runs.length) runs[runs.length - 1].t += ch;
      else runs.push({ t: ch, hebrew: true });
    } else if (runs.length && runs[runs.length - 1].hebrew === heb) {
      runs[runs.length - 1].t += ch;
    } else {
      runs.push({ t: ch, hebrew: heb });
    }
  }
  return runs;
}

// ציור שורה ימין-מיושרת ב-y נתון; מחזיר גובה השורה
function drawRtl(doc, text, rightX, y, opts = {}) {
  const s = text === null || text === undefined ? '' : String(text);
  if (!s) return 0;
  if (!HEB_RE.test(s)) {
    const w = doc.widthOfString(s);
    doc.text(s, rightX - w, y, { lineBreak: false, ...opts });
    return doc.currentLineHeight(true);
  }
  const levels = bidi.getEmbeddingLevels(s, 'rtl');
  const visual = bidi.getReorderedString(s, levels);
  const runs = splitRuns(visual);
  let total = 0;
  for (const r of runs) {
    r.draw = (r.hebrew ? reverseStr(r.t) : r.t).replace(/ /g, ' ');
    r.w = doc.widthOfString(r.draw);
    total += r.w;
  }
  let x = rightX - total;
  for (const r of runs) {
    doc.text(r.draw, x, y, { lineBreak: false, ...opts });
    x += r.w;
  }
  return doc.currentLineHeight(true);
}

// שורה ימין-מיושרת שמקדמת את הסמן למטה
function line(doc, text, rightX = PAGE_RIGHT) {
  const y = doc.y;
  const h = drawRtl(doc, text, rightX, y);
  doc.y = y + h;
}

// שני טורים באותה שורה: ערך משמאל (LTR), תווית מימין (RTL)
function row2(doc, label, val, leftX = 50, rightX = PAGE_RIGHT) {
  const y = doc.y;
  const v = String(val);
  doc.text(v, leftX, y, { lineBreak: false });
  const h1 = drawRtl(doc, label, rightX, y);
  const h2 = doc.currentLineHeight(true);
  doc.y = y + Math.max(h1, h2);
}

function money(n) { return '₪' + Number(n).toFixed(2).replace(/\.00$/, ''); }

const STATUS_HE = { new: 'התקבלה', confirmed: 'אושרה', picked_up: 'נאספה', in_work: 'בעבודה', ready: 'מוכנה', out_for_delivery: 'בדרך אליך', delivered: 'הוחזרה', cancelled: 'בוטלה' };
const PAY_HE = { pending: 'טרם שולם', paid_demo: 'שולם (דמו)', paid_cash: 'שולם במזומן' };

// מחזיר stream של PDF. data: {order, items, tenant, customer}
function buildReceiptPDF({ order, items, tenant, customer }) {
  const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: `קבלה ${order.id.slice(0, 8)}` } });
  doc.registerFont('he', FONT_REG);
  doc.registerFont('heb', FONT_BOLD);

  // כותרת
  doc.font('heb').fontSize(20).fillColor(tenant.color || '#0e7a8a');
  line(doc, tenant.name);
  doc.font('he').fontSize(10).fillColor('#444');
  line(doc, [tenant.address, tenant.city].filter(Boolean).join(', ') + (tenant.phone ? ' · ' + tenant.phone : ''));
  doc.moveDown(0.5);
  doc.font('heb').fontSize(16).fillColor('#111');
  line(doc, `קבלה / חשבונית — הזמנה #${order.id.slice(0, 8)}`);
  doc.moveDown(0.5);
  doc.font('he').fontSize(10).fillColor('#333');
  const d = new Date(order.created_at);
  line(doc, `תאריך: ${d.toLocaleDateString('he-IL')} ${d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}`);
  line(doc, `לקוח/ה: ${customer.name || ''} ${customer.phone || ''}`.trim());
  line(doc, `כתובת איסוף/החזרה: ${order.address}`);
  line(doc, `סטטוס: ${STATUS_HE[order.status] || order.status} · תשלום: ${PAY_HE[order.payment_status] || order.payment_status}`);
  doc.moveDown(0.8);

  // טבלת פריטים
  doc.font('heb').fontSize(11).fillColor('#0e7a8a');
  line(doc, 'פריטים');
  doc.moveTo(50, doc.y).lineTo(PAGE_RIGHT, doc.y).strokeColor('#0e7a8a').lineWidth(1).stroke();
  doc.moveDown(0.3);
  doc.font('he').fontSize(10).fillColor('#111');
  for (const it of items) {
    const y = doc.y;
    doc.font('heb').text(money(Number(it.price) * Number(it.qty)), 50, y, { lineBreak: false });
    const qn = Number(it.qty); doc.font('he').text(`x${qn % 1 ? qn : Math.round(qn)}`, 130, y, { lineBreak: false });
    const h = drawRtl(doc, it.name, PAGE_RIGHT, y);
    doc.y = Math.max(y + h, y + 16);
  }
  doc.moveDown(0.5);
  doc.moveTo(50, doc.y).lineTo(PAGE_RIGHT, doc.y).strokeColor('#ccc').lineWidth(0.5).stroke();
  doc.moveDown(0.4);

  doc.fillColor('#111');
  const row = (label, val, bold) => {
    doc.font(bold ? 'heb' : 'he').fontSize(bold ? 13 : 10);
    row2(doc, label, val);
    if (bold) doc.moveDown(0.2);
  };
  row('סכום ביניים', money(order.subtotal));
  if (Number(order.delivery_fee)) row('איסוף והחזרה', money(order.delivery_fee));
  if (Number(order.discount)) row('הנחה (נקודות/קופון)', '-' + money(order.discount));
  row('סה"כ לתשלום', money(order.total), true);

  if (order.points_earned) {
    doc.moveDown(0.5);
    doc.font('he').fontSize(9).fillColor('#666');
    line(doc, `בהזמנה זו נצברו ${order.points_earned} נקודות מועדון`);
  }
  doc.moveDown(1);
  doc.font('he').fontSize(9).fillColor('#999');
  line(doc, 'הופק אוטומטית על ידי מערכת מכבסה בקליק — מסמך דמו, אינו חשבונית מס לצורכי מע"מ.');
  doc.end();
  return doc;
}

module.exports = { buildReceiptPDF, drawRtl, splitRuns };

// E12.T2: PDF למסמך חשבונאי (חשבונית עסקה / קבלה / זיכוי) — כולל חותמת דמו תמידית
// עד לרישום התוכנה ברשות המסים, וסימון "העתק" בהפקה חוזרת.
const KIND_TITLE = { invoice: 'חשבונית עסקה', receipt: 'קבלה', credit: 'זיכוי', consolidated: 'חשבונית מרכזת' };
const bwipjs = require('bwip-js');
const APP_BASE_URL = process.env.APP_BASE_URL || 'https://washup-qa0d.onrender.com';


// QR לסריקה (עמוד אימות ציבורי) + ברקוד Code128 של מזהה המסמך — אפס עלות, נוצר מקומית
async function docVerificationImages(d) {
  const verifyUrl = `${APP_BASE_URL}/#/verify/${d.verify_code}`;
  const [qr, barcode] = await Promise.all([
    bwipjs.toBuffer({ bcid: 'qrcode', text: verifyUrl, scale: 4, eclevel: 'M' }),
    bwipjs.toBuffer({ bcid: 'code128', text: `WLM-${d.doc_year}-${d.doc_number}`, height: 10, includetext: false }),
  ]);
  return { qr, barcode, verifyUrl };
}

function collectPdf(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}

// doc: שורת documents; copy=true מסמן "העתק"; מחזיר pdfkit document (צריך doc.end() של הקורא)
function buildDocumentPDF({ doc: d, order, items, tenant, customer, copy, codes, note }) {
  const pdf = new PDFDocument({ size: 'A4', margin: 50, info: { Title: `${KIND_TITLE[d.kind]} ${d.doc_number}` } });
  pdf.registerFont('he', FONT_REG);
  pdf.registerFont('heb', FONT_BOLD);

  // חותמת דמו קבועה — עד להשלמת רישום התוכנה ברשות המסים
  pdf.save().rotate(0);
  pdf.font('heb').fontSize(10).fillColor('#b00');
  drawRtl(pdf, 'מסמך דמו — לא לצורכי מע"מ (טרם רישום תוכנה ברשות המסים)', PAGE_RIGHT, 30);
  if (copy) drawRtl(pdf, 'העתק', PAGE_RIGHT, 44);
  pdf.restore();
  pdf.y = 66;

  pdf.font('heb').fontSize(20).fillColor(tenant.color || '#0e7a8a');
  line(pdf, tenant.name);
  pdf.font('he').fontSize(10).fillColor('#444');
  const dealerBits = [];
  if (tenant.dealer_id) dealerBits.push(`ח.פ/ע.מ: ${tenant.dealer_id}`);
  if (tenant.dealer_type) dealerBits.push(tenant.dealer_type === 'morasha' ? 'עוסק מורשה' : 'עוסק פטור');
  line(pdf, [tenant.address, tenant.city].filter(Boolean).join(', ') + (dealerBits.length ? ' · ' + dealerBits.join(' · ') : ''));

  pdf.moveDown(0.5);
  pdf.font('heb').fontSize(16).fillColor('#111');
  const numStr = `מספר ${d.doc_number}/${d.doc_year}`;
  line(pdf, `${KIND_TITLE[d.kind]} — ${numStr}`);
  pdf.font('he').fontSize(10).fillColor('#333');
  if (d.allocation_number) line(pdf, `מספר הקצאה: ${d.allocation_number}`);
  const dt = new Date(d.issued_at);
  line(pdf, `תאריך הפקה: ${dt.toLocaleDateString('he-IL')} ${dt.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}`);
  if (order) line(pdf, `בגין הזמנה: #${order.id.slice(0, 8)}`);
  line(pdf, `לכבוד: ${(customer && customer.name) || 'לקוח'}${customer && customer.phone ? ' · ' + customer.phone : ''}`);
  if (note) line(pdf, note);
  if (d.kind === 'credit' && d.original_number) line(pdf, `בזיכוי למסמך מספר ${d.original_number}/${d.doc_year}`);
  pdf.moveDown(0.8);

  if (items && items.length) {
    pdf.font('heb').fontSize(11).fillColor('#0e7a8a');
    line(pdf, 'פירוט');
    pdf.moveTo(50, pdf.y).lineTo(PAGE_RIGHT, pdf.y).strokeColor('#0e7a8a').lineWidth(1).stroke();
    pdf.moveDown(0.3);
    pdf.font('he').fontSize(10).fillColor('#111');
    for (const it of items) {
      const y = pdf.y;
      const qn = Number(it.qty);
      pdf.font('he').text(money(Number(it.price) * qn), 50, y, { lineBreak: false });
      pdf.text(`x${qn % 1 ? qn : Math.round(qn)}`, 130, y, { lineBreak: false });
      const h = drawRtl(pdf, it.name, PAGE_RIGHT, y);
      pdf.y = Math.max(y + h, y + 16);
    }
    pdf.moveDown(0.5);
    pdf.moveTo(50, pdf.y).lineTo(PAGE_RIGHT, pdf.y).strokeColor('#ccc').lineWidth(0.5).stroke();
    pdf.moveDown(0.4);
  }

  pdf.fillColor('#111');
  const vatRow = Number(d.vat) !== 0;
  pdf.font('he').fontSize(10);
  if (vatRow) {
    row2(pdf, 'סכום לפני מע"מ', money(d.amount));
    row2(pdf, `מע"מ (${Math.round(Number(d.vat) / Number(d.amount) * 100)}%)`, money(d.vat));
  }
  pdf.font('heb').fontSize(13);
  row2(pdf, 'סה"כ', money(d.total));
  if (d.kind !== 'credit' && Number(d.credited_amount) > 0) {
    pdf.font('he').fontSize(10).fillColor('#b00');
    row2(pdf, 'זוכה', '-' + money(d.credited_amount));
  }
  pdf.moveDown(1);
  // אימות מסמך: QR לסריקה + ברקוד + קוד ידני (מערכות מתקדמות — סריקה לאימות קבלות/חשבוניות)
  if (codes && codes.qr && d.verify_code) {
    if (pdf.y > 660) pdf.addPage();
    const vy = pdf.y + 4;
    pdf.image(codes.qr, 50, vy, { width: 52 });
    if (codes.barcode) pdf.image(codes.barcode, 116, vy + 10, { width: 130 });
    pdf.font('he').fontSize(9).fillColor('#333');
    drawRtl(pdf, `אימות מסמך: סרקו את ה-QR או הזינו את הקוד ${d.verify_code} בעמוד האימות`, PAGE_RIGHT, vy + 14);
    pdf.fontSize(8).fillColor('#999');
    drawRtl(pdf, codes.verifyUrl, PAGE_RIGHT, vy + 28);
    pdf.y = vy + 58;
  }
  pdf.font('he').fontSize(9).fillColor('#999');
  line(pdf, 'הופק אוטומטית על ידי מערכת מכבסה בקליק — מסמך דמו, אינו חשבונית מס לצורכי מע"מ.');
  pdf.end();
  return pdf;
}

module.exports.buildDocumentPDF = buildDocumentPDF;
module.exports.collectPdf = collectPdf;
module.exports.docVerificationImages = docVerificationImages;
