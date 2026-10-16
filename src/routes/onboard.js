const express = require('express');
const multer = require('multer');
const { q } = require('../db');
const { requireAuth } = require('../auth');
const { extractFromImages } = require('../gemini');

const r = express.Router();
r.use(requireAuth);
const { fileFilter, verifyFile, IMAGES } = require('../uploads');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 5 }, fileFilter: fileFilter(IMAGES) });

// שלב 1: העלאת תמונות מחירון/שעות/תקנון → Gemini מחלץ טיוטת פרופיל
r.post('/extract', upload.array('files', 5), async (req, res) => {
  try {
    const key = process.env.GEMINI_API_KEY;
    if (!key) return res.status(503).json({ error: 'שירות החילוץ אינו זמין כרגע' });
    if (!req.files || !req.files.length) return res.status(400).json({ error: 'יש לצרף לפחות תמונה אחת' });
    if (req.files.some(f => !verifyFile(f, IMAGES))) return res.status(400).json({ error: 'תוכן הקובץ אינו תמונה תקינה (JPG/PNG/WEBP בלבד)' });
    const images = req.files.map(f => ({ mimeType: f.mimetype, base64: f.buffer.toString('base64') }));
    const draft = await extractFromImages(key, images);
    res.json({ draft });
  } catch (e) { console.error(e); res.status(502).json({ error: 'חילוץ נכשל — נסו שוב או הזינו את הפרטים ידנית' }); }
});

// שלב 2: יצירת מכבסה מהטיוטה המאושרת (אחרי מסך סקירה)
r.post('/tenants', async (req, res) => {
  try {
    const { name, phone, address, city, services, hours, terms, items, windows, delivery_fee, min_order } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'שם מכבסה חובה' });
    if (!phone || !String(phone).trim()) return res.status(400).json({ error: 'טלפון המכבסה חובה' });
    if (!address || !String(address).trim()) return res.status(400).json({ error: 'כתובת המכבסה חובה' });
    if (!city || !String(city).trim()) return res.status(400).json({ error: 'עיר חובה' });
    if (Array.isArray(items)) {
      const zero = items.filter(it => it && it.name && !(Number(it.price) > 0));
      if (zero.length) return res.status(400).json({ error: `${zero.length} פריטים ללא מחיר תקין — יש לתקן או למחוק אותם לפני השליחה` });
    }
    let slug = String(name).trim().replace(/[^\wא-ת]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'laundry';
    const { rows: existing } = await q('SELECT 1 FROM tenants WHERE slug=$1', [slug]);
    if (existing[0]) slug = slug + '-' + Math.random().toString(36).slice(2, 6);
    const svc = Array.isArray(services) && services.length ? services : ['כביסה'];
    const { rows: t } = await q(
      `INSERT INTO tenants(slug, name, letter, phone, address, city, services, hours, terms, delivery_fee, min_order, approved)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,false) RETURNING *`,
      [slug, name, name.trim()[0] || 'מ', phone || null, address || null, city || null,
       svc, JSON.stringify(hours || {}), terms || null, Number(delivery_fee) || 0, Number(min_order) || 0]);
    // B3: גיבוב מפתח הבוט מיד עם היצירה — הגלוי לא נשמר. חיבור הבוט מתבצע ברוטציה מהאדמין.
    if (t[0].api_key) {
      const h = require('crypto').createHash('sha256').update(t[0].api_key).digest('hex');
      await q('UPDATE tenants SET api_key=NULL, api_key_hash=$2 WHERE id=$1', [t[0].id, h]);
      t[0].api_key = null; t[0].api_key_hash = h;
    }
    const tenant = t[0];
    await q('INSERT INTO tenant_members(tenant_id, user_id, role) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
      [tenant.id, req.user.id, 'owner']);
    if (Array.isArray(items)) {
      let i = 0;
      for (const it of items.slice(0, 200)) {
        if (!it.name || !(Number(it.price) >= 0)) continue;
        await q('INSERT INTO price_items(tenant_id, name, category, price, unit, sort) VALUES ($1,$2,$3,$4,$5,$6)',
          [tenant.id, String(it.name).slice(0, 120), it.category || 'כביסה', Number(it.price), it.unit === 'kg' ? 'kg' : 'item', i++]);
      }
    }
    if (Array.isArray(windows)) {
      for (const w of windows.slice(0, 50)) {
        if (w.weekday === undefined || !w.start_time || !w.end_time) continue;
        await q('INSERT INTO pickup_windows(tenant_id, weekday, start_time, end_time, capacity, kind) VALUES ($1,$2,$3,$4,$5,$6)',
          [tenant.id, Number(w.weekday) || 0, w.start_time, w.end_time, Number(w.capacity) || 10, w.kind === 'delivery' ? 'delivery' : 'pickup']);
      }
    }
    res.status(201).json({ tenant: { ...tenant, api_key: undefined } });
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

module.exports = r;
