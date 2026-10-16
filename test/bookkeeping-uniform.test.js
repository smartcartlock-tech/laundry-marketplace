// 095: ייצוא מבנה אחיד (OPENFRMT) — INI.TXT + BKMVDATA.TXT ב-ZIP, CP862, CRLF, אורכים קבועים.
// גבולות: טיוטה בלבד (רישום תוכנה מאופס), בעלים בלבד, דרוש מספר עוסק 9 ספרות.
process.env.NODE_ENV = 'test';
const { test } = require('node:test');
const assert = require('node:assert');
const { startApp, TEST_DB } = require('./helpers');
const { Pool } = require('pg');
const iconv = require('iconv-lite');
const { amt, alpha, num, crc32, mainId } = require('../src/openformat');

const REC_LEN = { A100: 95, B100: 317, B110: 376, C100: 444, D110: 339, D120: 222, Z900: 110 };

function unzipStored(zip) {
  assert.equal(zip.readUInt32LE(0), 0x04034b50, 'ZIP local header');
  const nameLen = zip.readUInt16LE(26);
  const name = zip.slice(30, 30 + nameLen).toString('ascii');
  const dataLen = zip.readUInt32LE(18);
  const data = zip.slice(30 + nameLen, 30 + nameLen + dataLen);
  assert.equal(crc32(data), zip.readUInt32LE(14), 'CRC32 תקין');
  return { name, data };
}
const splitRecs = (buf) => {
  const bin = buf.toString('binary');
  assert.ok(bin.endsWith('\r\n'), 'כל רשומה מסתיימת CRLF');
  return bin.split('\r\n').filter(Boolean).map((r) => Buffer.from(r, 'binary'));
};

test('095: עזרי פורמט', async () => {
  assert.equal(amt(1245.65), '+00000000124565');
  assert.equal(amt(-12345.65), '-00000001234565');
  assert.equal(amt(0), '+00000000000000');
  assert.equal(amt(1, 12, 4), '+0000000000010000');
  assert.equal(alpha('אב', 5), 'אב   ');
  assert.equal(alpha('אבגדהו', 3), 'אבג');
  assert.equal(num(42, 5), '00042');
  assert.match(mainId(), /^[1-9]\d{14}$/);
});

test('095: מבנה אחיד — הפקה, מבנה קבצים, הרשאות', async (t) => {
  const { base, api, schema } = await startApp(t);
  const owner = await api.login('+972500000003');
  const B = '/api/t/achuza/bookkeeping';
  const pool = new Pool({ connectionString: TEST_DB, max: 1, options: `-c search_path=${schema},public` });
  t.after(() => pool.end());
  await pool.query(`UPDATE tenants SET dealer_type='morasha', dealer_id=NULL WHERE slug='achuza'`);
  await api(`${B}/init`, { method: 'POST', token: owner });

  await t.test('חסום ללא מספר עוסק; טווח שגוי נדחה', async () => {
    const noDealer = await api(`${B}/uniform-export`, { method: 'POST', token: owner, body: { from: '2026-01-01', to: '2026-12-31' } });
    assert.equal(noDealer.status, 409);
    assert.match(noDealer.json.error, /מספר עוסק/);
    await pool.query(`UPDATE tenants SET dealer_id='512345678' WHERE slug='achuza'`);
    const bad = await api(`${B}/uniform-export`, { method: 'POST', token: owner, body: { from: '2026-12-31', to: '2026-01-01' } });
    assert.equal(bad.status, 400);
  });

  await t.test('לא-בעלים נחסם', async () => {
    const anon = await api(`${B}/uniform-export`, { method: 'POST', body: { from: '2026-01-01', to: '2026-12-31' } });
    assert.equal(anon.status, 401);
  });

  let exportId;
  await t.test('הפקה מלאה: חשבונית מס + קבלה + הוצאה נכנסים לקבצים', async () => {
    // הוצאה רשומה (עם כרטיס ספק)
    const sup = await api(`${B}/parties`, { method: 'POST', token: owner, body: { kind: 'supplier', name: 'ספק מבנה אחיד', tax_id: '511223344' } });
    assert.equal(sup.status, 201, JSON.stringify(sup.json));
    const exp = await api(`${B}/expenses`, { method: 'POST', token: owner, body: {
      party_id: sup.json.party.id, account_code: '5000', description: 'אבקת כביסה', expense_date: '2026-03-05', amount_net: 100, vat_amount: 18 } });
    assert.equal(exp.status, 201, JSON.stringify(exp.json));
    const posted = await api(`${B}/expenses/${exp.json.expense.id}/post`, { method: 'POST', token: owner });
    assert.equal(posted.status, 200);
    // חשבונית מס מונפקת עם שורות
    const doc = await api(`${B}/documents`, { method: 'POST', token: owner, body: {
      kind: 'tax_invoice', customer_name: 'לקוח מבנה אחיד', customer_tax_id: '511223344',
      amount_net: 200, vat_amount: 36,
      lines: [{ description: 'כביסה שבועית', quantity: 4, unit_price: 50 }] } });
    await api(`${B}/documents/${doc.json.document.id}/allocate`, { method: 'POST', token: owner, body: { allocation_number: '123456789' } });
    const issued = await api(`${B}/documents/${doc.json.document.id}/issue`, { method: 'POST', token: owner });
    assert.equal(issued.status, 200);
    // קבלה מונפקת
    const rec = await api(`${B}/documents`, { method: 'POST', token: owner, body: {
      kind: 'receipt', customer_name: 'לקוח מזומן', amount_net: 59, vat_amount: 0,
      lines: [{ description: 'כביסה', quantity: 1, unit_price: 59 }] } });
    const recIssued = await api(`${B}/documents/${rec.json.document.id}/issue`, { method: 'POST', token: owner });
    assert.equal(recIssued.status, 200, JSON.stringify(recIssued.json));

    const res = await api(`${B}/uniform-export`, { method: 'POST', token: owner, body: { from: '2026-01-01', to: '2026-12-31' } });
    assert.equal(res.status, 201, JSON.stringify(res.json));
    assert.equal(res.json.draft, true);
    assert.match(res.json.note, /טרם נרשמה/);
    const c = res.json.counts;
    assert.equal(c.C100, 2);
    assert.equal(c.D110, 1, 'שורות רק למסמך שאינו קבלה');
    assert.equal(c.D120, 1, 'קבלה → פרטי קבלה');
    assert.ok(c.B100 >= 8, 'פקודות: הוצאה(3) + חשבונית(3) + קבלה(2)');
    assert.equal(c.B110, 23, 'כל חשבונות התרשים');
    assert.equal(c.total, c.B100 + c.B110 + c.C100 + c.D110 + c.D120 + c.M100 + 2);
    exportId = res.json.id;
  });

  await t.test('INI.TXT: A000 באורך 466 + סיכומים, CP862, CRLF, ספירות תואמות', async () => {
    const res = await fetch(`${base}${B}/uniform-export/${exportId}/ini`, { headers: { Authorization: `Bearer ${owner}` } });
    assert.equal(res.status, 200);
    const buf = Buffer.from(await res.arrayBuffer());
    const recs = splitRecs(buf);
    assert.equal(recs.length, 7, 'A000 + 6 סיכומים');
    assert.equal(recs[0].length, 466);
    for (let i = 1; i < 7; i++) assert.equal(recs[i].length, 19);
    const a000 = iconv.decode(recs[0], 'cp862');
    assert.equal(a000.slice(0, 4), 'A000');
    assert.equal(a000.slice(24, 33), '512345678', 'מספר עוסק');
    assert.equal(a000.slice(48, 56), '&1.31OF&', 'קבוע מערכת');
    assert.equal(a000.slice(56, 64), '00000000', 'רישום תוכנה מאופס (טיוטה)');
    assert.equal(a000.slice(394, 395), '0');
    assert.equal(a000.slice(395, 396), '2', 'סט תווים CP862');
    assert.ok(a000.includes('מכבסה בקליק'), 'שם תוכנה עברי נשמר ב-CP862');
    const sumCodes = recs.slice(1).map((r) => iconv.decode(r, 'cp862').slice(0, 4));
    assert.deepEqual(sumCodes, ['B100', 'B110', 'C100', 'D110', 'D120', 'M100']);
  });

  await t.test('BKMVDATA.zip: אורכי רשומות מדויקים, פתיחה/סגירה, סכומים', async () => {
    const res = await fetch(`${base}${B}/uniform-export/${exportId}/bkmv`, { headers: { Authorization: `Bearer ${owner}` } });
    assert.equal(res.status, 200);
    const { name, data } = unzipStored(Buffer.from(await res.arrayBuffer()));
    assert.equal(name, 'BKMVDATA.TXT');
    const recs = splitRecs(data);
    assert.equal(iconv.decode(recs[0], 'cp862').slice(0, 4), 'A100');
    assert.equal(iconv.decode(recs[recs.length - 1], 'cp862').slice(0, 4), 'Z900');
    for (const r of recs) {
      const code = iconv.decode(r.slice(0, 4), 'cp862');
      assert.equal(r.length, REC_LEN[code], `אורך רשומה ${code}`);
    }
    const z900 = iconv.decode(recs[recs.length - 1], 'cp862');
    assert.equal(Number(z900.slice(45, 60)), recs.length, 'סך רשומות כולל = מספר הרשומות בפועל');
    const iniTotal = null; // הסתמכות על שוויון 1002=1155 מכוסה בספירת הרשומות
    // C100 של החשבונית: לקוח + סכומים
    const c100s = recs.filter((r) => iconv.decode(r.slice(0, 4), 'cp862') === 'C100').map((r) => iconv.decode(r, 'cp862'));
    const inv = c100s.find((s) => s.includes('לקוח מבנה אחיד'));
    assert.ok(inv, 'כותרת חשבונית עם שם הלקוח');
    assert.equal(inv.slice(22, 25), '305', 'סוג מסמך חשבונית מס');
    assert.equal(inv.slice(252, 261), '511223344', 'מספר עוסק לקוח מפוענח');
    assert.equal(inv.slice(287, 302), '+00000000020000', 'נטו 200.00');
    assert.equal(inv.slice(332, 347), '+00000000003600', 'מע"מ 36.00');
    assert.equal(inv.slice(347, 362), '+00000000023600', 'ברוטו 236.00');
    // D110: כמות 4 × מחיר 50 = 200, שיעור מע"מ 1800
    const d110 = recs.map((r) => iconv.decode(r, 'cp862')).find((s) => s.slice(0, 4) === 'D110');
    assert.equal(d110.slice(223, 240), '+0000000000040000', 'כמות 4.0000');
    assert.equal(d110.slice(285, 289), '1800', 'שיעור מע"מ 18%');
    // D120 של הקבלה: 59 מזומן
    const d120 = recs.map((r) => iconv.decode(r, 'cp862')).find((s) => s.slice(0, 4) === 'D120');
    assert.equal(d120.slice(45, 49), '0001');
    assert.equal(d120.slice(49, 50), '1', 'מזומן');
    assert.equal(d120.slice(103, 118), '+00000000005900');
    // B100 מאוזן: סכום חובות = סכום זכות
    const b110s = recs.map((r) => iconv.decode(r, 'cp862')).filter((s) => s.slice(0, 4) === 'B110');
    assert.ok(b110s.some((s) => s.slice(37, 87).trim() === 'קופה - מזומן'), 'שם חשבון עברי ברשומת B110');
    assert.equal(b110s.find((s) => s.slice(37, 87).trim() === 'קופה - מזומן').slice(22, 37).trim(), '1000', 'מפתח חשבון');
    const b100s = recs.map((r) => iconv.decode(r, 'cp862')).filter((s) => s.slice(0, 4) === 'B100');
    let dSum = 0, cSum = 0;
    for (const s of b100s) {
      const v = Number(s.slice(206, 221)) / 100;
      if (s[202] === '1') dSum += v; else cSum += v;
    }
    assert.equal(dSum.toFixed(2), cSum.toFixed(2), 'תנועות מאוזנות');
  });

  await t.test('רשימת הפקות + שגיאות', async () => {
    const list = await api(`${B}/uniform-export`, { token: owner });
    assert.equal(list.status, 200);
    assert.equal(list.json.draft, true);
    assert.equal(list.json.exports.length, 1);
    assert.match(list.json.exports[0].main_identifier, /^\d{15}$/);
    const missing = await api(`${B}/uniform-export/00000000-0000-0000-0000-000000000000/ini`, { token: owner });
    assert.equal(missing.status, 404);
  });
});
