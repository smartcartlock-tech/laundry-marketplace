// C4: צ'ק-אאוט ראשון מחייב הסכמה; ההסכמה נרשמת פעם אחת ומשם ההזמנות עוברות
const { test } = require('node:test');
const assert = require('node:assert');
const { startApp } = require('./helpers');

async function newUserNoConsent(api, phone) {
  const req = await api('/api/auth/otp/request', { method: 'POST', body: { target: phone } });
  const ver = await api('/api/auth/otp/verify', { method: 'POST', body: { target: phone, code: req.json.demoCode } });
  return ver.json.token; // בלי consent — בניגוד ל-helper המשותף
}

test('C4: בלי הסכמה 409; עם consent_terms עובר; consent_at נשמר ומשמש הלאה', async (t) => {
  const { api } = await startApp(t);
  const token = await newUserNoConsent(api, '+972500000701');
  const page = await api('/api/laundries/achuza');
  const item = page.json.items[0];
  const order = { slug: 'achuza', items: [{ item_id: item.id, qty: 1 }], address: 'הרצל 12, תל אביב' };

  const me1 = await api('/api/auth/me', { token });
  assert.equal(me1.json.user.consent_at, null);

  const blocked = await api('/api/orders', { method: 'POST', token, body: order });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.json.code, 'CONSENT_REQUIRED');

  const ok = await api('/api/orders', { method: 'POST', token, body: { ...order, consent_terms: true } });
  assert.equal(ok.status, 201, JSON.stringify(ok.json));

  const me2 = await api('/api/auth/me', { token });
  assert.ok(me2.json.user.consent_at, 'consent_at נרשם');

  // הזמנה שנייה בלי הדגל — עוברת כי ההסכמה כבר נרשמה
  const second = await api('/api/orders', { method: 'POST', token, body: order });
  assert.equal(second.status, 201);
});

test('C4: POST /api/auth/consent נותן הסכמה ישירה (דרך הצ׳קבוקס בצד לקוח)', async (t) => {
  const { api } = await startApp(t);
  const token = await newUserNoConsent(api, '+972500000702');
  const c = await api('/api/auth/consent', { method: 'POST', token });
  assert.equal(c.status, 200);
  assert.ok(c.json.consent_at);
  // אידמפוטנטי — קריאה חוזרת לא משנה
  const c2 = await api('/api/auth/consent', { method: 'POST', token });
  assert.equal(c2.json.consent_at, c.json.consent_at);
});
