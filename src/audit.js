// יומן ביקורת: רישום פעולות רגישות (בעיקר מנהל) — מי, מה, על מי, מתי
const { q } = require('./db');

async function audit(req, action, targetType, targetId, meta) {
  try {
    await q('INSERT INTO audit_log(actor_id, actor_label, action, target_type, target_id, meta, ip) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [req.user?.id || null, req.user?.phone || req.user?.email || null, action, targetType || null,
       targetId ? String(targetId) : null, meta ? JSON.stringify(meta) : null, req.ip || null]);
  } catch (e) { console.error('audit log failed:', e.message); } // כשל בכתיבת יומן לא מפיל פעולה
}

module.exports = { audit };
