// B4: אבטחת העלאות — אימות magic bytes בכל נקודות ההעלאה, חסימת קבצים מתחזים ו-SVG
const { test } = require('node:test');
const assert = require('node:assert');
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres@127.0.0.1:5433/laundry_test';
const { sniff, verifyB64Image } = require('../src/uploads');
const { startApp } = require('./helpers');

// PNG 1x1 שקוף אמיתי (67 בתים)
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//', 'base64');
const PDF = Buffer.from('%PDF-1.4 minimal', 'ascii');
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', 'ascii');
const EXE = Buffer.from('MZ\x90\x00\x03\x00\x00\x00', 'binary');

test('sniff: מזהה jpeg/png/pdf אמיתיים', () => {
  assert.strictEqual(sniff(PNG), 'image/png');
  assert.strictEqual(sniff(JPEG), 'image/jpeg');
  assert.strictEqual(sniff(PDF), 'application/pdf');
});

test('sniff: דוחה SVG, HTML, EXE ותוכן אקראי — גם כשהסיומת מתחזה', () => {
  assert.strictEqual(sniff(SVG), null);
  assert.strictEqual(sniff(Buffer.from('<html><body>x</body></html>')), null);
  assert.strictEqual(sniff(EXE), null);
  assert.strictEqual(sniff(Buffer.from('just some text')), null);
  assert.strictEqual(sniff(Buffer.alloc(0)), null);
});

test('verifyB64Image: מאשר תמונה אמיתית ודוחה תוכן מתחזה או גדול מדי', () => {
  assert.ok(verifyB64Image('image/png', PNG.toString('base64'), 1024));
  assert.strictEqual(verifyB64Image('image/png', SVG.toString('base64'), 1024), null);
  assert.strictEqual(verifyB64Image('image/svg+xml', SVG.toString('base64'), 1024), null);
  assert.strictEqual(verifyB64Image('image/jpeg', PNG.toString('base64'), 1024), null); // סוג מדווח ≠ תוכן
  assert.strictEqual(verifyB64Image('image/png', PNG.toString('base64'), 10), null); // חורג מהמגבלה
});

test('שליח: קובץ מתחזה (סקריפט כ-image/png) נדחה; PNG אמיתי עובר', async (t) => {
  const { base, api } = await startApp(t);
  const token = await api.login('+972500000777', 'שליח בדיקה');
  const post = async (fileBuf, fileName) => {
    const fd = new FormData();
    fd.set('vehicle', 'אופניים');
    fd.set('areas', 'תל אביב');
    fd.set('license', new Blob([fileBuf], { type: 'image/png' }), fileName);
    const r = await fetch(base + '/api/courier/register', {
      method: 'POST', headers: { authorization: 'Bearer ' + token }, body: fd,
    });
    return { status: r.status, json: await r.json().catch(() => null) };
  };
  const bad = await post(SVG, 'license.png'); // SVG שמדווח כ-PNG
  assert.strictEqual(bad.status, 400, JSON.stringify(bad.json));
  assert.match(bad.json.error, /תוכן הקובץ/);
  const good = await post(PNG, 'license.png');
  assert.ok([200, 201].includes(good.status), JSON.stringify(good.json));
});
