// מודול הנה"ח אמיתי: הרשאות בעלים בלבד, איזון ספר כפול, מספור רציף, סטורנו, סגירת תקופה.
process.env.NODE_ENV = 'test';
const { test } = require('node:test');
const assert = require('node:assert');
const { startApp, TEST_DB } = require('./helpers');
const { Pool } = require('pg');

test('bookkeeping: ליבת ספר כפול', async (t) => {
  const { api, schema } = await startApp(t);
  const owner = await api.login('+972500000003'); // בעלים של achuza
  const outsider = await api.login('+972500000099');
  const staff = await api.login('+972500000098');
  const B = '/api/t/achuza/bookkeeping';

  // הוספת staff כחבר צוות (לא בעלים) לטננט — לבדיקת הרשאות בעלים-בלבד
  const pool = new Pool({ connectionString: TEST_DB, max: 1, options: `-c search_path=${schema},public` });
  const { rows: ten } = await pool.query(`SELECT id FROM tenants WHERE slug='achuza'`);
  const { rows: usr } = await pool.query(`SELECT id FROM users WHERE phone='+972500000098'`);
  await pool.query(`INSERT INTO tenant_members(tenant_id, user_id, role) VALUES ($1,$2,'staff') ON CONFLICT DO NOTHING`, [ten[0].id, usr[0].id]);

  await t.test('אנונימי 401, לא־חבר 403, וגם staff נדחה — בעלים בלבד', async () => {
    let res = await api(`${B}/accounts`);
    assert.equal(res.status, 401);
    res = await api(`${B}/accounts`, { token: outsider });
    assert.equal(res.status, 403);
    res = await api(`${B}/accounts`, { token: staff });
    assert.equal(res.status, 403);
    assert.match(res.json.error, /בעלים/);
  });

  await t.test('אתחול תרשים חשבונות idempotent', async () => {
    let res = await api(`${B}/init`, { method: 'POST', token: owner });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal(res.json.accounts, 23);
    const second = await api(`${B}/init`, { method: 'POST', token: owner });
    assert.equal(second.json.inserted, 0); // לא מכפיל
    res = await api(`${B}/accounts`, { token: owner });
    assert.equal(res.json.accounts.length, 23);
    assert.ok(res.json.accounts.some(a => a.code === '2010' && a.name_he.includes('מע"מ')));
  });

  let partyId;
  await t.test('כרטיס ספק', async () => {
    const res = await api(`${B}/parties`, { method: 'POST', token: owner, body: { kind: 'supplier', name: 'א.א חומרי ניקוי בע"מ', tax_id: '511223344' } });
    assert.equal(res.status, 201, JSON.stringify(res.json));
    partyId = res.json.party.id;
    const bad = await api(`${B}/parties`, { method: 'POST', token: owner, body: { kind: 'vendor', name: 'x' } });
    assert.equal(bad.status, 400);
  });

  await t.test('איזון: לא מאוזנת נדחית, מאוזנת ממוספרת ברצף', async () => {
    const unbal = await api(`${B}/entries`, { method: 'POST', token: owner, body: {
      entry_date: '2026-10-01', description: 'בדיקה',
      lines: [{ account_code: '5000', debit: 100 }, { account_code: '1010', credit: 90 }] } });
    assert.equal(unbal.status, 400);
    assert.match(unbal.json.error, /לא מאוזנת/);

    const one = await api(`${B}/entries`, { method: 'POST', token: owner, body: {
      entry_date: '2026-10-01', description: 'רכישת חומרי ניקוי',
      lines: [{ account_code: '5000', debit: 100, party_id: partyId }, { account_code: '1010', credit: 100 }] } });
    assert.equal(one.status, 201, JSON.stringify(one.json));
    assert.equal(one.json.entry.entry_no, 1);

    const two = await api(`${B}/entries`, { method: 'POST', token: owner, body: {
      entry_date: '2026-10-02', description: 'הכנסה מזומנת',
      lines: [{ account_code: '1000', debit: 250 }, { account_code: '4000', credit: 250 }] } });
    assert.equal(two.json.entry.entry_no, 2);

    const ghost = await api(`${B}/entries`, { method: 'POST', token: owner, body: {
      entry_date: '2026-10-02', description: 'x',
      lines: [{ account_code: '9999', debit: 1 }, { account_code: '1000', credit: 1 }] } });
    assert.equal(ghost.status, 400);
  });

  await t.test('מאזן בוחן מאוזן', async () => {
    const res = await api(`${B}/trial-balance`, { token: owner });
    assert.equal(res.status, 200);
    assert.equal(res.json.totals.balanced, true);
    assert.equal(res.json.totals.debit, '350.00');
    const cash = res.json.accounts.find(a => a.code === '1000');
    assert.equal(cash.debit, '250.00');
  });

  await t.test('סטורנו הופך חובה/זכות, פעם אחת בלבד', async () => {
    const list = await api(`${B}/entries`, { token: owner });
    const target = list.json.entries.find(e => e.description === 'הכנסה מזומנת');
    const rev = await api(`${B}/entries/${target.id}/reverse`, { method: 'POST', token: owner });
    assert.equal(rev.status, 201, JSON.stringify(rev.json));
    assert.equal(rev.json.reversed_entry_no, target.entry_no);
    const again = await api(`${B}/entries/${target.id}/reverse`, { method: 'POST', token: owner });
    assert.equal(again.status, 409);
    const tb = await api(`${B}/trial-balance`, { token: owner });
    assert.equal(tb.json.totals.balanced, true);
    assert.equal(tb.json.totals.debit, '600.00'); // 350 + 250 סטורנו
    const income = tb.json.accounts.find(a => a.code === '4000');
    assert.equal(income.debit, '250.00'); // שורת הסטורנו בצד חובה
    assert.equal(income.credit, '250.00'); // נטו 0
  });

  await t.test('סגירת תקופה חוסמת רישום לאותה תקופה בלבד', async () => {
    const close = await api(`${B}/periods/close`, { method: 'POST', token: owner, body: { year: 2026, month: 10 } });
    assert.equal(close.status, 201, JSON.stringify(close.json));
    const blocked = await api(`${B}/entries`, { method: 'POST', token: owner, body: {
      entry_date: '2026-10-15', description: 'מאוחר מדי',
      lines: [{ account_code: '1000', debit: 5 }, { account_code: '4000', credit: 5 }] } });
    assert.equal(blocked.status, 400);
    const ok = await api(`${B}/entries`, { method: 'POST', token: owner, body: {
      entry_date: '2026-09-01', description: 'חודש פתוח קודם',
      lines: [{ account_code: '1000', debit: 5 }, { account_code: '4000', credit: 5 }] } });
    assert.equal(ok.status, 201);
  });
});
