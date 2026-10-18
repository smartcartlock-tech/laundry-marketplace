// T108: מסירה עצמית בלי שליח ('אני מסירה בעצמי') + הוספת שליח פרטי למכבסה.
// קריטריון: בעלים מקדם הזמנה לאספקה בלי שליח רשום.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { startApp } = require('./helpers');
const communityJs = fs.readFileSync('public/js/community.js', 'utf8');

async function newOrder(api, customer) {
  const l = await api('/api/laundries/achuza');
  const item = l.json.items[0];
  const r = await api('/api/orders', { method: 'POST', token: customer, body: { slug: 'achuza', items: [{ item_id: item.id, qty: 1 }], address: 'רחוב העצמאות 8, תל אביב' } });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return r.json.order.id;
}

test('בלי סימון מסירה עצמית: קידום ל-picked_up ללא שליח נדחה (409)', async (t) => {
  const { api } = await startApp(t);
  const admin = await api.login('+972500000001');
  const customer = await api.login('+972500000002');
  const oid = await newOrder(api, customer);
  await api(`/api/t/achuza/orders/${oid}/status`, { method: 'POST', token: admin, body: { status: 'confirmed' } });
  const bad = await api(`/api/t/achuza/orders/${oid}/status`, { method: 'POST', token: admin, body: { status: 'picked_up' } });
  assert.equal(bad.status, 409, 'ללא שליח וללא מסירה עצמית נדחה');
});

test('מסירה עצמית: בעלים מקדם את כל הרצף לאספקה בלי שליח רשום', async (t) => {
  const { api } = await startApp(t);
  const admin = await api.login('+972500000001');
  const customer = await api.login('+972500000002');
  const oid = await newOrder(api, customer);
  const mark = await api(`/api/t/achuza/orders/${oid}/self-deliver`, { method: 'POST', token: admin });
  assert.equal(mark.status, 200, JSON.stringify(mark.json));
  assert.equal(mark.json.self_delivery, true);
  for (const st of ['confirmed', 'picked_up', 'in_work', 'ready', 'out_for_delivery', 'delivered']) {
    const s = await api(`/api/t/achuza/orders/${oid}/status`, { method: 'POST', token: admin, body: { status: st } });
    assert.equal(s.status, 200, st + ': ' + JSON.stringify(s.json));
  }
  const after = await api('/api/orders/' + oid, { token: admin });
  assert.equal(after.json.order.status, 'delivered', 'ההזמנה נמסרה בלי שליח');
  assert.equal(after.json.order.courier_id, null, 'לא שובץ שליח');
  assert.equal(after.json.order.self_delivery, true);
});

test('מסירה עצמית: לא ניתן לסמן כשכבר שובץ שליח; בידוד מכבסות', async (t) => {
  const { api } = await startApp(t);
  const admin = await api.login('+972500000001');
  const customer = await api.login('+972500000002');
  const courier = await api.login('+972500000004'); // שליח פרטי של achuza
  const oid = await newOrder(api, customer);
  await api(`/api/t/achuza/orders/${oid}/status`, { method: 'POST', token: admin, body: { status: 'confirmed' } });
  const cts = await api('/api/t/achuza/couriers', { token: admin });
  const pc = cts.json.couriers.find(c => c.model === 'private');
  assert.ok(pc, 'שליח פרטי של achuza קיים בזרע');
  const asg = await api(`/api/t/achuza/orders/${oid}/assign`, { method: 'POST', token: admin, body: { courier_id: pc.id } });
  assert.equal(asg.status, 200, JSON.stringify(asg.json));
  const mark = await api(`/api/t/achuza/orders/${oid}/self-deliver`, { method: 'POST', token: admin });
  assert.equal(mark.status, 409, 'אי אפשר מסירה עצמית אחרי שיבוץ שליח');
  // בידוד: בעלים של מכבסה אחרת לא מסמן הזמנה של achuza
  const outsider = await api.login('+972500000006').catch(() => null);
  const otherOwner = outsider || await api.login('+972500000002');
  const cross = await api(`/api/t/express/orders/${oid}/self-deliver`, { method: 'POST', token: otherOwner });
  assert.ok([401, 403, 404].includes(cross.status), 'גישה צולבת נדחית: ' + cross.status);
});

test('הוספת שליח פרטי למכבסה: נוצר מאושר וניתן לשיבוץ מיידי', async (t) => {
  const { api } = await startApp(t);
  const admin = await api.login('+972500000001');
  const customer = await api.login('+972500000002');
  const add = await api('/api/t/achuza/couriers', { method: 'POST', token: admin, body: { name: 'שליח הבית', phone: '+972500000777', vehicle: 'קורקינט' } });
  assert.equal(add.status, 201, JSON.stringify(add.json));
  assert.equal(add.json.courier.model, 'private');
  assert.equal(add.json.courier.approved, true, 'שליח פרטי שהבעלים הוסיף מאושר מיד');
  // שיבוץ מיידי דרך הזרימה הקיימת
  const oid = await newOrder(api, customer);
  await api(`/api/t/achuza/orders/${oid}/status`, { method: 'POST', token: admin, body: { status: 'confirmed' } });
  const asg = await api(`/api/t/achuza/orders/${oid}/assign`, { method: 'POST', token: admin, body: { courier_id: add.json.courier.id } });
  assert.equal(asg.status, 200, JSON.stringify(asg.json));
  assert.equal(asg.json.mode, 'assigned', 'שליח פרטי משובץ מיד בלי הצעה');
  // כפילות נדחית
  const dup = await api('/api/t/achuza/couriers', { method: 'POST', token: admin, body: { name: 'שליח הבית', phone: '+972500000777' } });
  assert.equal(dup.status, 409, 'אותו שליח פעמיים נדחה');
});

test('לקוח: כפתור מסירה עצמית וטופס שליח פרטי במסך ההזמנות של הבעלים', () => {
  assert.match(communityJs, /data-act="selfDeliver"/, "כפתור 'אני מסירה בעצמי'");
  assert.match(communityJs, /self-deliver/, 'קריאה לנקודת המסירה העצמית');
  assert.match(communityJs, /data-act="addPrivateCourier"/, 'טופס הוספת שליח פרטי');
  assert.match(communityJs, /שליח פרטי חדש למכבסה/, 'כותרת טופס השליח הפרטי');
  assert.match(communityJs, /מסירה עצמית — אתם מסירים/, 'תג מסירה עצמית בכרטיס');
});
