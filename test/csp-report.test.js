// B7 שלב א: כותרת Report-Only מחמירה נשלחת, ודיווחי הפרה נקלטים בטבלה
const { test } = require('node:test');
const assert = require('node:assert');
const { startApp, TEST_DB } = require('./helpers');
const { Client } = require('pg');

test('B7: Report-Only בלי unsafe-inline בסקריפטים + אכיפה קיימת לא השתנתה; דיווח נקלט', async (t) => {
  const { base, schema } = await startApp(t);
  const page = await fetch(base + '/');
  const enforce = page.headers.get('content-security-policy');
  const reportOnly = page.headers.get('content-security-policy-report-only');
  assert.ok(enforce.includes("script-src 'self' 'unsafe-inline'"), 'מדיניות האכיפה לא השתנתה');
  assert.ok(reportOnly, 'קיימת כותרת Report-Only');
  assert.ok(!reportOnly.includes("script-src 'self' 'unsafe-inline'"), 'המדיניות המחמירה בלי unsafe-inline');
  assert.ok(reportOnly.includes('report-uri /api/csp-report'));

  const r = await fetch(base + '/api/csp-report', {
    method: 'POST', headers: { 'content-type': 'application/csp-report' },
    body: JSON.stringify({ 'csp-report': { 'document-uri': 'https://x/', 'violated-directive': 'script-src', 'blocked-uri': 'inline', 'source-file': 'https://x/app', 'line-number': 42 } }),
  });
  assert.equal(r.status, 204);

  const db = new Client({ connectionString: TEST_DB, options: `-c search_path=${schema},public` });
  await db.connect();
  t.after(() => db.end());
  const { rows } = await db.query('SELECT violated_directive, blocked_uri, line_number FROM csp_reports');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].violated_directive, 'script-src');
  assert.equal(rows[0].line_number, 42);
});
