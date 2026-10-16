// E3: דף עסקי ממותג — שדות מיתוג, לוגו, manifest, QR, כרטיס, שיוך מקור ועמלה.
const { test } = require('node:test');
const assert = require('node:assert');
const { startApp } = require('./helpers');

// PNG מינימלי תקין (1x1)
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

test('branding: settings, logo, manifest, qr, card, attribution, commission split', async (t) => {
  const { base, api } = await startApp(t);
  const owner = await api.login('+972500000003', 'בעל מכבסה לדמו');

  // E3.T1: שדות מיתוג בהגדרות
  const set = await api('/api/t/achuza/settings', { method: 'PATCH', token: owner, body: {
    color: '#a31212', slogan: 'הכביסה של השכונה', whatsapp: '+972501112233' } });
  assert.equal(set.status, 200, JSON.stringify(set.json));
  assert.equal(set.json.tenant.color, '#a31212');
  assert.equal(set.json.tenant.slogan, 'הכביסה של השכונה');

  // פרופיל ציבורי חושף מיתוג בלי bytea
  const pub = await api('/api/laundries/achuza');
  assert.equal(pub.json.laundry.slogan, 'הכביסה של השכונה');
  assert.equal(pub.json.laundry.logo, undefined);

  // העלאת לוגו
  const fd = new FormData();
  fd.append('logo', new Blob([PNG], { type: 'image/png' }), 'logo.png');
  const up = await fetch(base + '/api/t/achuza/logo', { method: 'POST', headers: { authorization: 'Bearer ' + owner }, body: fd });
  assert.equal(up.status, 200, await up.text());
  const logoRes = await fetch(base + '/api/laundries/achuza/logo');
  assert.equal(logoRes.status, 200);
  assert.equal(logoRes.headers.get('content-type'), 'image/png');
  const logoBuf = Buffer.from(await logoRes.arrayBuffer());
  assert.ok(logoBuf.equals(PNG), 'logo round-trips');

  // manifest דינמי
  const mf = await api('/api/laundries/achuza/manifest.webmanifest');
  assert.equal(mf.status, 200);
  assert.equal(mf.json.name, 'מכבסת האחוזה');
  assert.equal(mf.json.theme_color, '#a31212');
  assert.equal(mf.json.start_url, '/b/achuza');
  assert.equal(mf.json.icons[0].src, '/api/laundries/achuza/logo');

  // QR + כרטיס
  const qr = await fetch(base + '/api/laundries/achuza/qr.png');
  assert.equal(qr.status, 200);
  assert.equal(qr.headers.get('content-type'), 'image/png');
  assert.ok((await qr.arrayBuffer()).byteLength > 200);
  const card = await fetch(base + '/api/laundries/achuza/card');
  assert.equal(card.status, 200);
  const cardHtml = await card.text();
  assert.ok(cardHtml.includes('מכבסת האחוזה') && cardHtml.includes('/b/achuza') && cardHtml.includes('וולט למכבסות'));

  // E3.T4: הרשמה מדף ממותג → לקוח שלה
  const req = await api('/api/auth/otp/request', { method: 'POST', body: { target: '+972507777777' } });
  const ver = await api('/api/auth/otp/verify', { method: 'POST', body: {
    target: '+972507777777', code: req.json.demoCode, name: 'לקוח מותג', signup_source: 'branded', signup_slug: 'achuza' } });
  assert.equal(ver.status, 200);
  const branded = ver.json.token;

  // הזמנה מהדף הממותג (source=branded)
  const laundry = (await api('/api/laundries/achuza')).json;
  const shirt = laundry.items.find(i => i.name.includes('חולצה'));
  const o1 = await api('/api/orders', { method: 'POST', token: branded, body: {
    slug: 'achuza', address: 'הרצל 1', source: 'branded', items: [{ item_id: shirt.id, qty: 10 }] } });
  assert.equal(o1.status, 201, JSON.stringify(o1.json));
  assert.equal(o1.json.order.source, 'branded');

  // לקוח מרקטפלייס רגיל
  const mkt = await api.login('+972508888888', 'לקוח רגיל');
  const o2 = await api('/api/orders', { method: 'POST', token: mkt, body: {
    slug: 'achuza', address: 'הרצל 2', items: [{ item_id: shirt.id, qty: 10 }] } });
  assert.equal(o2.status, 201);

  // פילוח ערוצים בדוחות: שני הערוצים מסומנים נכון + עמלה משוערת
  const stats = await api('/api/t/achuza/stats', { token: owner });
  const ch = stats.json.channels;
  assert.ok(ch.own.orders >= 1 && ch.marketplace.orders >= 1, JSON.stringify(ch));
  assert.equal(ch.own.commission_pct, 5);
  assert.equal(ch.marketplace.commission_pct, 12);
  assert.ok(ch.own.commission_est > 0 && ch.marketplace.commission_est > 0);
  assert.ok(ch.marketplace.commission_est > ch.own.commission_est, 'marketplace commission higher rate');
});
