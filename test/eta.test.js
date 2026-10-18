const { test } = require('node:test');
const assert = require('node:assert');
const { startApp } = require('./helpers');
const { computeReturnEta, nextWindowEnd, etaLabel, wallToUtc } = require('../src/eta');

// יחידה: בחירת חלון ההחזרה הקרוב אחרי זמן העבודה
test('eta: חלון החזרה ראשון שמסתיים אחרי האיסוף + זמן עבודה; שבת מדולגת', () => {
  const wins = [
    { kind: 'pickup', weekday: 0, start_time: '09:00', end_time: '12:00' },
    { kind: 'delivery', weekday: 0, start_time: '16:00', end_time: '19:00' },
    { kind: 'delivery', weekday: 6, start_time: '20:00', end_time: '22:00' }, // שבת — לא נספר
    { kind: 'delivery', weekday: 1, start_time: '16:00', end_time: '19:00' },
  ];
  // ראשון 08:00 + 24ש => שני 08:00 => חלון החזרה שני 19:00
  const now = new Date('2026-10-18T05:00:00.000Z'); // ראשון 08:00 בירושלים
  const at = computeReturnEta({ turnaroundHours: 24, windows: wins, order: {}, now });
  assert.equal(etaLabel(at, now), 'מחר עד 19:00');
  // זמן עבודה קצר — עדיין אותו יום
  const at2 = computeReturnEta({ turnaroundHours: 4, windows: wins, order: {}, now });
  assert.equal(etaLabel(at2, now), 'היום עד 19:00');
  // בלי חלונות החזרה — null
  assert.equal(computeReturnEta({ turnaroundHours: 4, windows: [], order: {}, now }), null);
  // delivery_at מפורש גובר; כשהוא תחילת חלון ידוע (T95) — מוצג סוף החלון
  const chosen = new Date('2026-10-20T16:00:00.000Z');
  assert.equal(computeReturnEta({ turnaroundHours: 4, windows: wins, order: { delivery_at: chosen.toISOString() }, now }).toISOString(), chosen.toISOString());
  const winStart = new Date('2026-10-18T13:00:00.000Z'); // ראשון 16:00 — תחילת חלון ההחזרה 16:00-19:00
  assert.equal(computeReturnEta({ turnaroundHours: 4, windows: wins, order: { delivery_at: winStart.toISOString() }, now }).toISOString(), '2026-10-18T16:00:00.000Z');
  // בוטלה — אין צפי; נמסרה — אין צפי (מוצג מהאירועים)
  assert.equal(computeReturnEta({ turnaroundHours: 4, windows: wins, order: { status: 'cancelled' }, now }), null);
  assert.equal(computeReturnEta({ turnaroundHours: 4, windows: wins, order: { status: 'delivered' }, now }), null);
});

// יחידה: המרת זמן קיר בירושלים נכונה גם סביב מעבר שעון חורף (25.10.2026)
test('eta: wallToUtc מכבד שעון קיץ/חורף', () => {
  const summer = wallToUtc(2026, 10, 18, 19, 0); // IDT = UTC+3
  assert.equal(summer.toISOString(), '2026-10-18T16:00:00.000Z');
  const winter = wallToUtc(2026, 11, 1, 19, 0);  // IST = UTC+2
  assert.equal(winter.toISOString(), '2026-11-01T17:00:00.000Z');
});

// שרת: צפי החזרה מוצג בכל שלב — דף מכבסה, רשימה, יצירה, הזמנות שלי, פרטי הזמנה, מעקב ציבורי
test('eta: צפי החזרה בכל נקודות המגע (T106)', async (t) => {
  const { api } = await startApp(t);
  const customer = await api.login('+972500000002');

  const page = await api('/api/laundries/achuza');
  assert.equal(page.status, 200);
  assert.ok(page.json.laundry.return_estimate_label.includes('עד'), JSON.stringify(page.json.laundry.return_estimate_label));
  assert.equal(page.json.laundry.turnaround_hours, 24);

  const list = await api('/api/laundries');
  const card = list.json.laundries.find(l => l.slug === 'achuza');
  assert.ok(card.return_estimate_label && card.return_estimate_label.includes('עד'));

  const items = page.json.items;
  const bag = items.find(i => i.name.includes('שק'));
  const created = await api('/api/orders', { method: 'POST', token: customer, body: { slug: 'achuza', items: [{ item_id: bag.id, qty: 1 }], address: 'הרצל 12, תל אביב' } });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const order = created.json.order;
  assert.ok(order.return_eta, 'return_eta ביצירה');
  assert.ok(order.return_eta_label.includes('עד'), order.return_eta_label);

  const mine = await api('/api/orders/mine', { token: customer });
  const mo = mine.json.orders.find(o => o.id === order.id);
  assert.ok(mo.return_eta_label && mo.return_eta_label.includes('עד'));

  const one = await api('/api/orders/' + order.id, { token: customer });
  assert.equal(one.json.order.return_eta, mo.return_eta);

  const trk = await api('/api/track/' + order.tracking_code);
  assert.equal(trk.status, 200, JSON.stringify(trk.json));
  assert.equal(trk.json.return_eta, mo.return_eta);
  assert.ok(trk.json.return_eta_label.includes('עד'));
});

// שרת: רישום מכבסה מחייב שעות פעילות וחלון החזרה (T106)
test('eta: רישום בלי שעות/חלון החזרה נדחה; תקין מתקבל עם turnaround', async (t) => {
  const { api } = await startApp(t);
  const owner = await api.login('+972500000050', 'בעלים חדש');
  const base = { name: 'מכבסת הבדיקה', phone: '03-5551234', address: 'הרצל 1', city: 'תל אביב',
    items: [{ name: 'שק', price: 50, unit: 'item' }] };

  let r = await api('/api/onboard/tenants', { method: 'POST', token: owner, body: base });
  assert.equal(r.status, 400);
  assert.ok(r.json.error.includes('שעות'));

  r = await api('/api/onboard/tenants', { method: 'POST', token: owner,
    body: { ...base, hours: { '0': [['08:00','20:00']] } } });
  assert.equal(r.status, 400);
  assert.ok(r.json.error.includes('חלון החזרה'), r.json.error);

  r = await api('/api/onboard/tenants', { method: 'POST', token: owner,
    body: { ...base, hours: { '0': [['08:00','20:00']] }, turnaround_hours: 12,
      windows: [{ weekday: 0, start_time: '16:00', end_time: '19:00', kind: 'delivery' }] } });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(r.json.tenant.turnaround_hours, 12);

  // צ'ק-ליסט מוכנות כולל חלון החזרה
  const cl = await api(`/api/t/${r.json.tenant.slug}/checklist`, { token: owner });
  assert.equal(cl.status, 200, JSON.stringify(cl.json));
  assert.ok(cl.json.items.find(i => i.key === 'dwindow' && i.done));
});
