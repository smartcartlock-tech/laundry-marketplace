// T83: צ'אט תמיכה — הרשאות, בידוד טנאנטים, צפיית אדמין מתועדת, rate limit, XSS
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { startApp } = require('./helpers');

test('T83 E2E: פתיחה, שליחה, נקרא, הרשאות, בידוד, אדמין, סגירה, XSS, rate limit', async (t) => {
  const { api } = await startApp(t);
  const customer = await api.login('+972500000002');
  const owner = await api.login('+972500000003');   // חבר ב-achuza בלבד
  const admin = await api.login('+972500000001');
  const stranger = await api.login('+972500000088', 'לקוח זר');

  // פתיחת שרשור — מכבסה לא קיימת
  const badT = await api('/api/chat/threads', { method: 'POST', token: customer, body: { slug: 'no-such' } });
  assert.equal(badT.status, 404);

  // פתיחה תקינה + אידמפוטנטיות (אותו שרשור פתוח חוזר)
  const c1 = await api('/api/chat/threads', { method: 'POST', token: customer, body: { slug: 'achuza' } });
  assert.equal(c1.status, 201);
  const tid = c1.json.thread.id;
  const c2 = await api('/api/chat/threads', { method: 'POST', token: customer, body: { slug: 'achuza' } });
  assert.equal(c2.status, 200);
  assert.equal(c2.json.thread.id, tid);

  // XSS: תוכן עוין נשמר כטקסט ומקודד ב-client
  const xss = '<img src=x onerror=alert(1)><script>alert(2)</script>';
  const m1 = await api('/api/chat/threads/' + tid + '/messages', { method: 'POST', token: customer, body: { body: xss } });
  assert.equal(m1.status, 201);
  assert.equal(m1.json.message.sender_role, 'customer');
  const empty = await api('/api/chat/threads/' + tid + '/messages', { method: 'POST', token: customer, body: { body: '  ' } });
  assert.equal(empty.status, 400);
  const tooLong = await api('/api/chat/threads/' + tid + '/messages', { method: 'POST', token: customer, body: { body: 'א'.repeat(2001) } });
  assert.equal(tooLong.status, 400);

  // הרשאות: זר לא קורא ולא כותב
  const sRead = await api('/api/chat/threads/' + tid + '/messages', { token: stranger });
  assert.equal(sRead.status, 403);
  const sWrite = await api('/api/chat/threads/' + tid + '/messages', { method: 'POST', token: stranger, body: { body: 'פריצה' } });
  assert.equal(sWrite.status, 403);
  const sReadList = await api('/api/chat/t/achuza/threads', { token: stranger });
  assert.equal(sReadList.status, 403);

  // בידוד טנאנטים: שרשור ב-express — בעל achuza לא ניגש
  const cOther = await api('/api/chat/threads', { method: 'POST', token: customer, body: { slug: 'express' } });
  assert.equal(cOther.status, 201);
  const oRead = await api('/api/chat/threads/' + cOther.json.thread.id + '/messages', { token: owner });
  assert.equal(oRead.status, 403);

  // בעל המכבסה: רשימה + קריאה + מענה; הודעת הלקוח מסומנת נקרא אחרי /read של הבעלים
  const list = await api('/api/chat/t/achuza/threads', { token: owner });
  assert.equal(list.status, 200);
  assert.ok(list.json.threads.some(x => x.id === tid && x.unread === 1), 'הודעת לקוח מופיעה כלא-נקראה אצל הבעלים');
  const oMsg = await api('/api/chat/threads/' + tid + '/messages', { method: 'POST', token: owner, body: { body: 'שלום, איך נעזור?' } });
  assert.equal(oMsg.status, 201);
  assert.equal(oMsg.json.message.sender_role, 'laundry');
  await api('/api/chat/threads/' + tid + '/read', { method: 'POST', token: owner });
  const afterRead = await api('/api/chat/threads/' + tid + '/messages', { token: customer });
  const custMsg = afterRead.json.messages.find(m => m.sender_role === 'customer');
  assert.ok(custMsg.read_at, 'הלקוח רואה שהבעלים קרא');
  await api('/api/chat/threads/' + tid + '/read', { method: 'POST', token: customer });
  const list2 = await api('/api/chat/t/achuza/threads', { token: owner });
  assert.equal(list2.json.threads.find(x => x.id === tid).unread, 0);

  // אדמין: רשימה + צפייה מתועדת; לא יכול לכתוב
  const aList = await api('/api/chat/admin/threads', { token: admin });
  assert.equal(aList.status, 200);
  assert.ok(aList.json.threads.some(x => x.id === tid));
  const aRead = await api('/api/chat/threads/' + tid + '/messages', { token: admin });
  assert.equal(aRead.status, 200);
  assert.equal(aRead.json.viewer_role, 'admin');
  assert.ok(aRead.json.thread.admin_viewed_at, 'צפיית מנהל תועדה');
  assert.ok(aRead.json.messages.some(m => m.body === xss), 'תוכן נשמר כטקסט גולמי');
  const aWrite = await api('/api/chat/threads/' + tid + '/messages', { method: 'POST', token: admin, body: { body: 'מנהל כותב' } });
  assert.equal(aWrite.status, 403, 'אדמין צופה בלבד');
  // הסימון גלוי ללקוח ברשימה
  const mine = await api('/api/chat/threads/mine', { token: customer });
  assert.ok(mine.json.threads.find(x => x.id === tid).admin_viewed_at, 'הלקוח רואה "צפיית מנהל"');
  // לקוח לא ניגש לנקודות של בעלים/אדמין
  assert.equal((await api('/api/chat/t/achuza/threads', { token: customer })).status, 403);
  assert.equal((await api('/api/chat/admin/threads', { token: customer })).status, 403);

  // סגירה — ואז אי אפשר לכתוב
  const close = await api('/api/chat/threads/' + tid + '/close', { method: 'POST', token: owner });
  assert.equal(close.status, 200);
  const afterClose = await api('/api/chat/threads/' + tid + '/messages', { method: 'POST', token: customer, body: { body: 'עוד?' } });
  assert.equal(afterClose.status, 409);
  // אחרי סגירה, פתיחה חדשה יוצרת שרשור חדש
  const c3 = await api('/api/chat/threads', { method: 'POST', token: customer, body: { slug: 'achuza' } });
  assert.equal(c3.status, 201);
  assert.notEqual(c3.json.thread.id, tid);

  // rate limit: 60 כתיבות בחלון — ה-61 חוזרת 429 (שרשור חדש פתוח)
  const rlTid = c3.json.thread.id;
  let last;
  for (let i = 0; i < 61; i++) last = await api('/api/chat/threads/' + rlTid + '/messages', { method: 'POST', token: customer, body: { body: 'm' + i } });
  assert.equal(last.status, 429, 'חריגה ממגבלת הכתיבה נחסמת');

  // XSS בצד לקוח: כל הודעה מוצגת דרך esc()
  const js = fs.readFileSync('public/js/support-chat.js', 'utf8');
  assert.ok(js.includes('${esc(m.body)}'), 'תוכן הודעה מקודד ב-esc בהצגה');
});
