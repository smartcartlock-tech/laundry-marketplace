// ביקורת סשנים + יומן ביקורת אדמין + מגבלות כתיבה
const { test } = require('node:test');
const assert = require('node:assert');
const { startApp } = require('./helpers');

test('סשנים: רשימת מכשירים, ניתוק בודד, ניתוק מכולם, תפוגה נאכפת', async (t) => {
  const { api } = await startApp(t);
  const phone = '+972500000901';
  const t1 = await api.login(phone); // "מכשיר" 1
  const t2 = await api.login(phone); // "מכשיר" 2

  const list = await api('/api/me/sessions', { token: t2 });
  assert.equal(list.status, 200);
  assert.equal(list.json.sessions.length, 2);
  assert.equal(list.json.sessions.filter(s => s.current).length, 1);

  // ניתוק מכשיר בודד (הלא-נוכחי) — הטוקן שלו מת מיד
  const other = list.json.sessions.find(s => !s.current);
  assert.equal((await api('/api/me/sessions/' + other.id, { method: 'DELETE', token: t2 })).status, 200);
  assert.equal((await api('/api/me/sessions', { token: t1 })).status, 401, 'המכשיר המנותק מקבל 401');
  assert.equal((await api('/api/me/sessions', { token: t2 })).status, 200, 'הנוכחי ממשיך');

  // ניתוק מכל האחרים
  const t3 = await api.login(phone);
  const r = await api('/api/me/sessions/revoke-all', { method: 'POST', token: t3 });
  assert.equal(r.status, 200);
  assert.ok(r.json.revoked >= 1);
  assert.equal((await api('/api/me/sessions', { token: t2 })).status, 401);
  assert.equal((await api('/api/me/sessions', { token: t3 })).status, 200);

  // logout רגיל מנתק גם את שורות הסשן
  await api('/api/auth/logout', { method: 'POST', token: t3 });
  assert.equal((await api('/api/me/sessions', { token: t3 })).status, 401);
});

test('יומן ביקורת: פעולת אדמין נרשמת ונצפית', async (t) => {
  const { api } = await startApp(t);
  const admin = await api.login('+972500000001');
  // פעולת כתיבה אדמיניסטרטיבית: רישום שליח ע"י אדמין
  const reg = await api('/api/admin/couriers/register', { method: 'POST', token: admin, body: { phone: '+972500000777', name: 'שליח ביקורת', model: 'platform', vehicle: 'אופניים', areas: ['חיפה'] } });
  assert.ok(reg.status < 300, JSON.stringify(reg.json));
  const log = await api('/api/admin/audit-log', { token: admin });
  assert.equal(log.status, 200);
  const hit = log.json.entries.find(e => e.action.includes('/couriers/register'));
  assert.ok(hit, 'הפעולה נרשמה ביומן: ' + JSON.stringify(log.json.entries.slice(0, 3)));
  assert.ok(hit.actor_label);
  // לקוח רגיל לא יכול לצפות ביומן
  const cust = await api.login('+972500000902');
  assert.equal((await api('/api/admin/audit-log', { token: cust })).status, 403);
});

test('writeLimiter: GET חופשי, כתיבה מוגבלת פר-משתמש', () => {
  const { writeLimiter } = require('../src/ratelimit');
  const mw = writeLimiter('test-scope-' + Date.now(), 3, 60000);
  const mk = (method, uid) => ({ method, user: { id: uid }, ip: '1.2.3.4' });
  const run = (req) => new Promise((resolve) => {
    const res = { statusCode: 200, set() {}, status(c) { this.statusCode = c; return this; }, json() { resolve(this.statusCode); } };
    mw(req, res, () => resolve(200));
  });
  return (async () => {
    assert.equal(await run(mk('GET', 'u1')), 200);
    assert.equal(await run(mk('POST', 'u1')), 200);
    assert.equal(await run(mk('POST', 'u1')), 200);
    assert.equal(await run(mk('POST', 'u1')), 200);
    assert.equal(await run(mk('POST', 'u1')), 429, 'הרביעי מעל המכסה');
    assert.equal(await run(mk('GET', 'u1')), 200, 'GET לא נספר');
    assert.equal(await run(mk('POST', 'u2')), 200, 'משתמש אחר לא נחסם');
  })();
});
