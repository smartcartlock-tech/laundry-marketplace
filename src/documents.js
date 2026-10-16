// E12 — ליבת מסמכים חשבונאיים: מספור רציף, אי-שינוי, זיכויים, audit.
// כל ההפקות מתבצעות בתוך טרנזקציה (client) כדי שהמספור יהיה אטומי וללא חורים.
// מסמכים מסומנים "מסמך דמו, לא לצורכי מע\"מ" עד להשלמת רישום התוכנה ברשות המסים.

const KIND_HE = { invoice: 'חשבונית עסקה', receipt: 'קבלה', credit: 'זיכוי', consolidated: 'חשבונית מרכזת' };
const crypto = require('crypto');
const VERIFY_ABC = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
// טוקן אימות ~120 ביט (24 תווים base32), ללא PII — לפי האיפיון
function newVerifyCode() { const b = crypto.randomBytes(24); let c = ''; for (let i = 0; i < 24; i++) c += VERIFY_ABC[b[i] % VERIFY_ABC.length]; return c; }

// חתימת מסמך: HMAC-SHA256 של (מזהה, סוג/מספר/שנה, סכום, תאריך) במפתח השרת — אימות בשרת בלבד
const SIGN_SECRET = process.env.DOC_SIGNING_SECRET || 'demo-doc-signing-secret';
function signDocument(d) {
  const date = new Date(d.issued_at).toISOString().slice(0, 10);
  return crypto.createHmac('sha256', SIGN_SECRET)
    .update(`${d.id}|${d.kind}|${d.doc_year}-${d.doc_number}|${Number(d.total).toFixed(2)}|${date}`)
    .digest('base64url');
}
function verifySignature(d) { return !!d.signature && d.signature === signDocument(d); }
const VAT_RATE = 0.18;

// הקצאת מספר רציף לכל (מכבסה, סוג) — אטומי דרך UPDATE..RETURNING.
// החלטת משתמש 16.10: רצף ללא פערים ובלי אתחול שנתי — שורת מונה אחת (year=0); doc_year הוא שנת ההפקה לתצוגה בלבד.
async function nextDocNumber(client, tenantId, kind) {
  await client.query(
    'INSERT INTO doc_counters(tenant_id, kind, year, next_number) VALUES ($1,$2,0,1) ON CONFLICT DO NOTHING',
    [tenantId, kind]);
  const { rows } = await client.query(
    'UPDATE doc_counters SET next_number = next_number + 1 WHERE tenant_id=$1 AND kind=$2 AND year=0 RETURNING next_number',
    [tenantId, kind]);
  return rows[0].next_number - 1;
}

async function audit(client, documentId, action, actorId, details) {
  await client.query(
    'INSERT INTO document_events(document_id, action, actor_id, details) VALUES ($1,$2,$3,$4)',
    [documentId, action, actorId || null, details ? JSON.stringify(details) : null]);
}

// הנפקת מסמך. opts: {tenant, kind, order, customer, amount, vat, total, pdf, allocationNumber, originalId, actorId}
// מחזיר את שורת המסמך. זורק {status, error} על חריגות עסקיות.
async function issueDocument(client, opts) {
  const { tenant, kind, order, customer } = opts;
  const amount = Math.round(Number(opts.amount) * 100) / 100;
  const vat = Math.round(Number(opts.vat || 0) * 100) / 100;
  const total = Math.round(Number(opts.total) * 100) / 100;
  const signOk = kind === 'credit' ? (amount <= 0 && total <= 0) : (amount >= 0 && total >= 0);
  if (!signOk) throw { status: 400, error: 'סכום מסמך לא תקין' };

  // חוקיות בסיסית: עוסק מורשה — חשבונית מס בלי מספר הקצאה רק עד 5,000 ש"ח לפני מע"מ, ללקוח פרטי
  if ((kind === 'invoice' || kind === 'consolidated') && tenant.dealer_type === 'morasha' && !opts.allocationNumber) {
    if (amount > 5000) throw { status: 409, error: 'חשבונית מס מעל ₪5,000 לפני מע"מ דורשת מספר הקצאה' };
  }
  // עוסק פטור לא מפיק חשבונית עסקה עם מע"מ
  if (tenant.dealer_type === 'patur' && kind === 'invoice' && vat !== 0) {
    throw { status: 409, error: 'עוסק פטור אינו רשאי לגבות מע"מ' };
  }

  // שנת ההפקה בשעון ישראל — לא UTC של השרת (ליל 31.12)
  const year = Number(new Intl.DateTimeFormat('en', { timeZone: 'Asia/Jerusalem', year: 'numeric' }).format(new Date()));
  const num = await nextDocNumber(client, tenant.id, kind);
  const { rows } = await client.query(
    `INSERT INTO documents(tenant_id, order_id, customer_id, kind, doc_year, doc_number, allocation_number,
       amount, vat, total, original_id, pdf, verify_code)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [tenant.id, order ? order.id : null, customer ? customer.id : null, kind, year, num,
     opts.allocationNumber || null, amount, vat, total, opts.originalId || null, opts.pdf || null, newVerifyCode()]);
  const sig = signDocument(rows[0]);
  await client.query('UPDATE documents SET signature=$2 WHERE id=$1', [rows[0].id, sig]);
  rows[0].signature = sig;
  await audit(client, rows[0].id, 'issued', opts.actorId, { kind, number: num, total, demo: true });
  return rows[0];
}

// פיצול סכום זיכוי ל-amount/vat: amount מחושב כהפרש יתרות יחסיות מעוגלות (בזיכוי סוגר נסגרת
// השארית בדיוק), ו-vat תמיד משלים ל-total כדי ש-amount+vat=total גם באגורות שבורות.
function creditSplit(original, amt) {
  const r2 = x => Math.round(x * 100) / 100;
  const total = Number(original.total), credited = Number(original.credited_amount);
  const amountBefore = r2(Number(original.amount) * (credited / total));
  const amountAfter = r2(Number(original.amount) * ((credited + amt) / total));
  const amount = -(amountAfter - amountBefore);
  const vat = r2(-amt - amount);
  return { amount, vat };
}

// הנפקת זיכוי מול מסמך מקור. amount=null → זיכוי מלא של היתרה.
async function creditDocument(client, { tenant, original, amount, actorId, pdf }) {
  if (!original) throw { status: 404, error: 'מסמך מקור לא נמצא' };
  // קריאה טרייה ונעילה בטרנזקציה — מונע זיכוי כפול/מעבר ליתרה גם במקביל
  const { rows: cur } = await client.query('SELECT * FROM documents WHERE id=$1 FOR UPDATE', [original.id]);
  original = cur[0];
  if (!original || original.tenant_id !== tenant.id) throw { status: 404, error: 'מסמך מקור לא נמצא' };
  if (original.kind === 'credit') throw { status: 409, error: 'לא ניתן לזכות מסמך זיכוי' };
  if (original.status === 'credited') throw { status: 409, error: 'המסמך כבר זוכה במלואו' };
  const remaining = Math.round((Number(original.total) - Number(original.credited_amount)) * 100) / 100;
  const amt = amount === null || amount === undefined ? remaining : Math.round(Number(amount) * 100) / 100;
  if (!(amt > 0)) throw { status: 400, error: 'סכום זיכוי לא תקין' };
  if (amt > remaining) throw { status: 409, error: `לא ניתן לזכות מעל יתרת המסמך (₪${remaining})` };
  const split = creditSplit(original, amt);
  const credit = await issueDocument(client, {
    tenant, kind: 'credit', order: { id: original.order_id }, customer: { id: original.customer_id },
    amount: split.amount, vat: split.vat,
    total: -amt, originalId: original.id, actorId, pdf,
  });
  // PDF מקור לזיכוי — נבנה ונשמר מיד (כמו שאר המסמכים), עם הפניה למסמך המקור
  if (!pdf) {
    const { buildDocumentPDF, collectPdf, docVerificationImages } = require('./receipt');
    const { rows: custRows } = await client.query('SELECT id, name, phone FROM users WHERE id=$1', [original.customer_id]);
    const { rows: itemRows } = original.order_id
      ? await client.query('SELECT * FROM order_items WHERE order_id=$1', [original.order_id]) : { rows: [] };
    credit.original_number = original.doc_number;
    credit.original_year = original.doc_year;
    credit.credit_full = Math.round((Number(original.credited_amount) + amt) * 100) / 100 >= Number(original.total);
    const codes = await docVerificationImages(credit);
    const pdfDoc = buildDocumentPDF({
      doc: credit, order: original.order_id ? { id: original.order_id } : null, items: itemRows, tenant,
      customer: custRows[0] || { id: original.customer_id }, copy: false, codes,
      // בלי note — השורה המובנית "בזיכוי למסמך מספר X" כבר מודפסת בבילדר
    });
    const buf = await collectPdf(pdfDoc);
    await client.query('UPDATE documents SET pdf=$2, sha256=$3 WHERE id=$1 AND pdf IS NULL',
      [credit.id, buf, crypto.createHash('sha256').update(buf).digest('hex')]);
    credit.pdf = buf;
  }
  const newCredited = Math.round((Number(original.credited_amount) + amt) * 100) / 100;
  const newStatus = newCredited >= Number(original.total) ? 'credited' : 'partially_credited';
  // עדכון מותר: רק credited_amount ו-status (שאר השדות immutable בטריגר)
  await client.query('UPDATE documents SET credited_amount=$2, status=$3 WHERE id=$1', [original.id, newCredited, newStatus]);
  await audit(client, original.id, 'credited', actorId, { credit_id: credit.id, amount: amt, status: newStatus });
  return credit;
}

// עדכון מספר הקצאה (9 ספרות) — השדה היחיד הניתן לעדכון מחוץ לזיכוי
async function setAllocationNumber(client, docId, tenantId, allocationNumber, actorId) {
  if (!/^\d{9}$/.test(String(allocationNumber))) throw { status: 400, error: 'מספר הקצאה חייב להיות 9 ספרות' };
  const { rows: cur } = await client.query('SELECT id, tenant_id, allocation_number FROM documents WHERE id=$1 FOR UPDATE', [docId]);
  if (!cur[0] || (tenantId && cur[0].tenant_id !== tenantId)) throw { status: 404, error: 'מסמך לא נמצא' };
  if (cur[0].allocation_number) throw { status: 409, error: 'מספר הקצאה כבר הוגדר — לא ניתן לדרוס' };
  const { rows } = await client.query('UPDATE documents SET allocation_number=$2 WHERE id=$1 RETURNING *', [docId, String(allocationNumber)]);
  await audit(client, docId, 'allocation_set', actorId, { allocation_number: String(allocationNumber) });
  return rows[0];
}

// מיגרציית שלמות למסמכים קיימים: חתימה מחדש למי שהאלגוריתם/הסוד השתנה לגביו,
// ו-sha256 מחדש מבייטי ה-PDF כשחסר/שגוי (מחזיר "מקור" אמיתי בלי חותמת "העתק"). כל שינוי מתועד.
async function migrateDocumentIntegrity() {
  const { pool } = require('./db');
  const { rows } = await pool.query('SELECT * FROM documents ORDER BY issued_at');
  let fixedSig = 0, fixedHash = 0;
  for (const d of rows) {
    if (!verifySignature(d)) {
      await pool.query('UPDATE documents SET signature=$2 WHERE id=$1', [d.id, signDocument(d)]);
      await pool.query(`INSERT INTO document_events(document_id, action, details) VALUES ($1,'signature_migrated',$2)`,
        [d.id, JSON.stringify({ reason: 'algorithm drift', demo: true })]);
      fixedSig++;
    }
    if (d.pdf) {
      const real = crypto.createHash('sha256').update(d.pdf).digest('hex');
      if (d.sha256 !== real) {
        await pool.query('UPDATE documents SET sha256=$2 WHERE id=$1', [d.id, real]);
        await pool.query(`INSERT INTO document_events(document_id, action, details) VALUES ($1,'sha256_migrated',$2)`,
          [d.id, JSON.stringify({ demo: true })]);
        fixedHash++;
      }
    }
  }
  if (fixedSig || fixedHash) console.log(`[documents] integrity migration: ${fixedSig} signatures, ${fixedHash} sha256 fixed`);
}

module.exports = { issueDocument, creditDocument, creditSplit, setAllocationNumber, nextDocNumber, KIND_HE, VAT_RATE, signDocument, verifySignature, migrateDocumentIntegrity };

// E12.T2: הנפקה אוטומטית של מסמכים בעת delivered — אידמפוטנטי, לפי סוג העוסק של המכבסה.
// עוסק מורשה: חשבונית עסקה (מע"מ כלול במחיר) + קבלה על התשלום. עוסק פטור: קבלה בלבד.
// ללא dealer_type — לא מונפק כלום (עד השלמת פרטי העוסק, E12.T3).
async function issueDocumentsForOrder(client, { tenant, order, actorId }) {
  if (!tenant.dealer_type) return [];
  if (tenant.invoice_mode === 'consolidated') return []; // במצב חשבונית מרכזת ההפקה ידנית ומרוכזת
  // נעילת שורת ההזמנה — שני מעברי delivered מקבילים מסתדרים ולא מונפק מסמך כפול
  await client.query('SELECT id FROM orders WHERE id=$1 FOR UPDATE', [order.id]);
  const { rows: existing } = await client.query(
    `SELECT id FROM documents WHERE order_id=$1 AND kind<>'credit' LIMIT 1`, [order.id]);
  if (existing.length) return []; // כבר הונפק — לא משכפלים

  const [{ buildDocumentPDF, collectPdf }] = [require('./receipt')];
  const { rows: items } = await client.query('SELECT * FROM order_items WHERE order_id=$1', [order.id]);
  const { rows: cust } = await client.query('SELECT id, name, phone FROM users WHERE id=$1', [order.customer_id]);
  const customer = cust[0] || { id: order.customer_id };
  const total = Number(order.total);
  const issued = [];

  async function issueWithPdf(kind, amount, vat, docTotal) {
    // שלב 1: הקצאת מספר + שורה
    const d = await issueDocument(client, {
      tenant, kind, order, customer, amount, vat, total: docTotal, actorId,
    });
    // שלב 2: PDF מקור — נבנה פעם אחת ונשמר במסמך (pdf נשמר תחת חריגת הטריגר? לא — pdf חלק מהשדות הקפואים,
    // לכן שומרים אותו ישירות בהכנסה הראשונית דרך עדכון מיוחד מטה)
    const codes = await require('./receipt').docVerificationImages(d);
    const pdf = buildDocumentPDF({ doc: d, order, items, tenant, customer, copy: false, codes });
    const buf = await collectPdf(pdf);
    await client.query('UPDATE documents SET pdf=$2, sha256=$3 WHERE id=$1 AND pdf IS NULL', [d.id, buf, crypto.createHash('sha256').update(buf).digest('hex')]);
    return { ...d, pdf: buf };
  }

  if (tenant.dealer_type === 'morasha') {
    const net = Math.round((total / (1 + VAT_RATE)) * 100) / 100;
    const vat = Math.round((total - net) * 100) / 100;
    issued.push(await issueWithPdf('invoice', net, vat, total));
    if (['paid_demo', 'paid_cash'].includes(order.payment_status)) {
      issued.push(await issueWithPdf('receipt', total, 0, total));
    }
  } else if (tenant.dealer_type === 'patur') {
    issued.push(await issueWithPdf('receipt', total, 0, total));
  }
  return issued;
}

module.exports.issueDocumentsForOrder = issueDocumentsForOrder;

// E12.T6: חשבונית מרכזת — מסמך A4 אחד המכסה מספר הזמנות של אותו לקוח.
// orders: [{id, total, created_at}] — כולן delivered, של אותו לקוח ומכבסה, וללא מסמך קודם (מאומת גם ב-SQL).
async function issueConsolidatedInvoice(client, { tenant, customer, orders, actorId }) {
  if (!orders.length) throw { status: 400, error: 'לא נבחרו הזמנות לחשבונית מרכזת' };
  // בדיקת כיסוי כפול תחת נעילה — גם מסמך לפי הזמנה וגם שורת document_orders קיימת חוסמים
  const ids = orders.map(o => o.id);
  const { rows: covered } = await client.query(
    `SELECT o.id FROM orders o WHERE o.id = ANY($1::uuid[]) AND (
       EXISTS (SELECT 1 FROM documents d WHERE d.order_id = o.id AND d.kind <> 'credit') OR
       EXISTS (SELECT 1 FROM document_orders dor WHERE dor.order_id = o.id))`, [ids]);
  if (covered.length) throw { status: 409, error: `להזמנה #${covered[0].id.slice(0, 8)} כבר הונפק מסמך — לא ניתן לכלול אותה בחשבונית מרכזת` };

  const total = Math.round(orders.reduce((sum, o) => sum + Number(o.total), 0) * 100) / 100;
  let amount = total, vat = 0;
  if (tenant.dealer_type === 'morasha') {
    amount = Math.round((total / (1 + VAT_RATE)) * 100) / 100;
    vat = Math.round((total - amount) * 100) / 100;
  }
  const d = await issueDocument(client, {
    tenant, kind: 'consolidated', order: null, customer, amount, vat, total, actorId,
  });
  for (const o of orders) {
    await client.query('INSERT INTO document_orders(document_id, order_id) VALUES ($1,$2)', [d.id, o.id]);
  }
  await audit(client, d.id, 'consolidated_covers', actorId, { orders: ids });
  // שורות פירוט ל-PDF: שורה לכל הזמנה
  const items = orders.map(o => ({
    name: `הזמנה #${o.id.slice(0, 8)} · ${new Date(o.created_at).toLocaleDateString('he-IL')}`,
    qty: 1, price: Number(o.total),
  }));
  const { buildDocumentPDF, collectPdf, docVerificationImages } = require('./receipt');
  const codes = await docVerificationImages(d);
  const pdf = buildDocumentPDF({
    doc: d, order: null, items, codes,
    tenant, customer, copy: false,
    note: orders.length === 1 ? 'חשבונית מרכזת המכסה הזמנה אחת' : `חשבונית מרכזת המכסה ${orders.length} הזמנות`,
  });
  const buf = await collectPdf(pdf);
  await client.query('UPDATE documents SET pdf=$2, sha256=$3 WHERE id=$1 AND pdf IS NULL', [d.id, buf, crypto.createHash('sha256').update(buf).digest('hex')]);
  return { ...d, pdf: buf };
}

module.exports.issueConsolidatedInvoice = issueConsolidatedInvoice;
