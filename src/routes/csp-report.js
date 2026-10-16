// B7 שלב א: קליטת דיווחי CSP (Report-Only) — מוגבל קצב ובגודל, בלי PII מעבר ל-UA
const express = require('express');
const { q } = require('../db');
const { limiter } = require('../ratelimit');

const r = express.Router();

// דפדפנים שולחים application/csp-report (ולא application/json) — מפענחים במפורש
const parseCsp = express.json({ type: ['application/json', 'application/csp-report'], limit: '16kb' });

r.post('/csp-report', parseCsp, limiter('csp-report', 60, 10 * 60 * 1000, req => req.ip), async (req, res) => {
  const rep = (req.body && (req.body['csp-report'] || req.body)) || {};
  const clip = (v, n) => String(v || '').slice(0, n) || null;
  try {
    await q(
      `INSERT INTO csp_reports(document_uri, violated_directive, blocked_uri, source_file, line_number, user_agent)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [clip(rep['document-uri'], 300), clip(rep['violated-directive'], 120), clip(rep['blocked-uri'], 300),
       clip(rep['source-file'], 300), Number(rep['line-number']) || null, clip(req.headers['user-agent'], 200)]);
  } catch (e) { console.error('[csp-report]', e.message); }
  res.status(204).end();
});

module.exports = r;
