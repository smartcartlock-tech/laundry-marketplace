// E3: התראת אדמין על 500 חדש — נרשם ב-error_log, נשלחת התראה אחת, דיכוי 10 דקות.
const test = require('node:test');
const assert = require('node:assert');
const { Pool } = require('pg');
const { startApp, TEST_DB } = require('./helpers');

test('500 מפעיל התראת אדמין אחת; דיכוי מונע כפילות בתוך החלון', async (t) => {
  process.env.ERROR_ALERT_THROTTLE_MS = '1500'; // מועבר לשרת הילד דרך env
  process.env.ALLOW_SIMULATE_ERRORS = '1';
  const { api, schema } = await startApp(t);
  const token = await api.login('+972500000001');

  const pool = new Pool({ connectionString: TEST_DB, options: `-c search_path=${schema},public` });
  t.after(async () => { await pool.end(); });
  const alertCount = async () => {
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM notifications WHERE body LIKE '%שגיאת שרת%'`);
    return rows[0].n;
  };

  const s1 = await api('/api/admin/errors/simulate', { method: 'POST', token });
  assert.equal(s1.status, 500, 'ה-endpoint מייצר 500 אמיתי');
  await new Promise(r => setTimeout(r, 600)); // רישום+התראה הם fire-and-forget

  const log = await api('/api/admin/errors?limit=5', { token });
  assert.equal(log.status, 200);
  assert.ok(log.json.errors.some(e => (e.path || '').includes('/errors/simulate')), 'נרשם ב-error_log');
  assert.equal(await alertCount(), 1, 'התראה אחת נשלחה');

  // דיכוי: 500 נוסף בתוך החלון לא שולח התראה נוספת (אבל עדיין נרשם)
  await api('/api/admin/errors/simulate', { method: 'POST', token });
  await new Promise(r => setTimeout(r, 600));
  assert.equal(await alertCount(), 1, 'דוכה בתוך חלון ה-10 דקות');
  const log2 = await api('/api/admin/errors?limit=5', { token });
  assert.ok(log2.json.errors.filter(e => (e.path || '').includes('/errors/simulate')).length >= 2, 'שתי השגיאות נרשמו');

  // אחרי החלון — מתראה מחדש
  await new Promise(r => setTimeout(r, 1200));
  await api('/api/admin/errors/simulate', { method: 'POST', token });
  await new Promise(r => setTimeout(r, 600));
  assert.equal(await alertCount(), 2, 'התראה נוספת אחרי שחלון הדיכוי פג');
});
