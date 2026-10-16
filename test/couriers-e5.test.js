const { test } = require('node:test');
const assert = require('node:assert');
const { startApp } = require('./helpers');

async function registerCourier(base, token, { withLicense = true, vehicle = 'אופנוע', areas = ['תל אביב'] } = {}) {
  const fd = new FormData();
  fd.append('name', 'שליח עצמאי');
  fd.append('vehicle', vehicle);
  fd.append('model', 'platform');
  fd.append('areas', JSON.stringify(areas));
  fd.append('availability', JSON.stringify({ 0: [['08:00', '20:00']], 2: [['08:00', '14:00']] }));
  if (withLicense) fd.append('license', new Blob([Buffer.from('fake-license-bytes')], { type: 'image/png' }), 'license.png');
  fd.append('photo', new Blob([Buffer.from('fake-photo')], { type: 'image/jpeg' }), 'me.jpg');
  const r = await fetch(base + '/api/courier/register', { method: 'POST', headers: { authorization: 'Bearer ' + token }, body: fd });
  let json = null; try { json = await r.json(); } catch (e) {}
  return { status: r.status, json };
}

test('E5.T1: הרשמת שליח עצמאי עם מסמכים', async (t) => {
  const { base, api } = await startApp(t);

  // ללא התחברות נדחה
  const anon = await fetch(base + '/api/courier/register', { method: 'POST', body: new FormData() });
  assert.equal(anon.status, 401);

  const token = await api.login('+972500000020', 'משה השליח');

  // ולידציה: חסר רישיון / חסר רכב
  let bad = await registerCourier(base, token, { withLicense: false });
  assert.equal(bad.status, 400);
  bad = await registerCourier(base, token, { vehicle: '' });
  assert.equal(bad.status, 400);

  // הרשמה תקינה עם מסמכים
  const reg = await registerCourier(base, token);
  assert.equal(reg.status, 201, JSON.stringify(reg.json));
  assert.equal(reg.json.courier.approved, false);
  assert.equal(reg.json.courier.model, 'platform');
  assert.deepEqual(reg.json.courier.areas, ['תל אביב']);

  // סטטוס בקשה + מטא-דאטה של מסמכים
  const st = await api('/api/courier/registration', { token });
  assert.equal(st.status, 200);
  assert.equal(st.json.registration.approved, false);
  assert.equal(st.json.registration.documents.length, 2);
  assert.deepEqual(st.json.registration.documents.map(d => d.kind).sort(), ['license', 'photo']);

  // הגשה כפולה בזמן המתנה נחסמת
  const dup = await registerCourier(base, token);
  assert.equal(dup.status, 409);

  // שליח ממתין מופיע בתור האישור של האדמין
  const admin = await api.login('+972500000001');
  const pending = await api('/api/admin/couriers/pending', { token: admin });
  assert.equal(pending.status, 200);
  const row = pending.json.pending.find(c => c.phone === '+972500000020');
  assert.ok(row, 'courier in pending queue');
  assert.equal(row.documents.length, 2);

  // המסמך זמין לאדמין; משתמש אחר לא מקבל אותו דרך endpoint השליח
  const docId = row.documents[0].id;
  const docRes = await fetch(base + '/api/admin/courier-documents/' + docId, { headers: { authorization: 'Bearer ' + admin } });
  assert.equal(docRes.status, 200);
  assert.equal(docRes.headers.get('content-type'), 'image/png');
  const buf = Buffer.from(await docRes.arrayBuffer());
  assert.equal(buf.toString(), 'fake-license-bytes');

  const other = await api.login('+972500000021');
  const stolen = await fetch(base + '/api/courier/documents/' + docId, { headers: { authorization: 'Bearer ' + other } });
  assert.equal(stolen.status, 404);
  const otherAdmin = await fetch(base + '/api/admin/courier-documents/' + docId, { headers: { authorization: 'Bearer ' + other } });
  assert.equal(otherAdmin.status, 403);

  // הבעלים כן יכול לצפות במסמך שלו
  const own = await fetch(base + '/api/courier/documents/' + docId, { headers: { authorization: 'Bearer ' + token } });
  assert.equal(own.status, 200);
});

test('E5.T2: אישור/דחייה עם סיבה והגשה מחדש', async (t) => {
  const { base, api } = await startApp(t);
  const admin = await api.login('+972500000001');
  const token = await api.login('+972500000022', 'דני');

  const reg = await registerCourier(base, token);
  assert.equal(reg.status, 201);
  const cid = reg.json.courier.id;

  // דחייה בלי סיבה נדחית
  const noReason = await api(`/api/admin/couriers/${cid}/reject`, { method: 'POST', token: admin, body: {} });
  assert.equal(noReason.status, 400);

  // דחייה עם סיבה נשמרת ומוצגת לשליח
  const rej = await api(`/api/admin/couriers/${cid}/reject`, { method: 'POST', token: admin, body: { reason: 'רישיון לא קריא' } });
  assert.equal(rej.status, 200);
  const st = await api('/api/courier/registration', { token });
  assert.equal(st.json.registration.rejected_reason, 'רישיון לא קריא');

  // לאחר דחייה לא מופיע בתור, אבל אפשר להגיש מחדש
  let pending = await api('/api/admin/couriers/pending', { token: admin });
  assert.ok(!pending.json.pending.find(c => c.id === cid));
  const reg2 = await registerCourier(base, token, { areas: ['חולון', 'בת ים'] });
  assert.equal(reg2.status, 201, JSON.stringify(reg2.json));
  assert.deepEqual(reg2.json.courier.areas, ['חולון', 'בת ים']);

  // אישור מפעיל את השליח: מופיע כמאושר, יוצא מהתור, ויכול לקבל הצעות (גישה ל-offers)
  const appr = await api(`/api/admin/couriers/${cid}/approve`, { method: 'POST', token: admin });
  assert.equal(appr.status, 200);
  pending = await api('/api/admin/couriers/pending', { token: admin });
  assert.ok(!pending.json.pending.find(c => c.id === cid));
  const offers = await api('/api/courier/offers', { token });
  assert.equal(offers.status, 200);

  // שליח מאושר לא יכול להגיש שוב
  const reg3 = await registerCourier(base, token);
  assert.equal(reg3.status, 409);
});

test('QA: שליח מושעה/לא מאושר נחסם מנתיבי courier; טלפון לא תקין נדחה ב-OTP', async (t) => {
  const { base, api } = await startApp(t);
  const token = await api.login('+972500000030', 'שליח ממתין');
  const reg = await registerCourier(base, token, { areas: ['חיפה'] });
  assert.equal(reg.status, 201, JSON.stringify(reg.json));
  // טרם אושר — כל נתיבי השליח חסומים
  for (const p of ['/api/courier/offers', '/api/courier/route', '/api/courier/earnings', '/api/courier/profile']) {
    const r = await api(p, { token });
    assert.equal(r.status, 403, p + ' -> ' + r.status);
  }
  // אבל סטטוס ההרשמה נגיש
  const st = await api('/api/courier/registration', { token });
  assert.equal(st.status, 200);

  // OTP: מספר עם ספרה מיותרת נדחה
  for (const bad of ['+9725000000034', '05000000034', '+1234']) {
    const r = await api('/api/auth/otp/request', { method: 'POST', body: { target: bad } });
    assert.equal(r.status, 400, bad + ' -> ' + r.status);
  }
  // מספר תקין מתקבל ומנורמל
  const ok = await api('/api/auth/otp/request', { method: 'POST', body: { target: '0500000031' } });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
});
