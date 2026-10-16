const { test } = require('node:test');
const assert = require('node:assert');
const { startApp } = require('./helpers');

test('admin: סקירה, אישור שליח, הרשאות', async (t) => {
  const { api } = await startApp(t);
  const admin = await api.login('+972500000001');
  const customer = await api.login('+972500000002');

  // לקוח רגיל לא מנהל
  const forbidden = await api('/api/admin/overview', { token: customer });
  assert.equal(forbidden.status, 403);

  const ov = await api('/api/admin/overview', { token: admin });
  assert.equal(ov.status, 200);
  assert.ok(ov.json.tenants.total >= 4);
  assert.ok(ov.json.couriers.total >= 2);

  // רישום שליח פלטפורמה חדש על ידי אדמין ואישורו
  const reg = await api('/api/admin/couriers/register', { method: 'POST', token: admin, body: { phone: '+972500000042', name: 'שליח חדש', model: 'platform', vehicle: 'אופניים חשמליים', areas: ['תל אביב'] } });
  assert.equal(reg.status, 201, JSON.stringify(reg.json));
  const cid = reg.json.courier.id;
  assert.equal(reg.json.courier.approved, true); // רישום אדמין מאושר מיידית

  // שליח מאושר יכול לגשת לפרופיל שליח
  const courierToken = await api.login('+972500000042');
  const prof = await api('/api/courier/profile', { token: courierToken });
  assert.equal(prof.status, 200);
  assert.equal(prof.json.courier.model, 'platform');

  // השהיית שליח חוסמת
  const susp = await api('/api/admin/couriers/' + cid + '/suspend', { method: 'POST', token: admin });
  assert.equal(susp.status, 200);
});
