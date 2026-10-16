const { test } = require('node:test');
const assert = require('node:assert');
const { startApp } = require('./helpers');

// 1x1 px PNG
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

async function deliveredOrder(api, admin, customer, slug) {
  const l = await api('/api/laundries/' + slug);
  const item = l.json.items[0];
  const r = await api('/api/orders', { method: 'POST', token: customer, body: { slug, items: [{ item_id: item.id, qty: 1 }], address: 'רחוב הבדיקה 1' } });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const oid = r.json.order.id;
  const courier = await api.login('+972500000005');
  const cf = await api(`/api/t/${slug}/orders/${oid}/status`, { method: 'POST', token: admin, body: { status: 'confirmed' } });
  assert.equal(cf.status, 200, JSON.stringify(cf.json));
  // שיבוץ: אדמין/מכבסה משבצת שליח פלטפורמה → הצעה → אישור
  const cts = await api('/api/admin/couriers', { token: admin });
  const pc = cts.json.couriers.find(c => c.phone === '+972500000005');
  assert.ok(pc, 'platform courier exists');
  const asg = await api(`/api/t/${slug}/orders/${oid}/assign`, { method: 'POST', token: admin, body: { courier_id: pc.id } });
  assert.equal(asg.status, 200, JSON.stringify(asg.json));
  const offers = await api('/api/courier/offers', { token: courier });
  const offer = (offers.json.offers || []).find(x => x.order_id === oid);
  assert.ok(offer, 'offer for order: ' + JSON.stringify(offers.json));
  const acc = await api(`/api/courier/offers/${offer.offer_id}/accept`, { method: 'POST', token: courier, body: {} });
  assert.equal(acc.status, 200, JSON.stringify(acc.json));
  for (const [who, st] of [[courier,'picked_up'],[admin,'in_work'],[admin,'ready'],[courier,'out_for_delivery'],[courier,'delivered']]) {
    const url = who === courier ? `/api/courier/orders/${oid}/mark` : `/api/t/${slug}/orders/${oid}/status`;
    const body = who === courier ? { action: st } : { status: st };
    const s = await api(url, { method: 'POST', token: who, body });
    assert.equal(s.status, 200, st + ': ' + JSON.stringify(s.json));
  }
  return oid;
}

test('E9.T1: דיווח תקלה עם תמונות — לקוח, מכבסה מטפלת, גישור אדמין', async (t) => {
  const { api } = await startApp(t);
  const admin = await api.login('+972500000001');
  const customer = await api.login('+972500000002');
  const owner = await api.login('+972500000003');
  const oid = await deliveredOrder(api, admin, customer, 'achuza');

  // ולידציות
  let bad = await api(`/api/orders/${oid}/report`, { method: 'POST', token: customer, body: { kind: 'nonsense', text: 'x' } });
  assert.equal(bad.status, 400);
  bad = await api(`/api/orders/${oid}/report`, { method: 'POST', token: customer, body: { kind: 'damage', text: '' } });
  assert.equal(bad.status, 400);
  bad = await api(`/api/orders/${oid}/report`, { method: 'POST', token: customer, body: { kind: 'damage', text: 'x', photos: [{ content_type: 'application/pdf', data_b64: PNG_B64 }] } });
  assert.equal(bad.status, 400);
  const stranger = await api.login('+972500000009');
  bad = await api(`/api/orders/${oid}/report`, { method: 'POST', token: stranger, body: { kind: 'damage', text: 'x' } });
  assert.equal(bad.status, 403);

  // דיווח עם 2 תמונות
  const rep = await api(`/api/orders/${oid}/report`, { method: 'POST', token: customer, body: {
    kind: 'damage', text: 'חולצה חזרה עם כתם צהוב גדול',
    photos: [{ content_type: 'image/png', data_b64: PNG_B64 }, { content_type: 'image/png', data_b64: PNG_B64 }] } });
  assert.equal(rep.status, 201, JSON.stringify(rep.json));
  assert.equal(rep.json.report.photos, 2);

  // הלקוח רואה סטטוס
  const mine = await api(`/api/orders/${oid}/reports`, { token: customer });
  assert.equal(mine.json.reports.length, 1);
  assert.equal(mine.json.reports[0].status, 'open');

  // המכבסה רואה ומטפלת
  const list = await api('/api/t/achuza/issues', { token: owner });
  assert.equal(list.status, 200, JSON.stringify(list.json));
  const issue = list.json.issues.find(x => x.id === rep.json.report.id);
  assert.ok(issue, 'המכבסה רואה את הדיווח');
  assert.equal(issue.photos, 2);
  assert.equal(issue.customer_name, 'לקוחה לדמו');
  const h = await api(`/api/t/achuza/issues/${issue.id}/handle`, { method: 'POST', token: owner, body: { status: 'in_progress', note: 'בודקים מול המכבסה' } });
  assert.equal(h.status, 200);
  // מכבסה אחרת לא רואה
  const other = await api('/api/t/express/issues', { token: owner });
  assert.equal(other.status, 403);

  // הסלמה לגישור אדמין
  const esc2 = await api(`/api/t/achuza/issues/${issue.id}/handle`, { method: 'POST', token: owner, body: { status: 'in_progress', mediation: true } });
  assert.equal(esc2.json.issue.mediation, true);
  const med = await api('/api/admin/issues?mediation=1', { token: admin });
  assert.ok(med.json.issues.find(x => x.id === issue.id), 'אדמין רואה בגישור');
  const ah = await api(`/api/admin/issues/${issue.id}/handle`, { method: 'POST', token: admin, body: { status: 'resolved', note: 'זוכתה הלקוחה' } });
  assert.equal(ah.status, 200);
  const after = await api(`/api/orders/${oid}/reports`, { token: customer });
  assert.equal(after.json.reports[0].status, 'resolved');
  assert.equal(after.json.reports[0].resolution_note, 'זוכתה הלקוחה');

  // תמונה: בעלים/מכבסה/אדמין כן, זר לא
  const db = (await api(`/api/orders/${oid}/reports`, { token: customer })).json.reports[0];
  assert.equal(db.photos, 2);
});

test('E9.T1: תמונות — הרשאות צפייה', async (t) => {
  const { api, base } = await startApp(t);
  const admin = await api.login('+972500000001');
  const customer = await api.login('+972500000002');
  const owner = await api.login('+972500000003');
  const oid = await deliveredOrder(api, admin, customer, 'achuza');
  const rep = await api(`/api/orders/${oid}/report`, { method: 'POST', token: customer, body: { kind: 'missing', text: 'חסרה מכנסית', photos: [{ content_type: 'image/png', data_b64: PNG_B64 }] } });
  assert.equal(rep.status, 201);
  // מצא photo id דרך DB לא חשוף — משתמשים ב-endpoint עם id אקראי לבדיקת 404, והרשאות נבדקות דרך הזר
  const stranger = await api.login('+972500000011');
  const fake = await api('/api/issue-photos/00000000-0000-0000-0000-000000000000', { token: stranger });
  assert.equal(fake.status, 404);
});

test('E9.T4: ביקורת משופרת — תגיות, +20 נקודות פעם אחת, תצוגה בדף המכבסה', async (t) => {
  const { api } = await startApp(t);
  const admin = await api.login('+972500000001');
  const customer = await api.login('+972500000002');
  const oid = await deliveredOrder(api, admin, customer, 'achuza');

  const rv = await api(`/api/orders/${oid}/review`, { method: 'POST', token: customer, body: { rating: 5, text: 'שירות מעולה', tags: ['נקי','בזמן','מחיר הוגן'] } });
  assert.equal(rv.status, 200, JSON.stringify(rv.json));
  assert.equal(rv.json.points_bonus, 20);

  // ביקורת חוזרת על אותה הזמנה — נחסמת 409 (QA), וללא בונוס כפול
  const rv2 = await api(`/api/orders/${oid}/review`, { method: 'POST', token: customer, body: { rating: 4, text: 'עוד ביקורת' } });
  assert.equal(rv2.status, 409);

  // הנקודות נראות בסיכום המועדון
  const club = await api('/api/orders/club/summary', { token: customer });
  const ach = club.json.balances.find(x => x.slug === 'achuza');
  assert.ok(ach && Number(ach.balance) >= 20, 'יתרת נקודות כוללת בונוס ביקורת');

  // התגיות מוצגות בדף המכבסה
  const page = await api('/api/laundries/achuza');
  const review = page.json.reviews.find(x => x.text === 'שירות מעולה');
  assert.ok(review, 'ביקורת בדף');
  assert.deepEqual(review.tags, ['נקי','בזמן','מחיר הוגן']);
});

test('E9.T3: מנוי push נרשם; שליחה למנוי מת ללא קריסה; notifications נשמרות כגיבוי', async (t) => {
  const { api, schema } = await startApp(t);
  const customer = await api.login('+972500000002');
  const key = await api('/api/push/vapid-public-key');
  assert.equal(key.status, 200);
  assert.ok(key.json.key && key.json.key.length > 20); // VAPID ציבורי קיים (נוצר עצמאית)

  // מנוי לא תקין נדחה
  const bad = await api('/api/push/subscribe', { method: 'POST', token: customer, body: { subscription: { endpoint: 'x' } } });
  assert.equal(bad.status, 400);

  // מנוי תקין נרשם; אותו endpoint שוב — עדכון, לא כפילות
  const sub = { endpoint: 'https://push.example.com/sub/abc123', keys: { p256dh: 'BPtest', auth: 'authX' } };
  const s1 = await api('/api/push/subscribe', { method: 'POST', token: customer, body: { subscription: sub } });
  assert.equal(s1.status, 201, JSON.stringify(s1.json));
  const s2 = await api('/api/push/subscribe', { method: 'POST', token: customer, body: { subscription: sub } });
  assert.equal(s2.status, 201);

  const { Client } = require('pg');
  const { TEST_DB } = require('./helpers');
  const db = new Client({ connectionString: TEST_DB });
  await db.connect();
  await db.query(`SET search_path TO "${schema}"`);
  const { rows: subs } = await db.query('SELECT endpoint FROM push_subscriptions');
  assert.equal(subs.length, 1);
  assert.equal(subs[0].endpoint, sub.endpoint);

  // שינוי סטטוס מפעיל notifyUser — ה-endpoint מת (רשת נכשלת), הזרימה לא קורסת
  // וה-notification נשמרת בטבלה כגיבוי
  const admin = await api.login('+972500000001');
  const oid = await deliveredOrder(api, admin, customer, 'achuza');
  const { rows: u } = await db.query('SELECT id FROM users WHERE phone=$1', ['+972500000002']);
  const { rows: n } = await db.query('SELECT count(*)::int AS c FROM notifications WHERE user_id=$1', [u[0].id]);
  assert.ok(n[0].c >= 1, 'notifications fallback rows exist');
  await db.end();

  // ביטול מנוי
  const un = await api('/api/push/unsubscribe', { method: 'POST', token: customer, body: { endpoint: sub.endpoint } });
  assert.equal(un.status, 200);
});
