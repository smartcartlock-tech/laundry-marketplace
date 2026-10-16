// E11.T2: ניטרול נוסחאות ב-CSV — מחרוזות מסוכנות מנוטרלות, מספרים תקינים (כולל שליליים) לא
const test = require('node:test');
const assert = require('node:assert');
const { toCsv } = require('../src/csv');

test('csv: מספר שלילי לא מנוטרל, נוסחה מנוטרלת', () => {
  const csv = toCsv([['-8.47', '=cmd', '+5', '@x', '-abc', '42', '0.5', 'שם רגיל']]);
  const line = csv.replace(/^﻿/, '');
  const cells = line.split(',');
  assert.strictEqual(cells[0], '-8.47', 'מספר שלילי נשאר מספר');
  assert.strictEqual(cells[1], "'=cmd", 'נוסחה מנוטרלת');
  assert.strictEqual(cells[2], "'+5", 'פלוס מוביל מנוטרל (לא ייצוג מספרי תקני)');
  assert.strictEqual(cells[3], "'@x", '@ מנוטרל');
  assert.strictEqual(cells[4], "'-abc", 'מינוס לא מספרי מנוטרל');
  assert.strictEqual(cells[5], '42');
  assert.strictEqual(cells[6], '0.5');
  assert.strictEqual(cells[7], 'שם רגיל');
});

test('csv: BOM, ציטוט פסיקים וגרשיים לא נפגעו', () => {
  const csv = toCsv([['עם,פסיק', 'עם "גרשיים"', -10]]);
  assert.ok(csv.charCodeAt(0) === 0xFEFF, 'BOM');
  assert.match(csv, /"עם,פסיק"/);
  assert.match(csv, /"עם ""גרשיים"""/);
  assert.match(csv, /,-10$/, 'מספר שלילי כערך מספרי');
});
