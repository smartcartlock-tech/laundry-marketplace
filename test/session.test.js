const { test } = require('node:test');
const assert = require('node:assert');
const { startApp } = require('./helpers');

// QA2.T5: נחיתה עקבית אחרי כניסה ראשונה — השרת מסמן is_new כדי שהלקוח ינחת בצורה צפויה
test('session: is_new מסומן ברישום ראשון ולא בכניסות חוזרות', async (t) => {
  const { api } = await startApp(t);
  const phone = '+972500000777';

  const r1 = await api('/api/auth/otp/request', { method: 'POST', body: { target: phone } });
  const v1 = await api('/api/auth/otp/verify', { method: 'POST', body: { target: phone, code: r1.json.demoCode, name: 'ראשון' } });
  assert.equal(v1.status, 200);
  assert.equal(v1.json.is_new, true, 'רישום ראשון חייב להיות מסומן is_new');

  const r2 = await api('/api/auth/otp/request', { method: 'POST', body: { target: phone } });
  const v2 = await api('/api/auth/otp/verify', { method: 'POST', body: { target: phone, code: r2.json.demoCode } });
  assert.equal(v2.status, 200);
  assert.equal(v2.json.is_new, false, 'כניסה חוזרת אינה רישום');
  assert.equal(v2.json.user.name, 'ראשון', 'שם קיים לא נדרס (QA2.T1)');
});
