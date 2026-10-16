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
    doc.font('he').text(`x${it.qty}`, 130, y, { lineBreak: false });
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
