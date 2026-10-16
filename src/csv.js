// E11.T2: ייצוא CSV עם BOM כדי שעברית תיפתח תקין ב-Excel
function escCell(v) {
  let s = String(v ?? '');
  // ניטרול הזרקת נוסחאות ב-Excel/Sheets: תא שמתחיל ב-= + - @ מקבל קידומת גרש,
  // למעט מחרוזת שהיא מספר תקין (שלילי/עשרוני) — נשארת מספר כדי שסיכומי Excel לא יישברו
  if (/^[=+\-@]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function toCsv(rows) {
  return '﻿' + rows.map(r => r.map(escCell).join(',')).join('\r\n');
}
function sendCsv(res, filename, rows) {
  res.setHeader('content-type', 'text/csv; charset=utf-8');
  res.setHeader('content-disposition', `attachment; filename="${filename}"`);
  res.send(toCsv(rows));
}
module.exports = { toCsv, sendCsv };
