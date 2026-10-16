// 091: הוצאות וספקים — טיוטה/רישום/ביטול, מע"מ תשומות למורשה בלבד, קובץ חשבונית ספק (magic bytes).
process.env.NODE_ENV = 'test';
const { test } = require('node:test');
const assert = require('node:assert');
const { startApp, TEST_DB } = require('./helpers');
const { Pool } = require('pg');

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');

test('091: הוצאות וספקים + קבצים', async (t) => {
  const { api, base, schema } = await startApp(t);
  const owner = await api.login('+972500000003');
  const B = '/api/t/achuza/bookkeeping';
  const pool = new Pool({ connectionString: TEST_DB, max: 1, options: `-c search_path=${schema},public` });
  await pool.query(`UPDATE tenants SET dealer_type='morasha' WHERE slug='achuza'`);
  await api(`${B}/init`, { method: 'POST', token: owner });
  const sup = await api(`${B}/parties`, { method: 'POST', token: owner, body: { kind: 'supplier', name: 'ספק בדיקה בע"מ', tax_id: '511223344' } });
  const pid = sup.json.party.id;

  let draftId;
  await t.test('טיוטת הוצאה נוצרת ואינה נרשמת בספר', async () => {
    const res = await api(`${B}/expenses`, { method: 'POST', token: owner, body: {
      party_id: pid, expense_date: '2026-10-05', description: 'חומרי ניקוי', account_code: '5000', amount_net: 100, vat_amount: 18 } });
    assert.equal(res.status, 201, JSON.stringify(res.json));
    draftId = res.json.expense.id;
    assert.equal(res.json.expense.status, 'draft');
    const tb = await api(`${B}/trial-balance`, { token: owner });
    assert.equal(tb.json.totals.debit, '0.00'); // טיוטה לא בשולמה לספר
  });

  await t.test('רישום (post): חובה הוצאה + מע"מ תשומות / זכות ספקים', async () => {
    const res = await api(`${B}/expenses/${draftId}/post`, { method: 'POST', token: owner });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const tb = await api(`${B}/trial-balance`, { token: owner });
    assert.equal(tb.json.totals.balanced, true);
    const exp = tb.json.accounts.find(a => a.code === '5000');
    const vat = tb.json.accounts.find(a => a.code === '2020');
    const sup2 = tb.json.accounts.find(a => a.code === '2000');
    assert.equal(exp.debit, '100.00');
    assert.equal(vat.debit, '18.00');
    assert.equal(sup2.credit, '118.00');
    // post כפול נחסם
    const again = await api(`${B}/expenses/${draftId}/post`, { method: 'POST', token: owner });
    assert.equal(again.status, 409);
  });

  await t.test('ביטול הוצאה רשומה יוצר סטורנו ומאפס את ההשפעה', async () => {
    const res = await api(`${B}/expenses/${draftId}/void`, { method: 'POST', token: owner });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal(res.json.from, 'posted');
    const tb = await api(`${B}/trial-balance`, { token: owner });
    assert.equal(tb.json.totals.balanced, true);
    const exp = tb.json.accounts.find(a => a.code === '5000');
    assert.equal(Number(exp.debit) - Number(exp.credit), 0); // נטו אפס
  });

  await t.test('העלאת קובץ PDF + הורדה; קובץ מזויף נדחה', async () => {
    const fd = new FormData();
    fd.append('party_id', pid);
    fd.append('expense_date', '2026-10-06');
    fd.append('description', 'חשבונית חשמל');
    fd.append('account_code', '5020');
    fd.append('amount_net', '200');
    fd.append('vat_amount', '0');
    fd.append('invoice', new Blob([PDF], { type: 'application/pdf' }), 'hashmal.pdf');
    const up = await fetch(base + B + '/expenses', { method: 'POST', headers: { authorization: 'Bearer ' + owner }, body: fd });
    assert.equal(up.status, 201);
    const created = (await up.json()).expense;
    assert.equal(created.has_file, true);

    const dl = await fetch(base + B + `/expenses/${created.id}/file`, { headers: { authorization: 'Bearer ' + owner } });
    assert.equal(dl.status, 200);
    assert.equal(dl.headers.get('content-type'), 'application/pdf');
    const buf = Buffer.from(await dl.arrayBuffer());
    assert.deepEqual(buf.subarray(0, 5), PDF.subarray(0, 5));

    // TXT מוצג כ-PDF — נדחה ב-sniff
    const fd2 = new FormData();
    for (const [k, v] of [['party_id', pid], ['expense_date', '2026-10-06'], ['description', 'x'], ['account_code', '5020'], ['amount_net', '1']]) fd2.append(k, v);
    fd2.append('invoice', new Blob([Buffer.from('not a pdf')], { type: 'application/pdf' }), 'fake.pdf');
    const bad = await fetch(base + B + '/expenses', { method: 'POST', headers: { authorization: 'Bearer ' + owner }, body: fd2 });
    assert.equal(bad.status, 400);
  });

  await t.test('עוסק פטור: מע"מ תשומות נדחה', async () => {
    const { rows: exp } = await pool.query(`SELECT id FROM tenants WHERE slug='express'`);
    const { rows: usr } = await pool.query(`SELECT id FROM users WHERE phone='+972500000003'`);
    await pool.query(`INSERT INTO tenant_members(tenant_id, user_id, role) VALUES ($1,$2,'owner') ON CONFLICT DO NOTHING`, [exp[0].id, usr[0].id]);
    await pool.query(`UPDATE tenants SET dealer_type='patur' WHERE slug='express'`);
    const E = '/api/t/express/bookkeeping';
    await api(`${E}/init`, { method: 'POST', token: owner });
    const sup2 = await api(`${E}/parties`, { method: 'POST', token: owner, body: { kind: 'supplier', name: 'ספק פטור' } });
    const res = await api(`${E}/expenses`, { method: 'POST', token: owner, body: {
      party_id: sup2.json.party.id, expense_date: '2026-10-05', description: 'בדיקה', account_code: '5000', amount_net: 100, vat_amount: 18 } });
    assert.equal(res.status, 400);
    assert.match(res.json.error, /אינו מנכה/);
  });
});
