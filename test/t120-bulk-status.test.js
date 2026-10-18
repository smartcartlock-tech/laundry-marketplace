// T120: עדכון סטטוס מרובה לבעלים — אותם כללי רצף כמו מעבר בודד, best-effort, בידוד טנאנט
const { test } = require('node:test');
const assert = require('node:assert');
const { startApp } = require('./helpers');

test('T120: bulk-status — קידום מרובה, כללי רצף, הרשאות', async (t) => {
  const { api } = await startApp(t);
  const customer = await api.login('+972500000002');
  const owner = await api.login('+972500000003');

  const page = await api('/api/laundries/achuza');
  const bag = page.json.items.find(i => i.name.includes('שק'));
  const mk = () => api('/api/orders', { method: 'POST', token: customer, body: { slug: 'achuza', items: [{ item_id: bag.id, qty: 1 }], address: 'הרצל 12, תל אביב' } });
  const o1 = (await mk()).json.order, o2 = (await mk()).json.order;

  // ולידציות
  const badStatus = await api('/api/t/achuza/orders/bulk-status', { method: 'POST', token: owner, body: { ids: [o1.id], status: 'flying' } });
  assert.equal(badStatus.status, 400);
  const badId = await api('/api/t/achuza/orders/bulk-status', { method: 'POST', token: owner, body: { ids: ['not-a-uuid'], status: 'confirmed' } });
  assert.equal(badId.status, 400);
  const notMember = await api('/api/t/achuza/orders/bulk-status', { method: 'POST', token: customer, body: { ids: [o1.id], status: 'confirmed' } });
  assert.equal(notMember.status, 403);

  // קידום מרובה תקין
  const bulk = await api('/api/t/achuza/orders/bulk-status', { method: 'POST', token: owner, body: { ids: [o1.id, o2.id], status: 'confirmed' } });
  assert.equal(bulk.status, 200, JSON.stringify(bulk.json));
  assert.equal(bulk.json.updated, 2);
  assert.equal(bulk.json.failed.length, 0);
  for (const o of [o1, o2]) {
    const d = await api('/api/orders/' + o.id, { token: customer });
    assert.equal(d.json.order.status, 'confirmed');
  }

  // picked_up בלי שליח — נכשל לפי אותו כלל של המעבר הבודד; אף הזמנה לא עודכנה
  const noCourier = await api('/api/t/achuza/orders/bulk-status', { method: 'POST', token: owner, body: { ids: [o1.id, o2.id], status: 'picked_up' } });
  assert.equal(noCourier.status, 409);
  assert.equal(noCourier.json.failed.length, 2);
  assert.match(noCourier.json.failed[0].error, /שליח/);

  // דילוג על שלב — נכשל; המסלול הבודד עדיין עובד אחרי הרפקטור (רגרסיה)
  const skip = await api('/api/t/achuza/orders/bulk-status', { method: 'POST', token: owner, body: { ids: [o1.id], status: 'ready' } });
  assert.equal(skip.status, 409);
  const o3 = (await mk()).json.order;
  const single = await api('/api/t/achuza/orders/' + o3.id + '/status', { method: 'POST', token: owner, body: { status: 'confirmed' } });
  assert.equal(single.status, 200, JSON.stringify(single.json));
  const after = await api('/api/orders/' + o3.id, { token: customer });
  assert.equal(after.json.order.status, 'confirmed');
  // שגיאת רצף גם במסלול הבודד — אותה הודעה כמו קודם
  const singleBad = await api('/api/t/achuza/orders/' + o3.id + '/status', { method: 'POST', token: owner, body: { status: 'ready' } });
  assert.equal(singleBad.status, 409);
  assert.equal(singleBad.json.error, 'מעבר סטטוס חייב להיות לשלב הבא ברצף');
});
