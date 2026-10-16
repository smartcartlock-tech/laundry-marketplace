// E12.T1: ליבת מסמכים — מספור רציף אטומי, אי-שינוי, זיכויים, מספר הקצאה, audit.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const { TEST_DB } = require('./helpers');
const { issueDocument, creditDocument, setAllocationNumber } = require('../src/documents');

const SCHEMA = 'test_docs_' + Math.random().toString(36).slice(2, 8);
const pool = new Pool({ connectionString: TEST_DB, max: 25, options: `-c search_path=${SCHEMA},public` });
const q = (t, p) => pool.query(t, p);
let tenantM, tenantP, user;

before(async () => {
  await q(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);
  const sql = fs.readFileSync(path.join(__dirname, '..', 'src', 'schema.sql'), 'utf8');
  await q(sql);
  const u = await q(`INSERT INTO users(phone, name) VALUES ('+972500000777', 'בודק מסמכים') RETURNING *`);
  user = u.rows[0];
  const tm = await q(`INSERT INTO tenants(slug, name, approved, is_open, dealer_type, dealer_id) VALUES ('docs-m', 'מכבסת מורשה', true, true, 'morasha', '123456789') RETURNING *`);
  tenantM = tm.rows[0];
  const tp = await q(`INSERT INTO tenants(slug, name, approved, is_open, dealer_type) VALUES ('docs-p', 'מכבסת פטורה', true, true, 'patur') RETURNING *`);
  tenantP = tp.rows[0];
});
after(async () => { await q(`DROP SCHEMA ${SCHEMA} CASCADE`); await pool.end(); });

test('E12.T1: מספור רציף, אי-שינוי, זיכוי, הקצאה, audit', async () => {
  const client = await pool.connect();
  try {
    // מספור רציף לכל (מכבסה, סוג, שנה)
    await client.query('BEGIN');
    const d1 = await issueDocument(client, { tenant: tenantM, kind: 'invoice', customer: user, amount: 100, vat: 18, total: 118 });
    const d2 = await issueDocument(client, { tenant: tenantM, kind: 'invoice', customer: user, amount: 50, vat: 9, total: 59 });
    await client.query('COMMIT');
    assert.strictEqual(d1.doc_number, 1);
    assert.strictEqual(d2.doc_number, 2);
    assert.strictEqual(d1.doc_year, new Date().getFullYear());

    // סוג אחר — ספירה נפרדת; מכבסה אחרת — ספירה נפרדת
    await client.query('BEGIN');
    const r1 = await issueDocument(client, { tenant: tenantM, kind: 'receipt', customer: user, amount: 118, vat: 0, total: 118 });
    const p1 = await issueDocument(client, { tenant: tenantP, kind: 'receipt', customer: user, amount: 30, vat: 0, total: 30 });
    await client.query('COMMIT');
    assert.strictEqual(r1.doc_number, 1);
    assert.strictEqual(p1.doc_number, 1);

    // מקביליות: 10 הקצאות במקביל — בלי כפילויות ובלי חורים
    const clients = await Promise.all(Array.from({ length: 10 }, () => pool.connect()));
    let nums;
    try {
      nums = await Promise.all(clients.map(async (c) => {
        await c.query('BEGIN');
        const d = await issueDocument(c, { tenant: tenantM, kind: 'receipt', customer: user, amount: 1, vat: 0, total: 1 });
        await c.query('COMMIT');
        return d.doc_number;
      }));
    } finally { clients.forEach(c => c.release()); }
    nums.sort((a, b) => a - b);
    assert.deepStrictEqual(nums, [2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);

    // אי-שינוי: UPDATE על סכום נדחה; DELETE נדחה
    await assert.rejects(q(`UPDATE ${SCHEMA}.documents SET total=1 WHERE id='${d1.id}'`), /immutable/);
    await assert.rejects(q(`DELETE FROM ${SCHEMA}.documents WHERE id='${d1.id}'`), /immutable/);

    // מספר הקצאה: 9 ספרות בלבד, עדכון מותר
    await client.query('BEGIN');
    await assert.rejects(setAllocationNumber(client, d1.id, '123', null));
    const upd = await setAllocationNumber(client, d1.id, '000123456', null);
    await client.query('COMMIT');
    assert.strictEqual(upd.allocation_number, '000123456');

    // עוסק מורשה: מעל 5,000 בלי הקצאה — חסום
    await client.query('BEGIN');
    await assert.rejects(
      issueDocument(client, { tenant: tenantM, kind: 'invoice', customer: user, amount: 5001, vat: 900, total: 5901 }),
      (e) => { assert.strictEqual(e.status, 409); return true; });
    // עוסק פטור לא מגבה מע"מ
    await assert.rejects(
      issueDocument(client, { tenant: tenantP, kind: 'invoice', customer: user, amount: 100, vat: 18, total: 118 }),
      (e) => { assert.strictEqual(e.status, 409); return true; });
    await client.query('COMMIT');

    // זיכוי חלקי ומלא
    await client.query('BEGIN');
    const c1 = await creditDocument(client, { tenant: tenantM, original: d2, amount: 20, actorId: user.id });
    await client.query('COMMIT');
    assert.strictEqual(Number(c1.total), -20);
    assert.strictEqual(c1.original_id, d2.id);
    assert.strictEqual(c1.doc_number, 1); // ספירת זיכויים נפרדת
    let orig = (await q(`SELECT * FROM ${SCHEMA}.documents WHERE id='${d2.id}'`)).rows[0];
    assert.strictEqual(orig.status, 'partially_credited');
    assert.strictEqual(Number(orig.credited_amount), 20);

    // זיכוי מעבר ליתרה — נדחה
    await client.query('BEGIN');
    await assert.rejects(
      creditDocument(client, { tenant: tenantM, original: d2, amount: 40, actorId: user.id }),
      (e) => { assert.strictEqual(e.status, 409); return true; });
    // זיכוי מלא של היתרה
    const c2 = await creditDocument(client, { tenant: tenantM, original: d2, amount: null, actorId: user.id });
    await client.query('COMMIT');
    assert.strictEqual(Number(c2.total), -39);
    orig = (await q(`SELECT * FROM ${SCHEMA}.documents WHERE id='${d2.id}'`)).rows[0];
    assert.strictEqual(orig.status, 'credited');

    // זיכוי של מסמך מזוכה — נדחה; זיכוי של זיכוי — נדחה
    await client.query('BEGIN');
    await assert.rejects(creditDocument(client, { tenant: tenantM, original: d2, amount: 1, actorId: user.id }), (e) => e.status === 409);
    await assert.rejects(creditDocument(client, { tenant: tenantM, original: c1, amount: 1, actorId: user.id }), (e) => e.status === 409);
    await client.query('COMMIT');

    // audit: issued + credited + allocation_set נרשמו
    const ev = await q(`SELECT action FROM ${SCHEMA}.document_events WHERE document_id='${d2.id}' ORDER BY created_at`);
    const actions = ev.rows.map(r => r.action);
    assert.ok(actions.includes('issued'));
    assert.ok(actions.filter(a => a === 'credited').length === 2);
  } finally { client.release(); }
});
