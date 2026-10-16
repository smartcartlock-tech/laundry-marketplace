// סיכום חודשי לבעל מכבסה — PDF מעוצב (דמו בלבד, בלי חיוב אמיתי ובלי תוקף מס).
// נבנה מנתוני /settlement/*: תשלומים, מנויים, מסמכים, עמלה ורצף מספור.
const path = require('path');
const PDFDocument = require('pdfkit');
const { drawRtl } = require('./receipt');

const FONT_REG = path.join(__dirname, '..', 'assets', 'fonts', 'DejaVuSans.ttf');
const FONT_BOLD = path.join(__dirname, '..', 'assets', 'fonts', 'DejaVuSans-Bold.ttf');
const RIGHT = 545;
const money = n => '₪' + Number(n || 0).toFixed(2);

function line(pdf, text, { bold, size, color } = {}) {
  pdf.font(bold ? 'heb' : 'he').fontSize(size || 10).fillColor(color || '#111');
  const h = drawRtl(pdf, text, RIGHT, pdf.y);
  pdf.y += Math.max(h, (size || 10) + 5);
}
function row2(pdf, label, value, { bold, color } = {}) {
  const y = pdf.y;
  pdf.font(bold ? 'heb' : 'he').fontSize(10).fillColor(color || '#111').text(String(value), 50, y, { lineBreak: false });
  const h = drawRtl(pdf, label, RIGHT, y);
  pdf.y = Math.max(y + h, y + 17);
}
function section(pdf, title) {
  pdf.moveDown(0.6);
  pdf.font('heb').fontSize(12).fillColor('#0e7a8a');
  const h = drawRtl(pdf, title, RIGHT, pdf.y);
  pdf.y += Math.max(h, 17);
  pdf.moveTo(50, pdf.y).lineTo(RIGHT, pdf.y).strokeColor('#0e7a8a').lineWidth(0.8).stroke();
  pdf.moveDown(0.35);
}

function buildMonthlySummaryPDF({ tenant, label, from, to, kpi, cancelled, byMethod, subs, docs, commission, sequence }) {
  const pdf = new PDFDocument({ size: 'A4', margin: 50, info: { Title: `סיכום חודשי ${label} (מסמך דמו)` } });
  pdf.registerFont('he', FONT_REG);
  pdf.registerFont('heb', FONT_BOLD);

  // חותמת דמו קבועה
  pdf.font('heb').fontSize(10).fillColor('#b00');
  drawRtl(pdf, 'מסמך דמו — סיכום תקופה מערכתי, ללא חיוב אמיתי וללא תוקף מס', RIGHT, 30);
  pdf.y = 52;

  pdf.font('heb').fontSize(20).fillColor('#0e7a8a');
  const h0 = drawRtl(pdf, tenant.name, RIGHT, pdf.y);
  pdf.y += Math.max(h0, 26);
  line(pdf, `סיכום חודשי · ${label} (${from} — ${to})`, { bold: true, size: 14, color: '#111' });
  line(pdf, `הופק אוטומטית ב-${new Date().toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem' })} · מערכת מכבסה בקליק (דמו)`, { size: 9, color: '#666' });

  section(pdf, 'תשלומים והזמנות');
  row2(pdf, 'הזמנות בתקופה', kpi.orders);
  row2(pdf, 'מחזור (לא כולל מבוטלות)', money(kpi.revenue));
  row2(pdf, 'נגבה (דמו/מזומן)', money(kpi.collected), { bold: true });
  row2(pdf, 'ממתין לגבייה', money(kpi.pending));
  if (cancelled.orders) row2(pdf, `בוטלו (${cancelled.orders} הזמנות)`, money(cancelled.total), { color: '#b00' });
  for (const m of byMethod) row2(pdf, `· ${m.method_he} — ${m.status_he}`, `${m.orders} הזמנות · ${money(m.total)}`, { size: 9 });

  section(pdf, 'מנויים (תשלום דמו)');
  row2(pdf, 'מנויים שהצטרפו/חודשו בתקופה', subs.count);
  row2(pdf, 'הכנסה ממנויים', money(subs.total), { bold: true });

  section(pdf, 'מסמכים שהונפקו (מסמך דמו — לא חשבונית מס)');
  if (!docs.length) line(pdf, 'לא הונפקו מסמכים בתקופה', { color: '#666' });
  for (const d of docs) row2(pdf, `${d.kind_he} (${d.docs} מסמכים)`, money(d.total));

  section(pdf, 'התחשבנות עמלה מול הפלטפורמה (דמו)');
  row2(pdf, `לקוחות ממותג — ${commission.own.orders} הזמנות, ${commission.own.pct}%`, money(commission.own.commission));
  row2(pdf, `מרקטפלייס — ${commission.marketplace.orders} הזמנות, ${commission.marketplace.pct}%`, money(commission.marketplace.commission));
  row2(pdf, 'ציפיית עמלה כוללת', money(commission.total), { bold: true });

  section(pdf, 'מספור רציף');
  for (const s of sequence) {
    row2(pdf, s.kind_he, s.docs ? `${s.docs} מסמכים · ${s.ok ? 'רציף ✓' : 'פערים!'}` : 'אין מסמכים', { color: s.ok ? '#178a4c' : '#b00' });
  }

  pdf.moveDown(1);
  line(pdf, 'מסמך דמו — הופק אוטומטית על ידי מערכת מכבסה בקליק. אין לראות בו חשבונית מס או דוח רשמי.', { size: 8, color: '#999' });
  pdf.end();
  return pdf;
}

module.exports = { buildMonthlySummaryPDF };
