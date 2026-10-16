const { test } = require('node:test');
const assert = require('node:assert');
const { startApp } = require('./helpers');

// E10.T1+T2: בוט מרכזי — רשימת מכבסות, handoff עם מפתח שיחה זמני, הזמנה אצל המכבסה, סטטוס אחיד, תשלום דמו
test('bot-central: 3 מכבסות -> handoff -> הזמנה -> סטטוס אחיד -> תשלום דמו -> קבלה', async (t) => {
  const { api, base } = await startApp(t);
  const admin = await api.login('+972500000001');

  const k = await api('/api/admin/bot-central-key', { token: admin });
  assert.equal(k.status, 200);
  assert.ok(k.json.key);
  const CK = { apiKey: k.json.key };

  // הרשאות: בלי מפתח / מפתח שגוי נדחים
  assert.equal((await api('/api/bot-central/laundries')).status, 401);
  assert.equal((await api('/api/bot-central/laundries', { apiKey: 'wrong' })).status, 401);
  assert.equal((await api('/api/admin/bot-central-key')).status, 401);

  // הבוט המרכזי מקבל 3 מכבסות
  const l = await api('/api/bot-central/laundries', CK);
  assert.equal(l.status, 200, JSON.stringify(l.json));
  assert.ok(l.json.laundries.length >= 3, 'לפחות 3 מכבסות זמינות לבוט');
  const byCity = await api('/api/bot-central/laundries?city=' + encodeURIComponent('חיפה'), CK);
  assert.ok(byCity.json.laundries.every(x => x.city === 'חיפה'));

  // handoff למכבסה נבחרת
  const h = await api('/api/bot-central/handoff', { method: 'POST', ...CK, body: { phone: '0500000888', slug: 'achuza', name: 'לקוח בוט' } });
  assert.equal(h.status, 201, JSON.stringify(h.json));
  assert.ok(h.json.session_key);
  assert.equal(h.json.tenant.slug, 'achuza');

  // מפתח השיחה עובד מול /api/bot: מחירון + יצירת הזמנה
  const S = { apiKey: h.json.session_key };
  const pl = await api('/api/bot/pricelist', S);
  assert.equal(pl.status, 200);
  const item = pl.json.items[0];

  const o = await api('/api/bot/orders', { method: 'POST', ...S, body: { items: [{ item_id: item.id, qty: 1 }], address: 'רחוב הבוט 5' } });
  assert.equal(o.status, 201, JSON.stringify(o.json));
  assert.ok(o.json.pay_url.includes('/#/pay/'), 'קישור תשלום מוחזר להזמנת בוט');

  // מפתח שיחה מוגבל לטלפון שלו
  const wrong = await api('/api/bot/orders', { method: 'POST', ...S, body: { phone: '+972500000999', items: [{ item_id: item.id, qty: 1 }], address: 'x' } });
  assert.equal(wrong.status, 403);

  // סטטוס אחיד (עברית)
  const st = await api('/api/bot/orders/' + o.json.order_id, S);
  assert.equal(st.json.order.status_he, 'התקבלה');

  // E10.T2: דף תשלום דמו — סיכום, אישור, קבלה; ללא סליקה אמיתית
  const sum = await api('/api/pay/' + o.json.order_id);
  assert.equal(sum.status, 200);
  assert.equal(sum.json.payable, true);
  assert.equal(Number(sum.json.order.total), o.json.total);

  const pay = await api('/api/pay/' + o.json.order_id + '/confirm', { method: 'POST', body: { card_last4: '4242 4242 4242 4242' } });
  assert.equal(pay.status, 200, JSON.stringify(pay.json));

  const again = await api('/api/pay/' + o.json.order_id + '/confirm', { method: 'POST', body: {} });
  assert.equal(again.status, 409, 'תשלום כפול נחסם');

  const sum2 = await api('/api/pay/' + o.json.order_id);
  assert.equal(sum2.json.order.payment_status, 'paid_demo');
  assert.equal(sum2.json.payable, false);

  const pdf = await fetch(base + '/api/pay/' + o.json.order_id + '/receipt.pdf');
  assert.equal(pdf.status, 200);
  assert.match(pdf.headers.get('content-type'), /application\/pdf/);
});
