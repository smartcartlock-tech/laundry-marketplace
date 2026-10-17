// T17: מנוי משפחתי מלא — הצטרפות, מסך חברות ("אני חבר אצל X"), הסרת חבר, עזיבה,
// הזמנות משפחתיות (אפקט משותף) וביטול הזמנה משפחתית על ידי בעל המנוי.
const { test, before } = require('node:test');
const assert = require('node:assert');
const { startApp } = require('./helpers');

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://postgres@127.0.0.1:5433/laundry_test';

let CTX;
before(async (t) => { CTX = await startApp(t); });

test('T17: זרימה מלאה — הצטרפות, חברות, הזמנה משפחתית, ביטול, הסרה, עזיבה', async () => {
  const { api } = CTX;
  const owner = await api.login('+972500000003');
  const member = await api.login('+972500000011', 'בן משפחה');
  const stranger = await api.login('+972500000012', 'זר');

  // הצטרפות בקישור
  const inv = await api('/api/me/family/invite', { method: 'POST', token: owner });
  assert.equal(inv.status, 201, JSON.stringify(inv.json));
  const join = await api('/api/family/join', { method: 'POST', token: member, body: { token: inv.json.token } });
  assert.equal(join.status, 200, JSON.stringify(join.json));

  // בעלים רואה את החבר (עם מזהה להסרה)
  let fam = await api('/api/me/family', { token: owner });
  assert.equal(fam.status, 200);
  assert.equal(fam.json.members.length, 1);
  const memberId = fam.json.members[0].id;
  assert.ok(memberId, 'מזהה חבר מוחזר');

  // מסך "אני חבר אצל X"
  const mfam = await api('/api/me/family', { token: member });
  assert.ok(mfam.json.membership && mfam.json.membership.owner_name, 'חברות מוצגת לחבר');

  // זר לא רואה כלום
  const sfam = await api('/api/me/family', { token: stranger });
  assert.equal(sfam.json.members.length, 0);
  assert.equal(sfam.json.membership, null);

  // החבר מזמין → הזמנה משפחתית גלויה לבעלים (אפקט משותף)
  const page = await api('/api/laundries/achuza');
  const bag = page.json.items.find(i => i.name.includes('שק')) || page.json.items[0];
  const o = await api('/api/orders', { method: 'POST', token: member, body: { slug: 'achuza', items: [{ item_id: bag.id, qty: 1 }], address: 'רחוב המשפחה 5', payment_method: 'cash' } });
  assert.equal(o.status, 201, JSON.stringify(o.json));
  fam = await api('/api/me/family', { token: owner });
  const fo = fam.json.family_orders.find(x => x.id === o.json.order.id);
  assert.ok(fo, 'ההזמנה של החבר גלויה לבעל המנוי');

  // זר לא יכול לבטל הזמנה משפחתית
  const sc = await api(`/api/me/family/orders/${o.json.order.id}/cancel`, { method: 'POST', token: stranger });
  assert.equal(sc.status, 404);

  // בעל המנוי מבטל
  const cancel = await api(`/api/me/family/orders/${o.json.order.id}/cancel`, { method: 'POST', token: owner });
  assert.equal(cancel.status, 200, JSON.stringify(cancel.json));
  // ביטול שני נדחה
  const again = await api(`/api/me/family/orders/${o.json.order.id}/cancel`, { method: 'POST', token: owner });
  assert.equal(again.status, 409);

  // הסרת חבר על ידי בעלים
  const rem = await api(`/api/me/family/members/${memberId}`, { method: 'DELETE', token: owner });
  assert.equal(rem.status, 200);
  fam = await api('/api/me/family', { token: owner });
  assert.equal(fam.json.members.length, 0);
  // הסרה חוזרת → 404
  assert.equal((await api(`/api/me/family/members/${memberId}`, { method: 'DELETE', token: owner })).status, 404);

  // הצטרפות מחדש ועזיבה עצמית
  const inv2 = await api('/api/me/family/invite', { method: 'POST', token: owner });
  await api('/api/family/join', { method: 'POST', token: member, body: { token: inv2.json.token } });
  const leave = await api('/api/me/family/leave', { method: 'POST', token: member });
  assert.equal(leave.status, 200);
  assert.equal(leave.json.was_member, true);
  const mfam2 = await api('/api/me/family', { token: member });
  assert.equal(mfam2.json.membership, null, 'אחרי עזיבה אין חברות');
});
