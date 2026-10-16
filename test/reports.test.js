const { test } = require('node:test');
const assert = require('node:assert');
const { startApp } = require('./helpers');

// E11.T1+T2+T3: דוחות מכבסה, ייצוא CSV עם BOM, דוח שבועי לאדמין
test('reports: דוח מכבסה עם פילוח ערוצים וגרף שבועי', async (t) => {
  const { api, base } = await startApp(t);
  const customer = await api.login('+972500000002');
  const owner = await api.login('+972500000003');
  const admin = await api.login('+972500000001');

  const l = await api('/api/laundries/achuza');
  const itemId = l.json.items[0].id;
  const o = await api('/api/orders', { method: 'POST', token: customer, body: { slug: 'achuza', items: [{ item_id: itemId, qty: 2 }], address: 'רחוב בדיקה 1' } });
  assert.equal(o.status, 201);

  const rep = await api('/api/t/achuza/reports', { token: owner });
  assert.equal(rep.status, 200, JSON.stringify(rep.json));
  assert.ok(Number(rep.json.totals.orders) >= 1);
  assert.ok(Number(rep.json.totals.revenue) > 0);
  assert.ok(rep.json.weekly.length >= 1, 'גרף שבועי מכיל לפחות שבוע אחד');
  assert.ok(rep.json.channels.some(c => c.source === 'app'), 'פילוח ערוצים כולל אפליקציה');
  assert.ok(rep.json.topItems.length >= 1);
  assert.ok('returning' in rep.json.customers);

  // הרשאות: לקוח רגיל לא מקבל דוח מכבסה
  const denied = await api('/api/t/achuza/reports', { token: customer });
  assert.equal(denied.status, 403);

  // CSV עם BOM ועברית
  const csvRes = await fetch(base + '/api/t/achuza/export/orders.csv', { headers: { Authorization: 'Bearer ' + owner } });
  assert.equal(csvRes.status, 200);
  assert.match(csvRes.headers.get('content-type'), /text\/csv/);
  const buf = Buffer.from(await csvRes.arrayBuffer());
  assert.deepEqual([...buf.subarray(0,3)], [0xEF,0xBB,0xBF], 'BOM חסר — עברית תישבר ב-Excel');
  assert.ok(buf.toString('utf8').includes('סטטוס'), 'כותרות עבריות ב-CSV');

  // דוח שבועי לאדמין
  const weekly = await api('/api/admin/weekly-report', { token: admin });
  assert.equal(weekly.status, 200, JSON.stringify(weekly.json));
  assert.ok(weekly.json.report.orders >= 1);
  assert.ok(Number(weekly.json.report.gmv) > 0);
  assert.ok(weekly.json.report.by_tenant.some(t => t.name === 'מכבסת האחוזה'));

  const wcsv = await fetch(base + '/api/admin/weekly-report.csv', { headers: { Authorization: 'Bearer ' + admin } });
  assert.equal(wcsv.status, 200);
  const wbuf = Buffer.from(await wcsv.arrayBuffer());
  assert.deepEqual([...wbuf.subarray(0,3)], [0xEF,0xBB,0xBF]);
  assert.ok(wbuf.toString('utf8').includes('מכבסת האחוזה'));

  // לא אדמין — נדחה
  const denied2 = await api('/api/admin/weekly-report', { token: owner });
  assert.equal(denied2.status, 403);
});
