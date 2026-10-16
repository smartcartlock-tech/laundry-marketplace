// N1+N2: מרכז הודעות פנימי + תבניות הודעה
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers');

test('N1: מרכז הודעות — דורש התחברות, רישום, קריאה, סימון נקרא, מונה', async (t) => {
  const app = await startApp(t); t._app = app; const { api } = app;
  const anon = await api('/api/messages');
  assert.equal(anon.status, 401);

  const token = await api.login('+972500000002', 'לקוח דמו');

  // רישום הודעה פנימית ישירות דרך השכבה (כפי שמשימות עתידיות ישתמשו בה) — מול אותה סכימת בדיקה
  const { schema } = t._app;
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://postgres@127.0.0.1:5433/laundry_test';
  process.env.PGSCHEMA = schema;
  const { postUserMessage } = require('../src/usermessages');
  const { rows } = await require('../src/db').q("SELECT id FROM users WHERE phone='+972500000002'");
  await postUserMessage(rows[0].id, { kind: 'system', title: 'בדיקה', body: 'הודעה ראשונה' });
  await postUserMessage(rows[0].id, { kind: 'order', title: 'הזמנה', body: 'הודעה שנייה' });

  const list = await api('/api/messages', { token });
  assert.equal(list.status, 200);
  assert.equal(list.json.messages.length, 2);
  assert.equal(list.json.unread, 2);

  const c = await api('/api/messages/unread-count', { token });
  assert.equal(c.json.unread, 2);

  const id = list.json.messages[0].id;
  const rd = await api(`/api/messages/${id}/read`, { method: 'POST', token });
  assert.equal(rd.json.updated, 1);

  const all = await api('/api/messages/read-all', { method: 'POST', token });
  assert.equal(all.json.updated, 1);
  const after = await api('/api/messages/unread-count', { token });
  assert.equal(after.json.unread, 0);

  // N6: סימון כלא-נקרא מחזיר למונה; מחיקה מסירה לצמיתות
  const un = await api(`/api/messages/${id}/unread`, { method: 'POST', token });
  assert.equal(un.json.updated, 1);
  const afterUn = await api('/api/messages/unread-count', { token });
  assert.equal(afterUn.json.unread, 1);

  const del = await api(`/api/messages/${id}`, { method: 'DELETE', token });
  assert.equal(del.json.deleted, 1);
  const afterDel = await api('/api/messages', { token });
  assert.equal(afterDel.json.messages.length, 1);
  assert.equal(afterDel.json.unread, 0);

  // משתמש אחר לא רואה/לא מסמן הודעות שלי
  const other = await api.login('+972500000003');
  const oList = await api('/api/messages', { token: other });
  assert.equal(oList.json.messages.length, 0);

  // מחיקה של הודעה שאינה שלי — לא נוגע
  const { rows: mine } = await require('../src/db').q("SELECT id FROM user_messages WHERE user_id=(SELECT id FROM users WHERE phone='+972500000002')");
  const oDel = await api(`/api/messages/${mine[0].id}`, { method: 'DELETE', token: other });
  assert.equal(oDel.json.deleted, 0);
});

test('N2: תבניות הודעה — CRUD לאדמין בלבד, רינדור משתנים, ברירות דמו', async (t) => {
  const { api } = await startApp(t);
  const admin = await api.login('+972500000001');
  const customer = await api.login('+972500000002');

  const forbidden = await api('/api/admin/message-templates', { token: customer });
  assert.equal(forbidden.status, 403);

  const bad = await api('/api/admin/message-templates', { method: 'POST', token: admin, body: { key: '!!', title: 'x', body: 'y' } });
  assert.equal(bad.status, 400);

  const created = await api('/api/admin/message-templates', {
    method: 'POST', token: admin,
    body: { key: 'test_tpl', channel: 'in_app', title: 'שלום {{name}}', body: 'הזמנה {{order_id}} בסטטוס {{status}}', variables: ['name', 'order_id', 'status'] },
  });
  assert.equal(created.status, 201);

  const dup = await api('/api/admin/message-templates', { method: 'POST', token: admin, body: { key: 'test_tpl', title: 'x', body: 'y' } });
  assert.equal(dup.status, 409);

  const id = created.json.template.id;
  const prev = await api(`/api/admin/message-templates/${id}/preview`, {
    method: 'POST', token: admin, body: { vars: { name: 'דני', order_id: '1234', status: 'מוכנה' } },
  });
  assert.equal(prev.json.title, 'שלום דני');
  assert.equal(prev.json.body, 'הזמנה 1234 בסטטוס מוכנה');
  assert.equal(prev.json.simulated, true);

  const upd = await api(`/api/admin/message-templates/${id}`, { method: 'PUT', token: admin, body: { active: false } });
  assert.equal(upd.json.template.active, false);

  const seed = await api('/api/admin/message-templates/seed-defaults', { method: 'POST', token: admin });
  assert.equal(seed.json.inserted, 3);
  const seed2 = await api('/api/admin/message-templates/seed-defaults', { method: 'POST', token: admin });
  assert.equal(seed2.json.inserted, 0); // idempotent

  const del = await api(`/api/admin/message-templates/${id}`, { method: 'DELETE', token: admin });
  assert.equal(del.json.ok, true);
});
