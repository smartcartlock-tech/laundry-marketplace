// E12.T4: "המסמכים שלי" — לקוח רואה רק מסמכים שלו; PDF מוגן בהרשאת בעלות.
// ה-API קיים (routes/documents.js: /mine + /:id/pdf) — הבדיקה נועלת את תכונת הבידוד.
process.env.NODE_ENV = 'test';
const { test } = require('node:test');
const assert = require('node:assert');
const { startApp, TEST_DB } = require('./helpers');
const { Pool } = require('pg');

test('E12.T4: בידוד מסמכי לקוח — רשימה ו-PDF', async (t) => {
  const { base, api, schema } = await startApp(t);
  const userA = await api.login('+972500000401', 'לקוח א');
  const userB = await api.login('+972500000402', 'לקוח ב');
  const pool = new Pool({ connectionString: TEST_DB, max: 1, options: `-c search_path=${schema},public` });
  t.after(() => pool.end());

  const { rows: [ten] } = await pool.query(`SELECT id FROM tenants WHERE slug='achuza'`);
  const { rows: [ua] } = await pool.query(`SELECT id FROM users WHERE phone='+972500000401'`);
  const { rows: [doc] } = await pool.query(
    `INSERT INTO documents (tenant_id, customer_id, kind, doc_year, doc_number, amount, vat, total)
     VALUES ($1, $2, 'receipt', 2026, 9999, 100, 0, 100) RETURNING id`, [ten.id, ua.id]);

  await t.test('הלקוח רואה את המסמך שלו ברשימה', async () => {
    const mine = await api('/api/documents/mine', { token: userA });
    assert.equal(mine.status, 200);
    const found = mine.json.documents.find((d) => d.id === doc.id || (d.doc_year === 2026 && d.doc_number === 9999));
    assert.ok(found, 'המסמך נמצא אצל הבעלים');
    assert.equal(found.total, 100);
  });

  await t.test('לקוח אחר לא רואה את המסמך — לא ברשימה ולא ב-PDF', async () => {
    const mineB = await api('/api/documents/mine', { token: userB });
    assert.equal(mineB.status, 200);
    assert.ok(!mineB.json.documents.some((d) => d.doc_year === 2026 && d.doc_number === 9999), 'לא דלף לרשימה של משתמש אחר');
    const pdfB = await api(`/api/documents/${doc.id}/pdf`, { token: userB });
    assert.equal(pdfB.status, 403);
  });

  await t.test('הבעלים מקבל PDF תקין; אורח נדחה', async () => {
    const r = await fetch(`${base}/api/documents/${doc.id}/pdf`, { headers: { Authorization: 'Bearer ' + userA } });
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /application\/pdf/);
    const buf = Buffer.from(await r.arrayBuffer());
    assert.ok(buf.length > 500 && buf.slice(0, 5).toString() === '%PDF-', 'PDF אמיתי');
    const anon = await api(`/api/documents/${doc.id}/pdf`, {});
    assert.equal(anon.status, 401);
  });
});
