// הפקת קבצים במבנה אחיד (OPENFRMT) לפי "הוראות להפקת קבצים במבנה אחיד", חטיבת שומה וביקורת, גרסה 1.31.
// מקור: gov.il — horaot-131.pdf. קידוד CP-862 (DOS, שדה 1029=2), סיומת שורה CRLF, אורכי רשומות קבועים.
// גבולות: שדה 1006 (רישום תוכנה) ושדות היצרן מאופסים — התוכנה טרם נרשמה ברשות; ההפקה מסומנת טיוטה.
// אין כאן שום קריאה לרשות המסים — יצירת קבצים מקומית בלבד.
const iconv = require('iconv-lite');
const crypto = require('crypto');

const CONST_SYS = '&1.31OF&'; // קבוע מערכת (שדות 1005/1104/1154)
const CRLF = Buffer.from([13, 10]);

// --- עזרי פורמט לפי סעיף 2.3 ---
// אלפאנומרי: מיושר שמאל, מילוי רווחים מימין. רק תווים שניתן לקודד ב-CP862 (ASCII + עברית); אחרים → רווח.
function alpha(s, len) {
  let t = String(s == null ? '' : s).replace(/[\r\n\t]/g, ' ');
  t = [...t].map((c) => (c >= ' ' && c <= '~') || (c >= 'א' && c <= 'ת') ? c : ' ').join('');
  if (t.length > len) t = t.slice(0, len);
  return t + ' '.repeat(len - t.length);
}
// נומרי: ספרות בלבד, אפסים מובילים משמאל
function num(v, len) {
  const s = String(v == null ? 0 : v).replace(/\D/g, '');
  if (s.length > len) throw new Error(`שדה נומרי חורג: ${s} > ${len} ספרות`);
  return s.padStart(len, '0');
}
// סכום אלפאנומרי: 9(int)V99 כולל סימן, בלי נקודה. לדוגמה 1245.65 → "+00000000124565" (9(12)V99)
function amt(v, intDigits = 12, decDigits = 2) {
  const n = Number(v) || 0;
  const scaled = Math.round(Math.abs(n) * 10 ** decDigits);
  const s = String(scaled).padStart(intDigits + decDigits, '0');
  if (s.length > intDigits + decDigits) throw new Error(`סכום חורג משדה: ${v}`);
  return (n < 0 ? '-' : '+') + s;
}
// תאריך YYYYMMDD מ-'YYYY-MM-DD' / Date / null → אפסים
function ymd(d) {
  if (!d) return '00000000';
  const s = d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
  const out = s.replace(/-/g, '');
  return /^\d{8}$/.test(out) ? out : '00000000';
}
function hhmm(d) {
  if (!(d instanceof Date)) return '0000';
  return String(d.getUTCHours()).padStart(2, '0') + String(d.getUTCMinutes()).padStart(2, '0');
}

// מזהה ראשי: 15 ספרות רנדומליות, ייחודי לכל הפקה (סעיף 2.4א + הבהרה 2)
function mainId() {
  let s = String(crypto.randomInt(1, 10)); // ספרה ראשונה לא אפס
  for (let i = 0; i < 14; i++) s += String(crypto.randomInt(0, 10));
  return s;
}

// --- ZIP באחסון STORE (ללא דחיסה) — סעיף 2.2ד: BKMVDATA.TXT מכווץ לארכיב בשם BKMVDATA ---
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function zipStore(name, data) {
  const nameBuf = Buffer.from(name, 'ascii');
  const crc = crc32(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);           // version needed
  local.writeUInt16LE(0x0800, 6);       // UTF-8 flag לא נחוץ (שם ASCII) — 0
  local.writeUInt16LE(0, 6);
  local.writeUInt16LE(0, 8);            // method 0 = STORE
  local.writeUInt16LE(0, 10);           // time
  local.writeUInt16LE(0x21, 12);        // date (1980-01-01)
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18); // compressed = uncompressed
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  local.writeUInt16LE(0, 28);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 8);
  central.writeUInt16LE(0, 10);
  central.writeUInt16LE(0, 12);
  central.writeUInt16LE(0x21, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt32LE(0, 42);         // offset of local header
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(46 + nameBuf.length, 12);
  eocd.writeUInt32LE(30 + nameBuf.length + data.length, 16);
  return Buffer.concat([local, nameBuf, data, central, nameBuf, eocd]);
}

// --- סוגי מסמכים (נספח 1) ---
const DOC_TYPES = { invoice: '300', tax_invoice: '305', tax_invoice_receipt: '320', receipt: '400' };
const RECEIPT_KINDS = new Set(['receipt', 'tax_invoice_receipt']);
const ENTRY_TYPE_HE = { manual: 'פקודת יומן', invoice: 'חשבונית', expense: 'הוצאה', bank: 'בנק', reversal: 'סטורנו' };

function docNumber(d) { return d.doc_number ? `${d.doc_year}-${d.doc_number}` : ''; }

// --- בניית רשומות (אורכים לפי טבלת הריכוז בסעיף 2.5ה) ---
function check(record, expected, code) {
  if (record.length !== expected) throw new Error(`רשומה ${code}: אורך ${record.length} ≠ ${expected}`);
  return record;
}

// INI.TXT — רשומה תחילית A000 (466 תווים), סעיף 3.1
function recA000(p) {
  return check([
    'A000',                     // 1000
    alpha('', 5),               // 1001 לשימוש עתידי
    num(p.totalRecords, 15),    // 1002 סך רשומות ב-BKMVDATA — זהה ל-1155
    num(p.dealer, 9),           // 1003 מספר עוסק מורשה
    num(p.mainId, 15),          // 1004 מזהה ראשי
    CONST_SYS,                  // 1005
    num(0, 8),                  // 1006 רישום תוכנה — טרם נרשמה (טיוטה)
    alpha('מכבסה בקליק', 20),   // 1007 שם התוכנה
    alpha('1.0', 20),           // 1008 מהדורה
    num(0, 9),                  // 1009 ע"מ יצרן — טרם נרשם (טיוטה)
    alpha('SmartCartLock', 20), // 1010 שם יצרן
    '2',                        // 1011 סוג תוכנה: רב שנתית
    alpha(p.dirPath, 50),       // 1012 נתיב שמירה (סעיף 2.2)
    '2',                        // 1013 הנהח"ש כפולה
    '1',                        // 1014 איזון ברמת התנועה (חובה בכפולה)
    num(0, 9),                  // 1015 ח"פ
    num(0, 9),                  // 1016 תיק ניכויים
    alpha('', 10),              // 1017 עתידי
    alpha(p.bizName, 50),       // 1018 שם העסק
    alpha(p.street, 50),        // 1019 רחוב
    alpha('', 10),              // 1020 מס בית
    alpha(p.city, 30),          // 1021 עיר
    alpha('', 8),               // 1022 מיקוד
    num(0, 4),                  // 1023 שנת מס (חד-שנתית בלבד)
    ymd(p.from),                // 1024 תחילת חתך
    ymd(p.to),                  // 1025 סוף חתך
    ymd(p.now),                 // 1026 תאריך תחילת תהליך
    hhmm(p.nowDate),            // 1027 שעת תחילת תהליך
    '0',                        // 1028 שפה: עברית
    '2',                        // 1029 סט תווים: CP-862
    alpha('ZIP STORE', 20),     // 1030 תוכנת כיווץ
    'ILS',                      // 1032 מטבע מוביל
    '0',                        // 1034 אין סניפים
    alpha('', 46),              // 1035 עתידי
  ].join(''), 466, 'A000');
}
// INI.TXT — רשומת סיכום (19 תווים), סעיף 3.2
function recSummary(code, count) {
  return check(alpha(code, 4) + num(count, 15), 19, code);
}

// BKMVDATA — רשומת פתיחה A100 (95), סעיף 4.1
function recA100(p, recNo) {
  return check(['A100', num(recNo, 9), num(p.dealer, 9), num(p.mainId, 15), CONST_SYS, alpha('', 50)].join(''), 95, 'A100');
}
// רשומת סגירה Z900 (110), סעיף 4.2
function recZ900(p, recNo, total) {
  return check(['Z900', num(recNo, 9), num(p.dealer, 9), num(p.mainId, 15), CONST_SYS, num(total, 15), alpha('', 50)].join(''), 110, 'Z900');
}
// תנועות הנה"ח B100 (317), סעיף 4.6
function recB100(p, recNo, l) {
  return check([
    'B100', num(recNo, 9), num(p.dealer, 9),
    num(l.entryNo, 10),               // 1353 מספר תנועה
    num(l.lineNo, 5),                 // 1354 שורה בתנועה
    num(0, 8),                        // 1355 מנה
    alpha(l.typeHe, 15),              // 1356 סוג תנועה
    alpha(l.ref1 || '', 20),          // 1357 אסמכתא
    num(l.ref1Type || 0, 3),          // 1358 סוג מסמך אסמכתא
    alpha('', 20), num(0, 3),         // 1359-1360 אסמכתא 2
    alpha(l.details, 50),             // 1361 פרטים
    ymd(l.date),                      // 1362 תאריך
    ymd(l.valueDate),                 // 1363 תאריך ערך
    alpha(l.account, 15),             // 1364 חשבון
    alpha('', 15),                    // 1365 חשבון נגדי (חד-צידית בלבד)
    l.side === 'debit' ? '1' : '2',   // 1366 סימן פעולה
    alpha('', 3),                     // 1367 מט"ח
    amt(l.amount),                    // 1368 סכום במטבע מוביל (חיובי תמיד)
    alpha('', 15),                    // 1369 סכום מט"ח
    alpha('', 12),                    // 1370 כמות
    alpha('', 10), alpha('', 10),     // 1371-1372 התאמה
    alpha('', 7),                     // 1374 סניף
    ymd(l.inputDate),                 // 1375 תאריך הזנה
    alpha('', 9),                     // 1376 מבצע
    alpha('', 25),                    // 1377 עתידי
  ].join(''), 317, 'B100');
}
// חשבון בהנה"ח B110 (376), סעיף 4.7
function recB110(p, recNo, a) {
  return check([
    'B110', num(recNo, 9), num(p.dealer, 9),
    alpha(a.code, 15),                // 1403 מפתח חשבון
    alpha(a.name, 50),                // 1404 שם חשבון
    alpha(a.code, 15),                // 1405 קוד מאזן בוחן
    alpha(a.name, 30),                // 1406 תיאור מאזן בוחן
    alpha('', 50), alpha('', 10), alpha('', 30), alpha('', 8), alpha('', 30), alpha('', 2), // 1407-1412 מען
    alpha('', 15),                    // 1413 חשבון מרכז
    amt(a.opening),                   // 1414 יתרה בתחילת חתך (+חובה / -זכות)
    amt(a.debit),                     // 1415 סה"כ חובה בחתך
    amt(a.credit),                    // 1416 סה"כ זכות בחתך
    num(0, 4),                        // 1417 סיווג 6111
    num(0, 9),                        // 1419 עוסק של ספק/לקוח (כרטיס מצטבר — אין)
    alpha('', 7),                     // 1421 סניף
    alpha('', 15), alpha('', 3),      // 1422-1423 מט"ח
    alpha('', 16),                    // 1424 עתידי
  ].join(''), 376, 'B110');
}
// כותרת מסמך C100 (444), סעיף 4.3 — ערכים חיוביים תמיד (סעיף 2.4יב)
function recC100(p, recNo, d, link) {
  return check([
    'C100', num(recNo, 9), num(p.dealer, 9),
    DOC_TYPES[d.kind],                // 1203 סוג מסמך
    alpha(docNumber(d), 20),          // 1204 מספר מסמך
    ymd(d.issue_date),                // 1205 תאריך הפקה
    num(0, 4),                        // 1206 שעת הפקה
    alpha(d.customer_name, 50),       // 1207 לקוח
    alpha('', 50), alpha('', 10), alpha('', 30), alpha('', 8), alpha('', 30), alpha('', 2), // 1208-1213 מען
    alpha('', 15),                    // 1214 טלפון
    num(d.customer_tax_id || 0, 9),   // 1215 עוסק לקוח (מפוענח אם קיים)
    num(0, 8),                        // 1216 תאריך ערך
    alpha('', 15), alpha('', 3),      // 1217-1218 מט"ח
    amt(d.amount_net),                // 1219 סכום לפני הנחה
    amt(0),                           // 1220 הנחת מסמך
    amt(d.amount_net),                // 1221 נטו ללא מע"מ
    amt(d.vat_amount),                // 1222 מע"מ
    amt(Number(d.amount_net) + Number(d.vat_amount)), // 1223 סה"כ כולל מע"מ
    alpha('', 12),                    // 1224 ניכוי במקור
    alpha('1020', 15),                // 1225 מפתח לקוח אצל המוכר (כרטיס לקוחות מצטבר)
    alpha('', 10),                    // 1226 התאמה
    ' ',                              // 1228 מסמך מבוטל (רווח=לא מבוטל; מופקים שהונפקו בלבד)
    ymd(d.issue_date),                // 1230 תאריך המסמך
    alpha('', 7),                     // 1231 סניף
    alpha('', 9),                     // 1233 מבצע
    num(link, 7),                     // 1234 שדה מקשר לשורות (הבהרה 11)
    alpha('', 13),                    // 1235 עתידי
  ].join(''), 444, 'C100');
}
// פרטי מסמך D110 (339), סעיף 4.4
function recD110(p, recNo, d, line, lineNo, link) {
  const qty = Number(line.quantity) || 1;
  return check([
    'D110', num(recNo, 9), num(p.dealer, 9),
    DOC_TYPES[d.kind], alpha(docNumber(d), 20),
    num(lineNo, 4),                   // 1255 שורה במסמך
    num(0, 3), alpha('', 20),         // 1256-1257 מסמך בסיס
    '1',                              // 1258 סוג עסקה: שירות
    alpha('', 20),                    // 1259 מק"ט
    alpha(line.description, 30),      // 1260 תיאור
    alpha('', 50), alpha('', 30),     // 1261-1262 יצרן/סידורי
    alpha('יחידה', 20),               // 1263 יחידת מידה
    amt(qty, 12, 4),                  // 1264 כמות 9(12)V9999
    amt(line.unit_price),             // 1265 מחיר יחידה ללא מע"מ
    amt(0),                           // 1266 הנחת שורה
    amt(qty * Number(line.unit_price)), // 1267 סך שורה
    num(d.vat_rate_x100 || 0, 4),     // 1268 שיעור מע"מ ×100
    alpha('', 7),                     // 1270 סניף
    ymd(d.issue_date),                // 1272 תאריך המסמך
    num(link, 7),                     // 1273 מקשר לכותרת
    alpha('', 7),                     // 1274 סניף מסמך בסיס
    alpha('', 21),                    // 1275 עתידי
  ].join(''), 339, 'D110');
}
// פרטי קבלה D120 (222), סעיף 4.5 — שורה אחת, מזומן (רישום מול קופה 1000)
function recD120(p, recNo, d, link) {
  const total = Number(d.amount_net) + Number(d.vat_amount);
  return check([
    'D120', num(recNo, 9), num(p.dealer, 9),
    DOC_TYPES[d.kind], alpha(docNumber(d), 20),
    num(1, 4),                        // 1305 שורה
    '1',                              // 1306 אמצעי תשלום: מזומן
    num(0, 10), num(0, 10), num(0, 15), num(0, 10), // 1307-1310 המחאה
    num(0, 8),                        // 1311 תאריך פירעון
    amt(total),                       // 1312 סכום השורה
    num(0, 1),                        // 1313 חברה סולקת
    alpha('', 20),                    // 1314 שם כרטיס
    num(0, 1),                        // 1315 סוג עסקת אשראי
    alpha('', 7),                     // 1320 סניף
    ymd(d.issue_date),                // 1322 תאריך המסמך
    num(link, 7),                     // 1323 מקשר לכותרת
    alpha('', 60),                    // 1324 עתידי
  ].join(''), 222, 'D120');
}

// הרכבת שני הקבצים מהנתונים שאספה השכבה העליונה. מחזיר { iniBuf, zipBuf, counts, total }.
function buildFiles(p, data) {
  const bkmv = [];
  let n = 0;
  const counts = { B100: 0, B110: 0, C100: 0, D110: 0, D120: 0, M100: 0 };
  bkmv.push(recA100(p, ++n));
  for (const a of data.accounts) { bkmv.push(recB110(p, ++n, a)); counts.B110++; }
  for (const l of data.lines) { bkmv.push(recB100(p, ++n, l)); counts.B100++; }
  let link = 0;
  for (const d of data.documents) {
    link++;
    bkmv.push(recC100(p, ++n, d, link)); counts.C100++;
    if (RECEIPT_KINDS.has(d.kind)) {
      bkmv.push(recD120(p, ++n, d, link)); counts.D120++;
    } else {
      (d.lines || []).forEach((line, i) => { bkmv.push(recD110(p, ++n, d, line, i + 1, link)); counts.D110++; });
    }
  }
  const total = n + 1; // כולל Z900
  bkmv.push(recZ900(p, ++n, total));

  const ini = [recA000({ ...p, totalRecords: total })];
  for (const [code, c] of Object.entries(counts)) ini.push(recSummary(code, c));

  const encode = (lines) => Buffer.concat(lines.map((l) => Buffer.concat([iconv.encode(l, 'cp862'), CRLF])));
  const iniBuf = encode(ini);
  const bkmvBuf = encode(bkmv);
  return { iniBuf, zipBuf: zipStore('BKMVDATA.TXT', bkmvBuf), counts, total };
}

module.exports = { buildFiles, mainId, alpha, num, amt, ymd, zipStore, crc32, DOC_TYPES };
