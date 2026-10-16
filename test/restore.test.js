// E2: שחזור גיבוי — export→restore→אימות, הגנת סכימה לא-ריקה, ויחידות ל-coerce/topo.
const test = require('node:test');
const assert = require('node:assert');
const { Pool } = require('pg');
const { startApp, TEST_DB } = require('./helpers');
const { restoreAll, coerceValue, topoSort } = require('../src/restore');

test('coerceValue: bytea מצורת Buffer-JSON, jsonb מקומטרס, שאר עובר כמו שהוא', () => {
  const buf = coerceValue('bytea', { type: 'Buffer', data: [1, 2, 3] });
  assert.ok(Buffer.isBuffer(buf));
  assert.deepEqual([...buf], [1, 2, 3]);
  assert.equal(coerceValue('jsonb', { a: 1 }), '{"a":1}');
  assert.equal(coerceValue('json', [1, 2]), '[1,2]');
  assert.deepEqual(coerceValue('ARRAY', ['א', 'ב']), ['א', 'ב']);
  assert.equal(coerceValue('text', 'שלום'), 'שלום');
  assert.equal(coerceValue('bytea', null), null);
  assert.equal(coerceValue('timestamptz', '2026-10-16T10:00:00.000Z'), '2026-10-16T10:00:00.000Z');
});

test('topoSort: תלות FK מכבדת סדר; מעגל נופל לסוף', () => {
  const { order } = topoSort(['b', 'a', 'c'], { b: ['a'], c: ['b'] });
  assert.deepEqual(order, ['a', 'b', 'c']);
  const cyc = topoSort(['x', 'y'], { x: ['y'], y: ['x'] });
  assert.equal(cyc.cyclic.length, 2);
});

test('roundtrip: export מהאפליקציה → restore לסכימה ריקה → נתונים זהים; הגנת force', async (t) => {
  const { api } = await startApp(t);
  const token = await api.login('+972500000001');
  const exp = await api('/api/admin/export', { token });
  assert.equal(exp.status, 200);

  const target = 'test_restore_' + Math.random().toString(36).slice(2, 8);
  const stats = await restoreAll(exp.json, { databaseUrl: TEST_DB, schema: target });
  assert.ok(stats.tables.tenants >= 4, 'שוחזרו לפחות 4 מכבסות דמו');
  // מעגל FK ידוע (tenders <-> tender_bids) — מטופל בהכנסה דו-שלבית

  const pool = new Pool({ connectionString: TEST_DB, options: `-c search_path=${target},public` });
  t.after(async () => {
    await pool.query(`DROP SCHEMA IF EXISTS "${target}" CASCADE`).catch(() => {});
    await pool.end();
  });
  for (const table of ['tenants', 'users', 'price_items', 'pickup_windows']) {
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM "${table}"`);
    assert.equal(rows[0].n, exp.json.tables[table].length, `${table}: אותו מספר שורות`);
  }
  // דגימת תוכן: מכבסה ראשונה זהה בשדות מפתח
  const { rows: ten } = await pool.query(`SELECT slug, name, city, approved FROM tenants ORDER BY created_at LIMIT 1`);
  const src = [...exp.json.tables.tenants].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))[0];
  assert.equal(ten[0].slug, src.slug);
  assert.equal(ten[0].name, src.name);

  // מעגל FK: אם בדמו יש מכרזים/הצעות — שוחזרו בשלמות, כולל winner_bid_id
  if (exp.json.tables.tenders && exp.json.tables.tenders.length) {
    const { rows: tn } = await pool.query(`SELECT count(*)::int AS n FROM tenders`);
    assert.equal(tn[0].n, exp.json.tables.tenders.length, 'tenders שוחזרו');
    const { rows: tb } = await pool.query(`SELECT count(*)::int AS n FROM tender_bids`);
    assert.equal(tb[0].n, (exp.json.tables.tender_bids || []).length, 'tender_bids שוחזרו');
    const withWinner = exp.json.tables.tenders.filter(x => x.winner_bid_id);
    if (withWinner.length) {
      const { rows: w } = await pool.query(`SELECT count(*)::int AS n FROM tenders WHERE winner_bid_id IS NOT NULL`);
      assert.equal(w[0].n, withWinner.length, 'winner_bid_id שוחזר בשלב השני');
    }
  }

  // כתיבה אחרי שחזור: הרצפים אופסו, אין התנגשות מזהים
  const ins = await pool.query(`INSERT INTO users(phone, name) VALUES ('+972599999999', 'בדיקת רצף') RETURNING id`);
  assert.ok(ins.rows[0].id);

  // הגנה: restore חוזר לסכימה לא-ריקה נעצר בלי force, עובר עם force
  await assert.rejects(() => restoreAll(exp.json, { databaseUrl: TEST_DB, schema: target }), /אינה ריקה/);
  const again = await restoreAll(exp.json, { databaseUrl: TEST_DB, schema: target, force: true, log: () => {} });
  assert.ok(again.truncated);
  const { rows: cnt } = await pool.query(`SELECT count(*)::int AS n FROM tenants`);
  assert.equal(cnt[0].n, exp.json.tables.tenants.length);
});

test('מעגל FK סינתטי: tenders↔tender_bids עם winner_bid_id משוחזר מלא', async (t) => {
  const target = 'test_cycle_' + Math.random().toString(36).slice(2, 8);
  const tenantId = '11111111-1111-1111-1111-111111111111';
  const tenderId = '22222222-2222-2222-2222-222222222222';
  const bidId = '33333333-3333-3333-3333-333333333333';
  const data = { exported_at: new Date().toISOString(), tables: {
    tenants: [{ id: tenantId, slug: 'cyc-ten', name: 'מכבסת מעגל' }],
    tenders: [{ id: tenderId, tenant_id: tenantId, title: 'מכרז בדיקה', deadline: '2026-12-01T00:00:00.000Z', winner_bid_id: bidId, status: 'awarded' }],
    tender_bids: [{ id: bidId, tender_id: tenderId, tenant_id: tenantId, price_per_kg: 12.5 }],
  } };
  const stats = await restoreAll(data, { databaseUrl: TEST_DB, schema: target, log: () => {} });
  assert.deepEqual(stats.cyclic.sort(), ['tender_bids', 'tenders']);

  const pool = new Pool({ connectionString: TEST_DB, options: `-c search_path=${target},public` });
  t.after(async () => {
    await pool.query(`DROP SCHEMA IF EXISTS "${target}" CASCADE`).catch(() => {});
    await pool.end();
  });
  const { rows } = await pool.query('SELECT winner_bid_id FROM tenders WHERE id=$1', [tenderId]);
  assert.equal(rows[0].winner_bid_id, bidId, 'winner_bid_id שוחזר בשלב השני');
  const { rows: b } = await pool.query('SELECT tender_id, price_per_kg FROM tender_bids WHERE id=$1', [bidId]);
  assert.equal(b[0].tender_id, tenderId);
  assert.equal(Number(b[0].price_per_kg), 12.5);
});
