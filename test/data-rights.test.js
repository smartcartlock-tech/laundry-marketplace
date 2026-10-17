// C2 + G17.T6: ייצוא מידע אישי מלא + מחיקת חשבון ב-OTP עם חסימת הזמנה פעילה (תיקון 13)
const { test } = require('node:test');
const assert = require('node:assert');
const { startApp, TEST_DB } = require('./helpers');
const { Client } = require('pg');

test('C2+T6: export מחזיר את כל המידע; delete דורש OTP, חוסם על הזמנה פעילה, מנמיך ומבטל טוקן', async (t) => {
  const { api, schema } = await startApp(t);
  const phone = '+972500000601';
  const token = await api.login(phone, 'ישראל ישראלי');

  // כתובת שמורה + הזמנה
  const db = new Client({ connectionString: TEST_DB, options: `-c search_path=${schema},public` });
  await db.connect();
  t.after(() => db.end());
  const { rows: u } = await db.query('SELECT id FROM users WHERE phone=$1', [phone]);
  const uid = u[0].id;
  await db.query(`INSERT INTO user_addresses(user_id, label, address) VALUES ($1,'בית','הרצל 12')`, [uid]);
  const page = await api('/api/laundries/achuza');
  const item = page.json.items[0];
  const created = await api('/api/orders', { method: 'POST', token, body: { slug: 'achuza', items: [{ item_id: item.id, qty: 1 }], address: 'הרצל 12, תל אביב' } });
  const oid = created.json.order.id;

  // ייצוא
  const exp = await api('/api/me/export', { token });
  assert.equal(exp.status, 200);
  assert.equal(exp.json.profile.phone, phone);
  assert.equal(exp.json.profile.name, 'ישראל ישראלי');
  assert.equal(exp.json.profile.token_version, undefined, 'שדה פנימי לא מיוצא');
  assert.equal(exp.json.addresses.length, 1);
  assert.equal(exp.json.addresses[0].address, 'הרצל 12');
  assert.ok(exp.json.orders.find(o => o.id === oid), 'ההזמנה בייצוא');
  assert.equal(exp.json.orders[0].items.length, 1);

  // G17.T6: מחיקה דורשת OTP ייעודי; הזמנה פעילה חוסמת (409)
  const noCode = await api('/api/me', { method: 'DELETE', token, body: {} });
  assert.equal(noCode.status, 400, 'בלי קוד — 400');
  const otp1 = await api('/api/me/delete/request-otp', { method: 'POST', token });
  assert.equal(otp1.status, 200, JSON.stringify(otp1.json));
  assert.ok(otp1.json.demoCode, 'במצב דמו הקוד מוצג');
  const wrongCode = await api('/api/me', { method: 'DELETE', token, body: { code: '000000' } });
  assert.equal(wrongCode.status, 401, 'קוד שגוי — 401');
  const blocked = await api('/api/me', { method: 'DELETE', token, body: { code: otp1.json.demoCode } });
  assert.equal(blocked.status, 409, 'הזמנה פעילה חוסמת');
  assert.match(blocked.json.error, /הזמנות פעילות/);
  // מבטלים את ההזמנה ומבקשים קוד חדש
  await db.query(`UPDATE orders SET status='cancelled' WHERE id=$1`, [oid]);
  const otp2 = await api('/api/me/delete/request-otp', { method: 'POST', token });
  const del = await api('/api/me', { method: 'DELETE', token, body: { code: otp2.json.demoCode } });
  assert.equal(del.status, 200, JSON.stringify(del.json));

  // הטוקן מת מיד
  const after = await api('/api/me/export', { token });
  assert.equal(after.status, 401);

  // ה-DB מנומש
  const { rows: au } = await db.query('SELECT phone, name, email, anonymized_at FROM users WHERE id=$1', [uid]);
  assert.equal(au[0].name, null);
  assert.match(au[0].phone, /^deleted_/);
  assert.ok(au[0].anonymized_at);
  const { rows: addr } = await db.query('SELECT 1 FROM user_addresses WHERE user_id=$1', [uid]);
  assert.equal(addr.length, 0, 'כתובות נמחקו');

  // ההזמנה נשמרת (חובת שמירת רשומות)
  const { rows: ord } = await db.query('SELECT status FROM orders WHERE id=$1', [oid]);
  assert.equal(ord.length, 1);

  // אותו טלפון יכול להירשם מחדש כחשבון נקי
  const fresh = await api.login(phone);
  const me = await api('/api/auth/me', { token: fresh });
  assert.equal(me.status, 200);
  assert.notEqual(me.json.user.id, uid, 'חשבון חדש, לא הישן');
});
