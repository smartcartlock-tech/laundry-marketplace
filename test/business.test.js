// E4.T1: חשבון עסקי B2B — CRUD מלא, מחירון הסכמי דורס מחיר רגיל בהזמנה, שיוך משתמשים
const { test } = require('node:test');
const assert = require('node:assert');
const { startApp } = require('./helpers');

test('business accounts: CRUD, contractual price override, user linking', async (t) => {
  const { api } = await startApp(t);
  const owner = await api.login('+972500000003', 'בעל מכבסה לדמו');
  const customer = await api.login('+972500000002', 'לקוח דמו');

  // יצירת חשבון עסקי
  const created = await api('/api/t/achuza/business-accounts', { method: 'POST', token: owner, body: {
    name: 'מלון ים התיכון בע"מ', company_id: '514455667', contact_name: 'דנה לוי', contact_phone: '+972501234567', payment_terms: 'net30' } });
  assert.equal(created.status, 200, JSON.stringify(created.json));
  const acc = created.json.account;
  assert.equal(acc.company_id, '514455667');
  assert.equal(acc.payment_terms, 'net30');

  // לקוח רגיל לא מורשה לניהול חשבונות
  const forbidden = await api('/api/t/achuza/business-accounts', { token: customer });
  assert.equal(forbidden.status, 403);

  // פריט מהמחירון
  const pub = await api('/api/laundries/achuza');
  const item = pub.json.items.find(i => i.unit === 'bag') || pub.json.items[0];
  const regular = Number(item.price);

  // מחיר הסכמי נמוך מהרגיל
  const setP = await api(`/api/t/achuza/business-accounts/${acc.id}/prices`, { method: 'PUT', token: owner, body: {
    prices: [{ item_id: item.id, price: regular - 5 }] } });
  assert.equal(setP.status, 200, JSON.stringify(setP.json));

  // הזמנה לפני שיוך — מחיר רגיל
  const before = await api('/api/orders', { method: 'POST', token: customer, body: {
    slug: 'achuza', items: [{ item_id: item.id, qty: 1 }], address: 'הרצל 1, תל אביב' } });
  assert.equal(before.status, 201, JSON.stringify(before.json));
  assert.equal(Number(before.json.order.subtotal), regular);

  // שיוך הלקוח לחשבון
  const link = await api(`/api/t/achuza/business-accounts/${acc.id}/users`, { method: 'POST', token: owner, body: { phone: '+972500000002' } });
  assert.equal(link.status, 200, JSON.stringify(link.json));

  // הזמנה אחרי שיוך — המחיר ההסכמי גובר
  const after = await api('/api/orders', { method: 'POST', token: customer, body: {
    slug: 'achuza', items: [{ item_id: item.id, qty: 1 }], address: 'הרצל 1, תל אביב' } });
  assert.equal(after.status, 201, JSON.stringify(after.json));
  assert.equal(Number(after.json.order.subtotal), regular - 5);
  assert.equal(after.json.order.business_account_id, acc.id);

  // פירוט חשבון: מחירון + משתמשים
  const detail = await api(`/api/t/achuza/business-accounts/${acc.id}`, { token: owner });
  assert.equal(detail.json.prices.length, 1);
  assert.equal(detail.json.users.length, 1);
  assert.equal(detail.json.users[0].phone, '+972500000002');

  // עדכון + השבתה
  const patched = await api(`/api/t/achuza/business-accounts/${acc.id}`, { method: 'PATCH', token: owner, body: { contact_name: 'דנה כהן', active: false } });
  assert.equal(patched.json.account.contact_name, 'דנה כהן');
  assert.equal(patched.json.account.active, false);

  // לאחר השבתה — חוזר למחיר רגיל
  const off = await api('/api/orders', { method: 'POST', token: customer, body: {
    slug: 'achuza', items: [{ item_id: item.id, qty: 1 }], address: 'הרצל 1, תל אביב' } });
  assert.equal(Number(off.json.order.subtotal), regular);

  // מחיקה
  const del = await api(`/api/t/achuza/business-accounts/${acc.id}`, { method: 'DELETE', token: owner });
  assert.equal(del.json.ok, true);
  const list = await api('/api/t/achuza/business-accounts', { token: owner });
  assert.equal(list.json.accounts.find(a => a.id === acc.id), undefined);
});
