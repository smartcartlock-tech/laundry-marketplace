const { test } = require('node:test');
const assert = require('node:assert');
const { startApp, TEST_DB } = require('./helpers');
const { Client } = require('pg');

async function makeOrder(api, token, slug) {
  const l = await api('/api/laundries/' + slug);
  const item = l.json.items[0];
  const r = await api('/api/orders', { method: 'POST', token, body: { slug, items: [{ item_id: item.id, qty: 1 }], address: 'רחוב הבדיקה 1, תל אביב' } });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return r.json.order.id;
}

test('E7.T1: דשבורד מנהל מרכזי — GMV, עמלות, SLA, מכבסות, B2B שבועי, התראות', async (t) => {
  const { api } = await startApp(t);
  const admin = await api.login('+972500000001');
  const customer = await api.login('+972500000002');

  const forbidden = await api('/api/admin/dashboard', { token: customer });
  assert.equal(forbidden.status, 403);

  await makeOrder(api, customer, 'achuza');
  const d = await api('/api/admin/dashboard', { token: admin });
  assert.equal(d.status, 200, JSON.stringify(d.json));
  assert.ok(Number(d.json.month.gmv) > 0, 'GMV חודשי חיובי');
  assert.ok(d.json.month.orders >= 1);
  assert.ok('courier_commission' in d.json.month);
  assert.ok('on_time_pct' in d.json.sla);
  assert.ok(d.json.laundries.approved >= 2);
  assert.ok(d.json.laundries.active_30d >= 1, 'מכבסה פעילה עם הזמנה ב-30 יום');
  for (const k of ['posts','tenders','bids','purchase_groups','capacity_posts']) assert.ok(k in d.json.b2b_weekly, k);
  for (const k of ['open','late','issues']) assert.ok(k in d.json.alerts, k);
});

test('E7.T2: צינור אונבורדינג — שלבים, מעבר מתועד, צינור בדשבורד', async (t) => {
  const { api } = await startApp(t);
  const admin = await api.login('+972500000001');
  const customer = await api.login('+972500000002');

  const forbidden = await api('/api/admin/onboarding', { token: customer });
  assert.equal(forbidden.status, 403);

  const list = await api('/api/admin/onboarding', { token: admin });
  assert.equal(list.status, 200);
  assert.deepEqual(list.json.stages, ['agreement','pricing','bot','training','active']);
  const t0 = list.json.tenants.find(x => x.slug === 'achuza');
  assert.ok(t0, 'achuza in pipeline');
  assert.equal(t0.stage, 'agreement'); // ברירת מחדל
  const initialAgreement = list.json.pipeline.agreement;

  const bad = await api(`/api/admin/onboarding/${t0.id}/stage`, { method: 'POST', token: admin, body: { stage: 'nonsense' } });
  assert.equal(bad.status, 400);

  for (const stage of ['pricing','bot','training','active']) {
    const r = await api(`/api/admin/onboarding/${t0.id}/stage`, { method: 'POST', token: admin, body: { stage, notes: 'בדיקה ' + stage } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.onboarding.stage, stage);
    assert.ok(r.json.onboarding.updated_at);
    assert.ok(r.json.onboarding.updated_by);
  }

  const after = await api('/api/admin/onboarding', { token: admin });
  assert.equal(after.json.pipeline.agreement, initialAgreement - 1);
  assert.equal(after.json.tenants.find(x => x.id === t0.id).stage, 'active');
  assert.equal(after.json.tenants.find(x => x.id === t0.id).notes, 'בדיקה active');
});

test('E7.T3: התראות SLA — סריקת איחורים, דיווח לקוח, טיפול מתועד', async (t) => {
  const { api, schema } = await startApp(t);
  const admin = await api.login('+972500000001');
  const customer = await api.login('+972500000002');

  // הזמנה מאושרת עם חלון איסוף בעבר הרחוק → איחור
  const oid = await makeOrder(api, customer, 'achuza');
  const c = await api('/api/t/achuza/orders/' + oid + '/status', { method: 'POST', token: admin, body: { status: 'confirmed' } });
  assert.equal(c.status, 200);
  const db = new Client({ connectionString: TEST_DB });
  await db.connect();
  await db.query(`SET search_path TO "${schema}"`);
  await db.query(`UPDATE orders SET pickup_at = now() - interval '5 hours' WHERE id=$1`, [oid]);

  // דיווח תקלה של לקוח על אותה הזמנה
  const rep = await api(`/api/orders/${oid}/report`, { method: 'POST', token: customer, body: { kind: 'damage', text: 'הכביסה חזרה עם כתם' } });
  assert.equal(rep.status, 201, JSON.stringify(rep.json));
  const repDup = await api(`/api/orders/${oid}/report`, { method: 'POST', token: customer, body: { kind: 'damage', text: 'שוב' } });
  assert.equal(repDup.status, 409); // דיווח כפול נחסם
  const stranger = await api.login('+972500000009');
  const notMine = await api(`/api/orders/${oid}/report`, { method: 'POST', token: stranger, body: { kind: 'other', text: 'לא שלי' } });
  assert.equal(notMine.status, 403);

  // סריקת SLA — יוצרת התראת איחור אחת בלבד (אידמפוטנטי)
  const sync1 = await api('/api/admin/sla/sync', { method: 'POST', token: admin, body: {} });
  assert.equal(sync1.status, 200, JSON.stringify(sync1.json));
  assert.ok(sync1.json.created.late_pickup >= 1);
  const sync2 = await api('/api/admin/sla/sync', { method: 'POST', token: admin, body: {} });
  assert.equal(sync2.json.created.late_pickup, 0, 'סריקה חוזרת לא יוצרת כפילויות');

  // תור טיפול: איחור + דיווח לקוח פתוחים
  const queue = await api('/api/admin/sla', { token: admin });
  assert.equal(queue.status, 200);
  const late = queue.json.alerts.find(a => a.order_id === oid && a.kind === 'late_pickup');
  const issue = queue.json.alerts.find(a => a.order_id === oid && a.kind === 'customer_issue');
  assert.ok(late, 'התראת איחור בתור');
  assert.equal(late.tenant_name, 'מכבסת האחוזה');
  assert.ok(issue && issue.details.includes('כתם'), 'דיווח לקוח בתור');
  assert.equal(issue.customer_name, 'לקוחה לדמו');

  // טיפול מתועד + לא ניתן לטפל פעמיים + פתיחה מחדש
  const h = await api(`/api/admin/sla/${late.id}/handle`, { method: 'POST', token: admin, body: { note: 'דובר עם השליח, אוסף מחדש' } });
  assert.equal(h.status, 200);
  assert.equal(h.json.alert.status, 'handled');
  assert.ok(h.json.alert.handled_at);
  const h2 = await api(`/api/admin/sla/${late.id}/handle`, { method: 'POST', token: admin, body: { note: 'x' } });
  assert.equal(h2.status, 404);
  const reopen = await api(`/api/admin/sla/${late.id}/reopen`, { method: 'POST', token: admin });
  assert.equal(reopen.status, 200);
  assert.equal(reopen.json.alert.status, 'open');

  // הדשבורד משקף התראות פתוחות
  const d = await api('/api/admin/dashboard', { token: admin });
  assert.ok(d.json.alerts.open >= 2);
  assert.ok(d.json.alerts.late >= 1);
  assert.ok(d.json.alerts.issues >= 1);

  await db.end();
});
