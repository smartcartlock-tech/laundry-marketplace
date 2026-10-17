const { test } = require('node:test');
const assert = require('node:assert');
const { startApp } = require('./helpers');

// QA2.T4: סימון איסוף מחוץ לחלון — לא נחסם (עבודת שטח), אבל מתועד כחריגה בצד שרת
function ilNow() { return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' })); }

async function setupOrder(api, { pickupAt }) {
  const customer = await api.login('+972500000002');
  const owner = await api.login('+972500000003');
  const courierTok = await api.login('+972500000004');
  const l = await api('/api/laundries/achuza');
  const itemId = l.json.items[0].id;
  const o = await api('/api/orders', { method: 'POST', token: customer, body: { slug: 'achuza', items: [{ item_id: itemId, qty: 1 }], address: 'רחוב בדיקה 1', pickup_at: pickupAt ? pickupAt.toISOString() : undefined } });
  assert.equal(o.status, 201, JSON.stringify(o.json));
  const oid = o.json.order.id;
  const conf = await api(`/api/t/achuza/orders/${oid}/status`, { method: 'POST', token: owner, body: { status: 'confirmed' } });
  assert.equal(conf.status, 200, JSON.stringify(conf.json));
  const couriers = await api('/api/t/achuza/couriers', { token: owner });
  const cid = couriers.json.couriers.find(c => c.model === 'private').id;
  const asg = await api(`/api/t/achuza/orders/${oid}/assign`, { method: 'POST', token: owner, body: { courier_id: cid } });
  assert.equal(asg.status, 200, JSON.stringify(asg.json));
  return { customer, owner, courierTok, oid };
}

test('pickup-window: סימון מחוץ לחלון מתועד כחריגה, בתוך החלון — ללא חריגה', async (t) => {
  const { api } = await startApp(t);

  // מקרה 1: חלון עתידי רחוק (ראשון הבא 09:00–12:00) — סימון היום חורג
  const il = ilNow();
  const daysToSunday = (7 - il.getDay()) % 7 || 7;
  const sunday = new Date(il); sunday.setDate(il.getDate() + daysToSunday); sunday.setHours(9, 0, 0, 0);
  const a = await setupOrder(api, { pickupAt: sunday });
  const m1 = await api(`/api/courier/orders/${a.oid}/mark`, { method: 'POST', token: a.courierTok, body: { action: 'picked_up' } });
  assert.equal(m1.status, 200, JSON.stringify(m1.json));
  assert.equal(m1.json.window_violation, true, 'סימון ימים לפני החלון חייב להיות מסומן כחריגה');
  const d1 = await api('/api/orders/' + a.oid, { token: a.customer });
  const ev = d1.json.events.find(e => e.status === 'picked_up');
  assert.ok(ev && ev.note && ev.note.includes('חריגה'), 'אירוע חריגה נרשם בהזמנה');

  // מקרה 2: חלון היום שמתחיל לפני 30 דקות — סימון עכשיו תקין
  const il2 = ilNow();
  const start = new Date(il2.getTime() - 30 * 60000); start.setSeconds(0, 0);
  let end = new Date(il2.getTime() + 60 * 60000);
  if (end.getDate() !== il2.getDate()) { end = new Date(il2); end.setHours(23, 59, 59, 0); } // חלון לא חוצה חצות — אחרת end<start באותו weekday
  const hhmm = d => String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  const { owner, courierTok, oid } = await setupOrder(api, { pickupAt: start });
  // pickup_at חייב להתאים לחלון קיים — יוצרים חלון תואם כבעל המכבסה
  const w = await api('/api/t/achuza/windows', { method: 'POST', token: owner, body: { weekday: il2.getDay(), start_time: hhmm(start), end_time: hhmm(end), kind: 'pickup' } });
  assert.equal(w.status, 201, JSON.stringify(w.json));
  const m2 = await api(`/api/courier/orders/${oid}/mark`, { method: 'POST', token: courierTok, body: { action: 'picked_up' } });
  assert.equal(m2.status, 200, JSON.stringify(m2.json));
  assert.ok(!m2.json.window_violation, 'סימון בתוך החלון לא אמור להיות חריגה');
});
