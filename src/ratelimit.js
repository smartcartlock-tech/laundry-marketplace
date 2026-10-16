// מגבלת קצב קטנה בזיכרון התהליך — בלי תלות חדשה (Render free = תהליך יחיד, וזה מספיק לדמו).
// החלון מחליק ברמה של מפתח (טלפון/אימייל אחרי נרמול), לא ברמת IP — כך NAT משותף לא חוסם תלמידים
// שונים באותה רשת, ותוקף שמכוון ליעד אחד נעצר.
const buckets = new Map(); // key -> number[] (chtimot zman b-ms)
setInterval(() => {
  const now = Date.now();
  for (const [k, arr] of buckets) {
    const kept = arr.filter((t) => now - t < 15 * 60 * 1000);
    if (kept.length) buckets.set(k, kept); else buckets.delete(k);
  }
}, 5 * 60 * 1000).unref();

/** limiter(scope, max, windowMs) — middleware: 429 כשחורגים מ-max קריאות בחלון. */
function limiter(scope, max, windowMs, keyFn) {
  return (req, res, next) => {
    const id = String((keyFn ? keyFn(req) : (req.body && req.body.target) || req.ip) || '?').slice(0, 64);
    const key = `${scope}:${id}`;
    const now = Date.now();
    const arr = (buckets.get(key) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max) {
      const retryAfter = Math.ceil((windowMs - (now - arr[0])) / 1000);
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({ error: 'יותר מדי ניסיונות — נסו שוב בעוד כמה דקות' });
    }
    arr.push(now);
    buckets.set(key, arr);
    next();
  };
}

// מגבלת כתיבה לראוטרים מאומתים: להציב אחרי r.use(requireAuth). GET/HEAD חופשיים, שאר השיטות מוגבלות פר-משתמש.
function writeLimiter(scope, max = 60, windowMs = 10 * 60 * 1000) {
  const lim = limiter(scope, max, windowMs, (req) => (req.user && req.user.id) || req.ip);
  return (req, res, next) => (req.method === 'GET' || req.method === 'HEAD' ? next() : lim(req, res, next));
}

module.exports = { limiter, writeLimiter };
