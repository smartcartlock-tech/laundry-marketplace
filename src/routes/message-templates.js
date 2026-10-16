// N2: תבניות הודעה — ניהול (אדמין בלבד): CRUD, תצוגה מקדימה עם משתנים, וטעינת ברירות דמו.
// התבניות משמשות הודעות פנימיות וסימולציות בלבד — אין שליחה אמיתית.
const express = require('express');
const { q } = require('../db');
const { requireAuth, requireAdmin } = require('../auth');
const { renderTemplate } = require('../usermessages');

const r = express.Router();
r.use(requireAuth, requireAdmin);

const CHANNELS = ['in_app', 'whatsapp_sim', 'email_sim'];

function validBody(b) {
  const key = String(b.key || '').trim();
  const channel = String(b.channel || 'in_app');
  const title = String(b.title || '').trim();
  const body = String(b.body || '').trim();
  if (!/^[a-z0-9_.-]{2,60}$/i.test(key)) return { error: 'מפתח תבנית לא תקין (אותיות/ספרות/._-)' };
  if (!CHANNELS.includes(channel)) return { error: 'ערוץ לא נתמך' };
  if (!title) return { error: 'כותרת חובה' };
  if (!body) return { error: 'גוף ההודעה חובה' };
  const variables = Array.isArray(b.variables) ? b.variables.map(v => String(v).trim()).filter(Boolean) : [];
  return { key, channel, title, body, variables };
}

r.get('/', async (req, res) => {
  try {
    const { rows } = await q('SELECT * FROM message_templates ORDER BY key');
    res.json({ templates: rows });
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

r.post('/', async (req, res) => {
  try {
    const v = validBody(req.body || {});
    if (v.error) return res.status(400).json({ error: v.error });
    const { rows } = await q(
      'INSERT INTO message_templates(key, channel, title, body, variables) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [v.key, v.channel, v.title, v.body, v.variables]);
    res.status(201).json({ template: rows[0] });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'מפתח התבנית כבר קיים' });
    console.error(e); res.status(500).json({ error: 'שגיאת שרת' });
  }
});

r.put('/:id', async (req, res) => {
  try {
    const b = req.body || {};
    const { rows: cur } = await q('SELECT * FROM message_templates WHERE id=$1', [req.params.id]);
    if (!cur[0]) return res.status(404).json({ error: 'תבנית לא נמצאה' });
    const merged = validBody({ ...cur[0], ...b, key: cur[0].key }); // מפתח לא משתנה אחרי יצירה
    if (merged.error) return res.status(400).json({ error: merged.error });
    const active = b.active === undefined ? cur[0].active : !!b.active;
    const { rows } = await q(
      'UPDATE message_templates SET channel=$2, title=$3, body=$4, variables=$5, active=$6, updated_at=now() WHERE id=$1 RETURNING *',
      [req.params.id, merged.channel, merged.title, merged.body, merged.variables, active]);
    res.json({ template: rows[0] });
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

r.delete('/:id', async (req, res) => {
  try {
    const { rowCount } = await q('DELETE FROM message_templates WHERE id=$1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'תבנית לא נמצאה' });
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

// תצוגה מקדימה: רינדור הכותרת והגוף עם משתנים שהוזנו
r.post('/:id/preview', async (req, res) => {
  try {
    const { rows } = await q('SELECT * FROM message_templates WHERE id=$1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'תבנית לא נמצאה' });
    const vars = (req.body && req.body.vars) || {};
    res.json({
      simulated: true,
      title: renderTemplate(rows[0].title, vars),
      body: renderTemplate(rows[0].body, vars),
    });
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

// ברירות דמו — פעולה יזומה בלבד (לא ב-boot), ON CONFLICT כדי שריצה חוזרת לא תיכשל
r.post('/seed-defaults', async (req, res) => {
  try {
    const defaults = [
      ['order_status_in_app', 'in_app', 'עדכון על ההזמנה שלך', 'שלום {{name}}, הזמנה {{order_id}} עברה לסטטוס: {{status}}.', ['name', 'order_id', 'status']],
      ['welcome_sim', 'whatsapp_sim', 'ברוכים הבאים (דמו)', 'שלום {{name}}! שמחים שהצטרפת למכבסה בקליק. זו הודעת דמו — לא נשלח דבר באמת.', ['name']],
      ['receipt_email_sim', 'email_sim', 'קבלה במייל (דמו)', 'היי {{name}}, מצורפת קבלה על הזמנה {{order_id}} בסך ₪{{total}}. מסמך דמו — לא לצורכי מע"מ.', ['name', 'order_id', 'total']],
    ];
    let inserted = 0;
    for (const [key, channel, title, body, variables] of defaults) {
      const { rowCount } = await q(
        'INSERT INTO message_templates(key, channel, title, body, variables) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (key) DO NOTHING',
        [key, channel, title, body, variables]);
      inserted += rowCount;
    }
    res.json({ ok: true, inserted });
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

module.exports = r;
