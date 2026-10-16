// הרשאות בין מכבסות: בעל מכבסה לא נוגע במכבסה אחרת; מחירון הסכמי לא דולף בין מכבסות
const { test } = require('node:test');
const assert = require('node:assert');
const { startApp } = require('./helpers');

test('cross-tenant permissions: owner of achuza blocked on express; business prices do not leak', async (t) => {
  const { api } = await startApp(t);
  const owner = await api.login('+972500000003', 'בעל מכבסה');
  const customer = await api.login('+972500000002', 'לקוחה לדמו');

  // בעל מכבסת האחוזה נדחה בכל נתיבי הניהול של מכבסה אחרת
  for (const [method, path] of [
    ['GET', '/api/t/express/business-accounts'],
    ['GET', '/api/t/express/subscriptions'],
    ['GET', '/api/t/express/orders'],
    ['POST', '/api/t/express/plans'],
    ['PATCH', '/api/t/express/settings'],
  ]) {
    const r = await api(path, { method, token: owner, body: method === 'GET' ? undefined : {} });
    assert.equal(r.status, 403, `${method} ${path} -> ${r.status}`);
  }

  // מחירון הסכמי של חשבון עסקי תקף רק במכבסה שלו
  const acc = (await api('/api/t/achuza/business-accounts', { method: 'POST', token: owner, body: { name: 'חברת בדיקה' } })).json.account;
  await api(`/api/t/achuza/business-accounts/${acc.id}/users`, { method: 'POST', token: owner, body: { phone: '+972500000002' } });
  const achItem = (await api('/api/laundries/achuza')).json.items[0];
  await api(`/api/t/achuza/business-accounts/${acc.id}/prices`, { method: 'PUT', token: owner, body: {
    prices: [{ item_id: achItem.id, price: Number(achItem.price) - 5 }] } });

  // באחוזה — מחיר הסכמי
  const o1 = await api('/api/orders', { method: 'POST', token: customer, body: {
    slug: 'achuza', items: [{ item_id: achItem.id, qty: 1 }], address: 'הרצל 1' } });
  assert.equal(o1.status, 201, JSON.stringify(o1.json));
  assert.equal(Number(o1.json.order.subtotal), Number(achItem.price) - 5);

  // באקספרס — אותו לקוח, מחיר רגיל (אין דליפת מחירון בין מכבסות)
  const exItem = (await api('/api/laundries/express')).json.items[0];
  const o2 = await api('/api/orders', { method: 'POST', token: customer, body: {
    slug: 'express', items: [{ item_id: exItem.id, qty: 1 }], address: 'הרצל 1' } });
  assert.equal(o2.status, 201, JSON.stringify(o2.json));
  assert.equal(Number(o2.json.order.subtotal), Number(exItem.price));
  assert.equal(o2.json.order.business_account_id, null);

  // לקוח לא מורשה לנתיבי ניהול עסקיים
  const r = await api('/api/t/achuza/business-accounts', { token: customer });
  assert.equal(r.status, 403);
});
