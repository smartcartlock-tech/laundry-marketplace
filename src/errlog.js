// ניטור תקלות פשוט: טבלת error_log + middleware לכידת שגיאות + endpoint אדמין לצפייה.
// נרשמות שגיאות 500 בלבד (לא 4xx צפויות). נשמרות עד 500 שורות אחרונות.
const { q } = require('./db');
const { maybeAlertAdmin } = require('./error-alerts');

async function migrateErrorLog() {
  await q(`CREATE TABLE IF NOT EXISTS error_log (
    id BIGSERIAL PRIMARY KEY,
    ts TIMESTAMPTZ NOT NULL DEFAULT now(),
    method TEXT, path TEXT, status INT,
    message TEXT, stack TEXT,
    user_id TEXT, ip TEXT
  )`);
}

let pruneCounter = 0;
async function logError(err, req) {
  try {
    await q(
      `INSERT INTO error_log(method, path, status, message, stack, user_id, ip) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [req && req.method, req && req.originalUrl, 500,
       String((err && err.message) || err).slice(0, 500),
       String((err && err.stack) || '').slice(0, 4000),
       (req && req.user && req.user.id) || null,
       (req && (req.headers['cf-connecting-ip'] || req.ip)) || null]);
    // גיזום חד מדי כל 100 שגיאות: שומרים את 500 האחרונות
    if (++pruneCounter % 100 === 0) {
      await q(`DELETE FROM error_log WHERE id < (SELECT COALESCE(MIN(id),0) FROM (SELECT id FROM error_log ORDER BY id DESC LIMIT 500) t)`);
    }
    // E3: התראה לאדמין על 500 חדש (מדוכאת ל-1 ל-10 דקות) — fire-and-forget
    maybeAlertAdmin({ method: req && req.method, path: req && req.originalUrl, message: (err && err.message) || err }).catch(() => {});
  } catch (e) { console.error('[errlog] write failed:', e.message); }
}

// middleware שגיאות — מחליף את ברירת המחדל: לוג לקונסול + לטבלה, תשובה כללית ללקוח
function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  if (res.headersSent) return;
  // שגיאת לקוח (JSON לא תקין, גוף גדול מדי וכו׳) — לא תקלת שרת, לא נרשם ביומן
  const status = Number(err.status || err.statusCode);
  if (status >= 400 && status < 500) return res.status(status).json({ error: err.message || 'bad request' });
  console.error('[error]', req.method, req.originalUrl, err.message);
  logError(err, req).catch(() => {});
  res.status(500).json({ error: 'server error' });
}

module.exports = { migrateErrorLog, logError, errorHandler };
