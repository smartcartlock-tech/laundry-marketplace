// B4 (מוצר): הסכם שירות דיגיטלי — טקסט בלבד, בלי חתימה משפטית.
// GET: הגרסה והטקסט העדכניים + מתי אושר. POST accept: שומר תאריך + גרסה (אידמפוטנטי לאותה גרסה).
const express = require('express');
const { q } = require('../db');
const { requireAuth, requireTenantMember } = require('../auth');

const r = express.Router({ mergeParams: true });
r.use(requireAuth, requireTenantMember);

const AGREEMENT_VERSION = '1.0';
const AGREEMENT_TEXT = `הסכם שירות — "מכבסה בקליק" (גרסה ${AGREEMENT_VERSION})

1. הפלטפורמה מקשרת בין המכבסה ללקוחות ולשליחים, ומספקת כלי ניהול הזמנות, מחירון ותשלומים.
2. המכבסה אחראית לאיכות השירות, לעמידה בזמנים שהתחייבה עליהם ולטיפול בתקלות מול הלקוח.
3. המחירון, חלונות האיסוף ושעות הפעילות שיוזנו יוצגו ללקוחות כפי שהוזנו; עדכונם באחריות המכבסה.
4. התשלומים מוצגים במערכת לצורך מעקב בלבד; סליקה בפועל תתאפשר בהסכמה נפרדת.
5. הפלטפורמה רשאית לעדכן את תנאי ההסכם; על עדכון גרסה תימסר הודעה במערכת והמכבסה תתבקש לאשר מחדש.
6. אישור ההסכם מהווה הסכמה לתנאים אלו בלבד ואינו חתימה משפטית מחייבת.`;

r.get('/agreement', async (req, res) => {
  res.json({ version: AGREEMENT_VERSION, text: AGREEMENT_TEXT,
    accepted_at: req.tenant.accepted_terms_at, accepted_version: req.tenant.accepted_terms_version });
});

r.post('/agreement/accept', async (req, res) => {
  const { version } = req.body || {};
  if (version !== AGREEMENT_VERSION) return res.status(409).json({ error: 'גרסת ההסכם השתנתה — יש לרענן ולקרוא את הגרסה החדשה', version: AGREEMENT_VERSION });
  if (req.tenant.accepted_terms_version === AGREEMENT_VERSION && req.tenant.accepted_terms_at) {
    return res.json({ ok: true, accepted_at: req.tenant.accepted_terms_at, already: true });
  }
  const { rows } = await q(
    'UPDATE tenants SET accepted_terms_at=now(), accepted_terms_version=$2 WHERE id=$1 RETURNING accepted_terms_at',
    [req.tenant.id, AGREEMENT_VERSION]);
  res.json({ ok: true, accepted_at: rows[0].accepted_terms_at });
});

module.exports = r;
