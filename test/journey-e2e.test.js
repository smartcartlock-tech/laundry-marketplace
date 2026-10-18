// G5: מסע קצה-לקצה מלא — לקוח → מכבסה → שליח → מסמך → מעקב ציבורי.
const { test } = require('node:test');
const assert = require('node:assert');
const { startApp } = require('./helpers');

// בדיקת היחידה של שומר ה-allowlist טוענת src/notify בתהליך — db.js דורש DATABASE_URL כבר בטעינה
process.env.DATABASE_URL = process.env.DATABASE_URL || process.env.TEST_DATABASE_URL || 'postgres://postgres@127.0.0.1:5433/laundry_test';

test('מסע מלא: הזמנה, אישור, שליח, מסירה, מסמך חשבונאי ומעקב', async (t) => {
  const { api } = await startApp(t);
  const customer = await api.login('+972500000002');
  const owner = await api.login('+972500000003');
  const courierUser = await api.login('+972500000004');
  const page = await api('/api/laundries/achuza');
  const bag = page.json.items.find(i => i.name.includes('שק'));
  const couriers = await api('/api/t/achuza/couriers', { token: owner });
  const priv = couriers.json.couriers.find(c => c.model === 'private');
  const st = (id, status) => api('/api/t/achuza/orders/' + id + '/status', { method: 'POST', token: owner, body: { status } });
  const mark = (id, action) => api('/api/courier/orders/' + id + '/mark', { method: 'POST', token: courierUser, body: action === 'delivered' ? { action, cash: { outcome: 'collected' } } : { action } });

  // מכבסה: סוג עוסק נדרש להנפקת מסמכים (עוסק פטור — מונפקת קבלה בלי ח.פ)
  await api('/api/t/achuza/settings', { method: 'PATCH', token: owner, body: { dealer_type: 'patur' } });

  // לקוח: יצירת הזמנה
  const mk = await api('/api/orders', { method: 'POST', token: customer,
    body: { slug: 'achuza', items: [{ item_id: bag.id, qty: 5 }], address: 'מסע מלא 1' } });
  assert.equal(mk.status, 201, JSON.stringify(mk.json));
  const oid = mk.json.order.id;
  const code = mk.json.order.tracking_code;
  assert.ok(/^[0-9A-F]{8}$/.test(code || ''), 'קוד מעקב נוצר עם ההזמנה');

  // מכבסה: אישור + שיבוץ שליח
  assert.equal((await st(oid, 'confirmed')).status, 200);
  const asg = await api('/api/t/achuza/orders/' + oid + '/assign', { method: 'POST', token: owner, body: { courier_id: priv.id } });
  assert.equal(asg.status, 200, JSON.stringify(asg.json));

  // שליח: איסוף; מכבסה: עבודה ומוכן; שליח: יציאה ומסירה
  assert.equal((await mark(oid, 'picked_up')).status, 200);
  assert.equal((await st(oid, 'in_work')).status, 200);
  assert.equal((await st(oid, 'ready')).status, 200);
  assert.equal((await mark(oid, 'out_for_delivery')).status, 200);
  assert.equal((await mark(oid, 'delivered')).status, 200);

  // מסמך: הונפק אוטומטית במסירה (invoice_mode=per_order) וזמין ללקוח
  const docs = await api('/api/documents/mine', { token: customer });
  assert.equal(docs.status, 200, JSON.stringify(docs.json).slice(0, 200));
  const list = (docs.json.documents || []).filter(d => d.order_id === oid || (d.covered_order_ids || []).includes(oid));
  assert.ok(list.length >= 1, 'מסמך הונפק אחרי מסירה ומכסה את ההזמנה');

  // מעקב ציבורי: delivered מלא, בלי התחברות
  const pub = await api('/api/track/' + code);
  assert.equal(pub.status, 200);
  assert.equal(pub.json.status, 'delivered');
  const got = pub.json.events.map(e => e.status);
  for (const s of ['new', 'confirmed', 'picked_up', 'in_work', 'ready', 'out_for_delivery', 'delivered'])
    assert.ok(got.includes(s), 'ציר המעקב חסר: ' + s);

  // נקודות נצברו ללקוח
  const club = await api('/api/orders/club/summary', { token: customer });
  assert.ok(club.status === 200);
});

test('G5: שומר allowlist בדמו — שליחה אמיתית רק למספר מורשה', async () => {
  const fresh = (allow) => {
    process.env.DEMO_NOTIFY_ALLOWLIST = allow;
    for (const m of ['../src/config', '../src/notify']) delete require.cache[require.resolve(m)];
    return require('../src/notify');
  };
  // ברירת מחדל (APP_MODE לא מוגדר = demo): מספר דמו נחסם ומסומן כסימולציה
  let n = fresh('+972503500750');
  let r = await n.sendWhatsApp('+972500000002', 'בדיקה');
  assert.equal(r.sent, false);
  assert.equal(r.reason, 'demo-not-allowlisted');
  assert.equal(r.simulated, true);
  // מספר מורשה עובר את השומר (אין Twilio בבדיקה — מצופה reason של תשתית, לא של השומר)
  r = await n.sendWhatsApp('+972503500750', 'בדיקה');
  assert.notEqual(r.reason, 'demo-not-allowlisted');
  // רשימה ריקה = הכל מדומה
  n = fresh('');
  r = await n.sendWhatsApp('+972503500750', 'בדיקה');
  assert.equal(r.reason, 'demo-not-allowlisted');
  delete process.env.DEMO_NOTIFY_ALLOWLIST;
  for (const m of ['../src/config', '../src/notify']) delete require.cache[require.resolve(m)];
});
