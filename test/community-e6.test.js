const { test } = require('node:test');
const assert = require('node:assert');
const { startApp } = require('./helpers');

// יצירת מכבסה שנייה/שלישית עם בעלים דרך אונבורדינג + אישור אדמין
async function makeLaundry(api, admin, phone, name) {
  const owner = await api.login(phone, 'בעלים ' + name);
  const r = await api('/api/onboard/tenants', {
    method: 'POST', token: owner,
    body: { name, phone: '03-5551234', address: 'רחוב הדוגמה 1', city: 'תל אביב', items: [{ name: 'שק כביסה', price: 50, unit: 'item' }],
      hours: { '0': [['08:00','20:00']], '1': [['08:00','20:00']] },
      windows: [{ weekday: 1, start_time: '16:00', end_time: '19:00', kind: 'delivery' }] },
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  // T112: אישור מכבסה דורש שעות פעילות — מגדירים דרך ה-API הרשמי
  const hs = await api(`/api/t/${r.json.tenant.slug}/settings`, { method: 'PATCH', token: owner, body: { hours: { '0': [['08:00', '18:00']] } } });
  assert.equal(hs.status, 200, JSON.stringify(hs.json));
  const ap = await api(`/api/admin/tenants/${r.json.tenant.id}/approve`, { method: 'POST', token: admin });
  assert.equal(ap.status, 200, JSON.stringify(ap.json));
  return { owner, tenant: r.json.tenant };
}

test('E6.T1: פורום מנהלים — פרסום, תגובות, שימושי, זהות מאומתת, סגור לקהילה', async (t) => {
  const { api } = await startApp(t);
  const admin = await api.login('+972500000001');
  const customer = await api.login('+972500000002');
  const ownerA = await api.login('+972500000003'); // אחוזה
  const { owner: ownerB } = await makeLaundry(api, admin, '+972500000031', 'מכבסת בדיקה ב');

  // לקוח רגיל מחוץ לקהילה
  const forbidden = await api('/api/community/forum/posts', { token: customer });
  assert.equal(forbidden.status, 403);

  // פרסום עם זהות מכבסה מאומתת
  const post = await api('/api/community/forum/posts', { method: 'POST', token: ownerA, body: { category: 'suppliers', title: 'ספק אבקת כביסה מומלץ?', body: 'מחפש ספק אמין במרכז' } });
  assert.equal(post.status, 201, JSON.stringify(post.json));

  const badCat = await api('/api/community/forum/posts', { method: 'POST', token: ownerA, body: { category: 'xxx', title: 't', body: 'b' } });
  assert.equal(badCat.status, 400);

  const list = await api('/api/community/forum/posts?category=suppliers', { token: ownerB });
  assert.equal(list.status, 200);
  const p = list.json.posts.find(x => x.id === post.json.post.id);
  assert.ok(p);
  assert.equal(p.tenant_name, 'מכבסת האחוזה'); // זהות מכבסה ליד שם הכותב

  // תגובה ממכבסה אחרת
  const cm = await api(`/api/community/forum/posts/${post.json.post.id}/comments`, { method: 'POST', token: ownerB, body: { body: 'נסה את ספק-טק, אצלנו עובד מעולה' } });
  assert.equal(cm.status, 201);

  // שימושי: toggle
  const v1 = await api(`/api/community/forum/posts/${post.json.post.id}/useful`, { method: 'POST', token: ownerB, body: {} });
  assert.equal(v1.json.useful, 1);
  assert.equal(v1.json.voted, true);
  const v2 = await api(`/api/community/forum/posts/${post.json.post.id}/useful`, { method: 'POST', token: ownerB, body: {} });
  assert.equal(v2.json.useful, 0);

  const full = await api(`/api/community/forum/posts/${post.json.post.id}`, { token: ownerA });
  assert.equal(full.json.comments.length, 1);
  assert.equal(full.json.comments[0].tenant_name, 'מכבסת בדיקה ב');
});

test('E6.T2: מכרזים — פרסום, הצעות, השוואה, בחירת זוכה, נעילה אחרי מועד', async (t) => {
  const { api } = await startApp(t);
  const admin = await api.login('+972500000001');
  const ownerA = await api.login('+972500000003');
  const { owner: b1 } = await makeLaundry(api, admin, '+972500000032', 'מציע א');
  const { owner: b2 } = await makeLaundry(api, admin, '+972500000033', 'מציע ב');
  const { owner: b3 } = await makeLaundry(api, admin, '+972500000034', 'מציע ג');

  const deadline = new Date(Date.now() + 3600e3).toISOString();
  const tender = await api('/api/community/tenders', {
    method: 'POST', token: ownerA,
    body: { title: 'כביסת מצעים לבית מלון', volume_kg: 800, frequency: 'שבועי', sla_text: 'איסוף עד 10:00', budget: 6000, deadline },
  });
  assert.equal(tender.status, 201, JSON.stringify(tender.json));
  const tid = tender.json.tender.id;

  // המפרסם לא יכול להציע לעצמו
  const selfBid = await api(`/api/community/tenders/${tid}/bids`, { method: 'POST', token: ownerA, body: { price_per_kg: 7 } });
  assert.equal(selfBid.status, 400);

  // 3 הצעות
  for (const [tok, price] of [[b1, 7.5], [b2, 6.9], [b3, 8.2]]) {
    const bid = await api(`/api/community/tenders/${tid}/bids`, { method: 'POST', token: tok, body: { price_per_kg: price, notes: 'זמין מיידית' } });
    assert.equal(bid.status, 201, JSON.stringify(bid.json));
  }
  // הצעה כפולה מאותה מכבסה נחסמת
  const dup = await api(`/api/community/tenders/${tid}/bids`, { method: 'POST', token: b1, body: { price_per_kg: 7 } });
  assert.equal(dup.status, 409);

  // המפרסם רואה את כל ההצעות ממוינות להשוואה; מתחרה רואה רק את שלו
  const posterView = await api(`/api/community/tenders/${tid}`, { token: ownerA });
  assert.equal(posterView.json.bids.length, 3);
  assert.equal(Number(posterView.json.bids[0].price_per_kg), 6.9); // ממוין מהזול
  const bidderView = await api(`/api/community/tenders/${tid}`, { token: b2 });
  assert.equal(bidderView.json.bids.length, 1);
  assert.equal(bidderView.json.bids_count, 3);

  // בחירת זוכה: לא-מפרסם נדחה; מפרסם בוחר
  const cheapest = posterView.json.bids[0];
  const notPoster = await api(`/api/community/tenders/${tid}/award`, { method: 'POST', token: b1, body: { bid_id: cheapest.id } });
  assert.equal(notPoster.status, 403);
  const award = await api(`/api/community/tenders/${tid}/award`, { method: 'POST', token: ownerA, body: { bid_id: cheapest.id } });
  assert.equal(award.status, 200, JSON.stringify(award.json));
  const after = await api(`/api/community/tenders/${tid}`, { token: ownerA });
  assert.equal(after.json.tender.status, 'awarded');
  assert.ok(after.json.bids.find(b => b.is_winner));

  // נעילה אחרי מועד הגשה
  const short = await api('/api/community/tenders', { method: 'POST', token: ownerA, body: { title: 'מכרז קצר', deadline: new Date(Date.now() + 1200).toISOString() } });
  await new Promise(r => setTimeout(r, 1500));
  const lateBid = await api(`/api/community/tenders/${short.json.tender.id}/bids`, { method: 'POST', token: b1, body: { price_per_kg: 5 } });
  assert.equal(lateBid.status, 409);
  const lst = await api('/api/community/tenders', { token: ownerA });
  assert.equal(lst.json.tenders.find(x => x.id === short.json.tender.id).status, 'closed');
});

test('E6.T3: רכש משותף — פתיחה, הצטרפות, חישוב חיסכון', async (t) => {
  const { api } = await startApp(t);
  const admin = await api.login('+972500000001');
  const ownerA = await api.login('+972500000003');
  const { owner: b1 } = await makeLaundry(api, admin, '+972500000035', 'רוכש א');
  const { owner: b2 } = await makeLaundry(api, admin, '+972500000036', 'רוכש ב');

  const bad = await api('/api/community/groups', { method: 'POST', token: ownerA, body: { product: 'אבקה', unit_price: 7, group_price: 10, deadline: new Date(Date.now() + 86400e3).toISOString() } });
  assert.equal(bad.status, 400); // מחיר קבוצה גבוה מהרגיל

  const g = await api('/api/community/groups', {
    method: 'POST', token: ownerA,
    body: { product: 'אבקת כביסה מקצועית 10 ק"ג', supplier: 'ספק-טק', unit_price: 90, group_price: 68, target_participants: 3, deadline: new Date(Date.now() + 86400e3).toISOString() },
  });
  assert.equal(g.status, 201, JSON.stringify(g.json));
  const gid = g.json.group.id;

  await api(`/api/community/groups/${gid}/join`, { method: 'POST', token: b1, body: { qty: 10 } });
  const j2 = await api(`/api/community/groups/${gid}/join`, { method: 'POST', token: b2, body: { qty: 15 } });
  assert.equal(j2.json.participants, 2);

  const list = await api('/api/community/groups', { token: b1 });
  const grp = list.json.groups.find(x => x.id === gid);
  assert.equal(grp.participants, 2);
  assert.equal(Number(grp.total_qty), 25);
  assert.equal(Number(grp.est_savings), (90 - 68) * 25); // חיסכון משוער
  assert.equal(grp.joined, true);

  await api(`/api/community/groups/${gid}/leave`, { method: 'POST', token: b2, body: {} });
  const list2 = await api('/api/community/groups', { token: b1 });
  assert.equal(list2.json.groups.find(x => x.id === gid).participants, 1);
});

test('E6.T4: גלוס קיבולת — בקשה, התקשרות, תשלום דמו מתועד', async (t) => {
  const { api } = await startApp(t);
  const admin = await api.login('+972500000001');
  const ownerA = await api.login('+972500000003');
  const { owner: b1 } = await makeLaundry(api, admin, '+972500000037', 'מקצה קיבולת');

  const req1 = await api('/api/community/capacity', {
    method: 'POST', token: ownerA,
    body: { kind: 'request', equipment: 'מכונת כביסה 18 ק"ג', kg_per_day: 100, days: 3, area: 'תל אביב', price: 800 },
  });
  assert.equal(req1.status, 201, JSON.stringify(req1.json));
  const pid = req1.json.post.id;

  // התקשרות עצמית נחסמת
  const self = await api(`/api/community/capacity/${pid}/engage`, { method: 'POST', token: ownerA, body: {} });
  assert.equal(self.status, 400);

  // מכבסה אחרת מציעה קיבולת → התקשרות
  const eng = await api(`/api/community/capacity/${pid}/engage`, { method: 'POST', token: b1, body: { agreed_price: 750 } });
  assert.equal(eng.status, 201, JSON.stringify(eng.json));
  const eid = eng.json.engagement.id;

  // מודעה כבר לא פתוחה להתקשרויות נוספות
  const again = await api(`/api/community/capacity/${pid}/engage`, { method: 'POST', token: b1, body: {} });
  assert.equal(again.status, 409);

  // סיום עם תיעוד תשלום דמו
  const done = await api(`/api/community/capacity/engagements/${eid}/done`, { method: 'POST', token: b1, body: { payment_demo: 750 } });
  assert.equal(done.status, 200, JSON.stringify(done.json));
  assert.equal(done.json.payment_demo, 750);

  const list = await api('/api/community/capacity', { token: ownerA });
  const post = list.json.posts.find(x => x.id === pid);
  assert.equal(post.status, 'closed');
  assert.equal(post.engagements[0].status, 'done');
  assert.equal(Number(post.engagements[0].payment_demo), 750);
});

test('E6.T5: תוכן ענפי — פרסום אדמין, צפיות, סגור לחברי קהילה', async (t) => {
  const { api } = await startApp(t);
  const admin = await api.login('+972500000001');
  const customer = await api.login('+972500000002');
  const ownerA = await api.login('+972500000003');

  const art = await api('/api/community/content', { method: 'POST', token: admin, body: { category: 'standard', title: 'תקן ישראל 5245 לכביסה', body: 'תוכן התקן המלא...' } });
  assert.equal(art.status, 201, JSON.stringify(art.json));

  // לא-אדמין לא מפרסם
  const notAdmin = await api('/api/community/content', { method: 'POST', token: ownerA, body: { category: 'news', title: 'x', body: 'y' } });
  assert.equal(notAdmin.status, 403);

  // לקוח רגיל מחוץ לקהילה
  const forbidden = await api('/api/community/content', { token: customer });
  assert.equal(forbidden.status, 403);

  const list = await api('/api/community/content?category=standard', { token: ownerA });
  assert.equal(list.status, 200);
  assert.equal(list.json.articles.length, 1);

  const one = await api(`/api/community/content/${art.json.article.id}`, { token: ownerA });
  assert.equal(one.json.article.views, 1);
  const two = await api(`/api/community/content/${art.json.article.id}`, { token: ownerA });
  assert.equal(two.json.article.views, 2);
});
