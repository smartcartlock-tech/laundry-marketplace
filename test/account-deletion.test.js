// G17.T5/T6/T7: דפי מדיניות סטטיים; מחיקת חשבון מחוזקת (OTP + חסימים);
// אנונימיזציה מלאה — רשימת הטבלאות המכוסות נבדקת כאן מקצה לקצה.
const { test } = require('node:test');
const assert = require('node:assert');
const { startApp, TEST_DB } = require('./helpers');
const { Client } = require('pg');

async function dbFor(t, schema) {
  const db = new Client({ connectionString: TEST_DB, options: `-c search_path=${schema},public` });
  await db.connect();
  t.after(() => db.end());
  return db;
}
const uidOf = async (db, phone) => (await db.query('SELECT id FROM users WHERE phone=$1', [phone])).rows[0].id;

test('G17.T5: /privacy ו-/terms נגישים בלי התחברות ומסומנים מסמך דמו', async (t) => {
  const { base } = await startApp(t);
  for (const p of ['/privacy', '/terms']) {
    const r = await fetch(base + p);
    assert.equal(r.status, 200, p);
    const html = await r.text();
    assert.match(html, /מסמך דמו/, p + ' מסומן דמו');
    assert.match(html, /dir="rtl"/, p + ' RTL');
  }
  // /privacy.html הישיר גם עובד (סטטי)
  const r2 = await fetch(base + '/privacy.html');
  assert.equal(r2.status, 200);
});

test('G17.T6: preview מציג חוסמים/אזהרות ואת רשימות "מה נמחק/מה נשמר"; OTP נדרש', async (t) => {
  const { api, schema } = await startApp(t);
  const db = await dbFor(t, schema);
  const phone = '+972500000701';
  const token = await api.login(phone, 'משתמש מחיקה');
  const uid = await uidOf(db, phone);

  // משתמש נקי — אין חוסמים
  const clean = await api('/api/me/deletion-preview', { token });
  assert.equal(clean.status, 200);
  assert.equal(clean.json.can_delete, true);
  assert.ok(clean.json.will_delete.length >= 10, 'רשימת מחיקה מלאה');
  assert.ok(clean.json.kept.length >= 4, 'רשימת "מה נשמר" קיימת');

  // הזמנה פעילה → חוסם
  const page = await api('/api/laundries/achuza');
  const item = page.json.items[0];
  const created = await api('/api/orders', { method: 'POST', token, body: { slug: 'achuza', items: [{ item_id: item.id, qty: 1 }], address: 'הרצל 12' } });
  const oid = created.json.order.id;
  const blocked = await api('/api/me/deletion-preview', { token });
  assert.equal(blocked.json.can_delete, false);
  assert.equal(blocked.json.blockers[0].kind, 'active_orders');
  // מנוי פעיל → אזהרה בלבד
  const plan = (await db.query('SELECT id FROM subscription_plans LIMIT 1')).rows[0];
  if (plan) {
    await db.query(`INSERT INTO subscriptions(tenant_id, plan_id, user_id, status) SELECT tenant_id, id, $1, 'active' FROM subscription_plans WHERE id=$2`, [uid, plan.id]);
    const withSub = await api('/api/me/deletion-preview', { token });
    assert.ok(withSub.json.warnings.find(w => w.kind === 'active_subscription'), 'אזהרת מנוי פעיל');
  }
  // מחיקה עם OTP תקין עדיין נחסמת על ההזמנה הפעילה
  const otp = await api('/api/me/delete/request-otp', { method: 'POST', token });
  const del = await api('/api/me', { method: 'DELETE', token, body: { code: otp.json.demoCode } });
  assert.equal(del.status, 409);
  assert.equal(del.json.blockers[0].kind, 'active_orders');
  await db.query(`UPDATE orders SET status='cancelled' WHERE id=$1`, [oid]);
});

test('G17.T7: אנונימיזציה מלאה — כל הטבלאות האישיות מכוסות; מה שנשמר מנותק מזהות', async (t) => {
  const { api, schema } = await startApp(t);
  const db = await dbFor(t, schema);
  const phone = '+972500000702';
  const token = await api.login(phone, 'כיסוי מלא');
  const uid = await uidOf(db, phone);
  const tid = (await db.query(`SELECT id FROM tenants WHERE slug='achuza'`)).rows[0].id;
  const other = (await db.query(`INSERT INTO users(phone, name) VALUES ('+972500000799','בעלים אחר') RETURNING id`)).rows[0].id;

  // מילוי כל הטבלאות האישיות
  await db.query(`INSERT INTO user_addresses(user_id, label, address, courier_note) VALUES ($1,'בית','הרצל 1','קוד 123')`, [uid]);
  await db.query(`INSERT INTO user_carts(user_id, tenant_id, items) VALUES ($1,$2,'[]')`, [uid, tid]).catch(() => {});
  await db.query(`INSERT INTO push_subscriptions(user_id, endpoint, keys) VALUES ($1,'https://push.example/x','{}')`, [uid]);
  await db.query(`INSERT INTO user_laundry_prefs(user_id, scent, softener) VALUES ($1,'לבנדר',true)`, [uid]);
  await db.query(`INSERT INTO user_notification_prefs(user_id, marketing) VALUES ($1,false)`, [uid]);
  await db.query(`INSERT INTO user_favorites(user_id, tenant_id) VALUES ($1,$2)`, [uid, tid]);
  await db.query(`INSERT INTO family_invites(owner_user_id, token) VALUES ($1,'tok-test-1')`, [uid]);
  await db.query(`INSERT INTO family_members(owner_user_id, member_user_id) VALUES ($1,$2)`, [uid, other]);
  await db.query(`INSERT INTO reviews(tenant_id, user_id, rating, text) VALUES ($1,$2,5,'מעולה')`, [tid, uid]);
  await db.query(`INSERT INTO notifications(user_id, tenant_id, body) VALUES ($1,$2,'התראה')`, [uid, tid]);
  await db.query(`INSERT INTO user_messages(user_id, title, body) VALUES ($1,'כותרת','גוף')`, [uid]);
  const page = await api('/api/laundries/achuza');
  const item = page.json.items[0];
  const created = await api('/api/orders', { method: 'POST', token, body: { slug: 'achuza', items: [{ item_id: item.id, qty: 1 }], address: 'הרצל 1, תל אביב' } });
  const oid = created.json.order.id;
  await db.query(`UPDATE orders SET status='delivered', notes='הערה אישית', lat=32.1, lng=34.8 WHERE id=$1`, [oid]);
  const rep = (await db.query(`INSERT INTO issue_reports(order_id, tenant_id, customer_id, kind, text) VALUES ($1,$2,$3,'damage','נקרע שק') RETURNING id`, [oid, tid, uid])).rows[0].id;
  await db.query(`INSERT INTO issue_report_photos(report_id, data) VALUES ($1,'\\x0102')`, [rep]);
  const cid = (await db.query(`INSERT INTO couriers(user_id, model, vehicle, areas) VALUES ($1,'private','אופניים','{מרכז}') RETURNING id`, [uid])).rows[0].id;
  await db.query(`INSERT INTO courier_documents(courier_id, kind, filename, mime, data) VALUES ($1,'license','lic.jpg','image/jpeg','\\x0102')`, [cid]);
  await db.query(`INSERT INTO tenant_members(tenant_id, user_id, role) VALUES ($1,$2,'staff')`, [tid, uid]);
  const ba = (await db.query(`INSERT INTO business_accounts(tenant_id, name) VALUES ($1,'עסק בדיקה') RETURNING id`, [tid])).rows[0].id;
  await db.query(`INSERT INTO business_account_users(account_id, user_id) VALUES ($1,$2)`, [ba, uid]);
  await db.query(`INSERT INTO recurring_templates(account_id, user_id, days, items, address) VALUES ($1,$2,'[1]','[]','הרצל 1')`, [ba, uid]);
  const plan = (await db.query('SELECT id FROM subscription_plans LIMIT 1')).rows[0];
  if (plan) await db.query(`INSERT INTO subscriptions(tenant_id, plan_id, user_id, status) SELECT tenant_id, id, $1, 'active' FROM subscription_plans WHERE id=$2`, [uid, plan.id]);

  // G17.T35: ייצוא נרשם ביומן ביקורת בלי PII + הודעה ללקוח
  const exp = await api('/api/me/export', { token });
  assert.equal(exp.status, 200);
  const aud1 = await db.query(`SELECT actor_label, action FROM audit_log WHERE actor_id=$1 AND action='me.export'`, [uid]);
  assert.equal(aud1.rows.length, 1, 'ייצוא נרשם ביומן');
  assert.equal(aud1.rows[0].actor_label, null, 'בלי PII ביומן (actor_label ריק)');
  const notif1 = await db.query('SELECT channel FROM notifications WHERE user_id=$1', [uid]);
  assert.ok(notif1.rows.length >= 1, 'הודעת ייצוא ללקוח נרשמה');

  // מחיקה עם OTP
  const otp = await api('/api/me/delete/request-otp', { method: 'POST', token });
  assert.equal(otp.status, 200, JSON.stringify(otp.json));
  const del = await api('/api/me', { method: 'DELETE', token, body: { code: otp.json.demoCode } });
  assert.equal(del.status, 200, JSON.stringify(del.json));

  // כל הטבלאות ריקות / מנומשות
  const count = async (sql, ...args) => (await db.query(sql, args)).rows[0].n;
  assert.equal(await count('SELECT count(*)::int n FROM user_addresses WHERE user_id=$1', uid), 0, 'user_addresses');
  assert.equal(await count('SELECT count(*)::int n FROM user_carts WHERE user_id=$1', uid), 0, 'user_carts');
  assert.equal(await count('SELECT count(*)::int n FROM push_subscriptions WHERE user_id=$1', uid), 0, 'push_subscriptions');
  assert.equal(await count('SELECT count(*)::int n FROM auth_sessions WHERE user_id=$1', uid), 0, 'auth_sessions');
  assert.equal(await count('SELECT count(*)::int n FROM otp_codes WHERE target=$1', phone), 0, 'otp_codes');
  assert.equal(await count('SELECT count(*)::int n FROM account_deletion_otps WHERE user_id=$1', uid), 0, 'account_deletion_otps');
  assert.equal(await count('SELECT count(*)::int n FROM user_laundry_prefs WHERE user_id=$1', uid), 0, 'user_laundry_prefs');
  assert.equal(await count('SELECT count(*)::int n FROM user_notification_prefs WHERE user_id=$1', uid), 0, 'user_notification_prefs');
  assert.equal(await count('SELECT count(*)::int n FROM user_favorites WHERE user_id=$1', uid), 0, 'user_favorites');
  assert.equal(await count('SELECT count(*)::int n FROM family_invites WHERE owner_user_id=$1', uid), 0, 'family_invites');
  assert.equal(await count('SELECT count(*)::int n FROM family_members WHERE owner_user_id=$1 OR member_user_id=$1', uid), 0, 'family_members');
  assert.equal(await count('SELECT count(*)::int n FROM reviews WHERE user_id=$1', uid), 0, 'reviews');
  // T35: התראות קודמות נמחקו; נשארה רק הודעת האישור על המחיקה עצמה (נבדקת בסוף)
  assert.equal(await count(`SELECT count(*)::int n FROM notifications WHERE user_id=$1 AND body NOT LIKE '%נמחק%'`, uid), 0, 'notifications');
  assert.equal(await count('SELECT count(*)::int n FROM user_messages WHERE user_id=$1', uid), 0, 'user_messages');
  assert.equal(await count('SELECT count(*)::int n FROM issue_report_photos WHERE report_id=$1', rep), 0, 'issue_report_photos');
  const repRow = (await db.query('SELECT text FROM issue_reports WHERE id=$1', [rep])).rows[0];
  assert.equal(repRow.text, '', 'טקסט דיווח הושמט');
  assert.equal(await count('SELECT count(*)::int n FROM courier_documents WHERE courier_id=$1', cid), 0, 'courier_documents');
  const cour = (await db.query('SELECT vehicle, areas FROM couriers WHERE id=$1', [cid])).rows[0];
  assert.equal(cour.vehicle, null, 'פרופיל שליח מנומש');
  assert.deepEqual(cour.areas, [], 'אזורי שליח מנומשים');
  assert.equal(await count('SELECT count(*)::int n FROM tenant_members WHERE user_id=$1', uid), 0, 'tenant_members');
  assert.equal(await count('SELECT count(*)::int n FROM business_account_users WHERE user_id=$1', uid), 0, 'business_account_users');
  assert.equal(await count('SELECT count(*)::int n FROM recurring_templates WHERE user_id=$1', uid), 0, 'recurring_templates');
  if (plan) assert.equal(await count(`SELECT count(*)::int n FROM subscriptions WHERE user_id=$1 AND status='active'`, uid), 0, 'מנוי פעיל בוטל');

  // מה נשמר — מנותק מזהות
  const ord = (await db.query('SELECT address, lat, lng, notes FROM orders WHERE id=$1', [oid])).rows[0];
  assert.equal(ord.address, '', 'כתובת איסוף הושמטה');
  assert.equal(ord.lat, null); assert.equal(ord.lng, null); assert.equal(ord.notes, null);
  const usr = (await db.query('SELECT name, email, phone, anonymized_at, google_sub FROM users WHERE id=$1', [uid])).rows[0];
  assert.equal(usr.name, null); assert.equal(usr.email, null); assert.equal(usr.google_sub, null);
  assert.match(usr.phone, /^deleted_/);
  assert.ok(usr.anonymized_at);

  // G17.T35: מחיקה נרשמת ביומן בלי PII + הודעת אישור ללקוח נשמרת
  const aud2 = await db.query(`SELECT actor_label FROM audit_log WHERE actor_id=$1 AND action='me.delete'`, [uid]);
  assert.equal(aud2.rows.length, 1, 'מחיקה נרשמה ביומן');
  assert.equal(aud2.rows[0].actor_label, null, 'בלי PII ביומן המחיקה');
  const notif2 = await db.query(`SELECT channel FROM notifications WHERE user_id=$1 AND body LIKE '%נמחק%'`, [uid]);
  assert.equal(notif2.rows.length, 1, 'הודעת אישור מחיקה נרשמה');

  // הטוקן מת
  assert.equal((await api('/api/me/export', { token })).status, 401);
});

test('G17.T6: בעלים יחיד של מכבסה — מחיקה נחסמת', async (t) => {
  const { api, schema } = await startApp(t);
  const db = await dbFor(t, schema);
  const phone = '+972500000703';
  const token = await api.login(phone, 'בעלים יחיד');
  const uid = await uidOf(db, phone);
  const tid = (await db.query(`SELECT id FROM tenants WHERE slug='achuza'`)).rows[0].id;
  await db.query(`INSERT INTO tenant_members(tenant_id, user_id, role) VALUES ($1,$2,'owner') ON CONFLICT DO NOTHING`, [tid, uid]);
  // אם כבר יש חברים נוספים בטננט הדמו — מסירים אותם לצורך התרחיש (סכימת טסט מבודדת)
  await db.query(`DELETE FROM tenant_members WHERE tenant_id=$1 AND user_id<>$2`, [tid, uid]);
  const prev = await api('/api/me/deletion-preview', { token });
  assert.equal(prev.json.can_delete, false);
  assert.ok(prev.json.blockers.find(b => b.kind === 'sole_tenant_owner'), 'חוסם בעלים יחיד');
  const otp = await api('/api/me/delete/request-otp', { method: 'POST', token });
  const del = await api('/api/me', { method: 'DELETE', token, body: { code: otp.json.demoCode } });
  assert.equal(del.status, 409);
});
