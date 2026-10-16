// E6: שכבת B2B — פורום מנהלים, מכרזים, רכש משותף, גלוס קיבולת, תוכן ענפי
const express = require('express');
const { q } = require('../db');
const { requireAuth, requireAdmin } = require('../auth');
const { requireCommunityMember } = require('../community-auth');
const { uuidParams } = require('../validate');

const r = express.Router();
r.use(requireAuth, requireCommunityMember);
r.use(require('../ratelimit').writeLimiter('community-write', 60));

const authorInfo = `u.name AS author_name, t.name AS tenant_name, t.slug AS tenant_slug`;

// ---------- E6.T1: פורום מנהלים ----------
r.get('/forum/posts', async (req, res) => {
  const params = [];
  let where = '1=1';
  if (req.query.category) { params.push(req.query.category); where = 'p.category=$1'; }
  const { rows } = await q(
    `SELECT p.id, p.category, p.title, p.created_at, left(p.body, 200) AS excerpt, ${authorInfo},
            (SELECT count(*)::int FROM forum_comments c WHERE c.post_id=p.id) AS comments,
            (SELECT count(*)::int FROM forum_votes v WHERE v.post_id=p.id) AS useful
     FROM forum_posts p JOIN users u ON u.id=p.author_id JOIN tenants t ON t.id=p.tenant_id
     WHERE ${where} ORDER BY p.created_at DESC LIMIT 100`, params);
  res.json({ posts: rows });
});

r.post('/forum/posts', async (req, res) => {
  if (!req.myTenant) return res.status(403).json({ error: 'רק בעלי מכבסות מאומתים יכולים לפרסם' });
  const { category, title, body } = req.body || {};
  if (!['operations','suppliers','group_purchase','pricing'].includes(category)) return res.status(400).json({ error: 'קטגוריה לא תקינה' });
  if (!title || !String(title).trim()) return res.status(400).json({ error: 'כותרת חובה' });
  if (!body || !String(body).trim()) return res.status(400).json({ error: 'תוכן חובה' });
  const { rows } = await q(
    'INSERT INTO forum_posts(tenant_id, author_id, category, title, body) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [req.myTenant.id, req.user.id, category, String(title).trim(), String(body).trim()]);
  res.status(201).json({ post: rows[0] });
});

r.get('/forum/posts/:id', uuidParams('id'), async (req, res) => {
  const { rows: p } = await q(
    `SELECT p.*, ${authorInfo},
            (SELECT count(*)::int FROM forum_votes v WHERE v.post_id=p.id) AS useful,
            EXISTS(SELECT 1 FROM forum_votes v WHERE v.post_id=p.id AND v.user_id=$2) AS voted
     FROM forum_posts p JOIN users u ON u.id=p.author_id JOIN tenants t ON t.id=p.tenant_id WHERE p.id=$1`,
    [req.params.id, req.user.id]);
  if (!p[0]) return res.status(404).json({ error: 'פוסט לא נמצא' });
  const { rows: comments } = await q(
    `SELECT c.id, c.body, c.created_at, ${authorInfo}
     FROM forum_comments c JOIN users u ON u.id=c.author_id JOIN tenants t ON t.id=c.tenant_id
     WHERE c.post_id=$1 ORDER BY c.created_at`, [req.params.id]);
  res.json({ post: p[0], comments });
});

r.post('/forum/posts/:id/comments', uuidParams('id'), async (req, res) => {
  if (!req.myTenant) return res.status(403).json({ error: 'רק בעלי מכבסות מאומתים יכולים להגיב' });
  const body = String((req.body || {}).body || '').trim();
  if (!body) return res.status(400).json({ error: 'תגובה ריקה' });
  const { rows: p } = await q('SELECT id FROM forum_posts WHERE id=$1', [req.params.id]);
  if (!p[0]) return res.status(404).json({ error: 'פוסט לא נמצא' });
  const { rows } = await q(
    'INSERT INTO forum_comments(post_id, tenant_id, author_id, body) VALUES ($1,$2,$3,$4) RETURNING *',
    [req.params.id, req.myTenant.id, req.user.id, body]);
  res.status(201).json({ comment: rows[0] });
});

r.post('/forum/posts/:id/useful', uuidParams('id'), async (req, res) => {
  const { rows: p } = await q('SELECT id FROM forum_posts WHERE id=$1', [req.params.id]);
  if (!p[0]) return res.status(404).json({ error: 'פוסט לא נמצא' });
  const { rows: del } = await q('DELETE FROM forum_votes WHERE post_id=$1 AND user_id=$2 RETURNING post_id', [req.params.id, req.user.id]);
  if (!del[0]) await q('INSERT INTO forum_votes(post_id, user_id) VALUES ($1,$2)', [req.params.id, req.user.id]);
  const { rows: c } = await q('SELECT count(*)::int AS n FROM forum_votes WHERE post_id=$1', [req.params.id]);
  res.json({ ok: true, voted: !del[0], useful: c[0].n });
});

// ---------- E6.T2: מכרזים ----------
r.get('/tenders', async (req, res) => {
  const { rows } = await q(
    `SELECT t.id, t.title, t.volume_kg, t.frequency, t.budget, t.deadline, t.status, t.created_at,
            tn.name AS poster_name,
            (t.status='open' AND t.deadline < now()) AS expired,
            (SELECT count(*)::int FROM tender_bids b WHERE b.tender_id=t.id) AS bids
     FROM tenders t JOIN tenants tn ON tn.id=t.tenant_id
     ORDER BY t.created_at DESC LIMIT 100`, []);
  res.json({ tenders: rows.map(x => ({ ...x, status: x.expired && x.status === 'open' ? 'closed' : x.status })) });
});

r.post('/tenders', async (req, res) => {
  if (!req.myTenant) return res.status(403).json({ error: 'רק בעלי מכבסות מאומתים יכולים לפרסם מכרז' });
  const { title, description, volume_kg, frequency, sla_text, budget, deadline } = req.body || {};
  if (!title || !String(title).trim()) return res.status(400).json({ error: 'כותרת חובה' });
  const dl = new Date(deadline);
  if (isNaN(dl) || dl <= new Date()) return res.status(400).json({ error: 'מועד הגשה חייב להיות עתידי' });
  const { rows } = await q(
    `INSERT INTO tenders(tenant_id, title, description, volume_kg, frequency, sla_text, budget, deadline)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [req.myTenant.id, String(title).trim(), description || null, volume_kg || null, frequency || null, sla_text || null, budget || null, dl.toISOString()]);
  res.status(201).json({ tender: rows[0] });
});

r.get('/tenders/:id', uuidParams('id'), async (req, res) => {
  const { rows: t } = await q(
    `SELECT t.*, tn.name AS poster_name FROM tenders t JOIN tenants tn ON tn.id=t.tenant_id WHERE t.id=$1`, [req.params.id]);
  if (!t[0]) return res.status(404).json({ error: 'מכרז לא נמצא' });
  const tender = t[0];
  const isPoster = req.myTenant && req.myTenant.id === tender.tenant_id;
  const expired = tender.status === 'open' && new Date(tender.deadline) < new Date();
  const { rows: bids } = await q(
    `SELECT b.id, b.price_per_kg, b.notes, b.created_at, tn.name AS bidder_name, b.tenant_id,
            (b.id=$2) AS is_winner
     FROM tender_bids b JOIN tenants tn ON tn.id=b.tenant_id
     WHERE b.tender_id=$1 ORDER BY b.price_per_kg`, [req.params.id, tender.winner_bid_id || '00000000-0000-0000-0000-000000000000']);
  // מפרסם רואה את כל ההצעות; מתחרים רואים רק את שלהם + ספירה
  const visible = isPoster || req.user.role === 'admin' ? bids : bids.filter(b => req.myTenant && b.tenant_id === req.myTenant.id);
  res.json({ tender: { ...tender, status: expired ? 'closed' : tender.status }, bids: visible, bids_count: bids.length, is_poster: !!isPoster });
});

r.post('/tenders/:id/bids', uuidParams('id'), async (req, res) => {
  if (!req.myTenant) return res.status(403).json({ error: 'רק בעלי מכבסות מאומתים יכולים להגיש הצעה' });
  const price = Number((req.body || {}).price_per_kg);
  if (!(price > 0)) return res.status(400).json({ error: 'מחיר לק"ג חובה' });
  const { rows: t } = await q('SELECT * FROM tenders WHERE id=$1', [req.params.id]);
  if (!t[0]) return res.status(404).json({ error: 'מכרז לא נמצא' });
  if (t[0].tenant_id === req.myTenant.id) return res.status(400).json({ error: 'לא ניתן להגיש הצעה למכרז שלך' });
  if (t[0].status !== 'open') return res.status(409).json({ error: 'המכרז סגור' });
  if (new Date(t[0].deadline) < new Date()) return res.status(409).json({ error: 'מועד ההגשה עבר — המכרז נעול' });
  try {
    const { rows } = await q(
      'INSERT INTO tender_bids(tender_id, tenant_id, price_per_kg, notes) VALUES ($1,$2,$3,$4) RETURNING *',
      [req.params.id, req.myTenant.id, price, (req.body || {}).notes || null]);
    res.status(201).json({ bid: rows[0] });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'כבר הגשת הצעה למכרז זה' });
    throw e;
  }
});

r.post('/tenders/:id/award', uuidParams('id'), async (req, res) => {
  const { rows: t } = await q('SELECT * FROM tenders WHERE id=$1', [req.params.id]);
  if (!t[0]) return res.status(404).json({ error: 'מכרז לא נמצא' });
  if (!req.myTenant || req.myTenant.id !== t[0].tenant_id) return res.status(403).json({ error: 'רק המפרסם בוחר זוכה' });
  if (t[0].status !== 'open') return res.status(409).json({ error: 'המכרז כבר נסגר' });
  const { rows: b } = await q('SELECT * FROM tender_bids WHERE id=$1 AND tender_id=$2', [(req.body || {}).bid_id, t[0].id]);
  if (!b[0]) return res.status(404).json({ error: 'הצעה לא נמצאה' });
  await q(`UPDATE tenders SET status='awarded', winner_bid_id=$2 WHERE id=$1`, [t[0].id, b[0].id]);
  res.json({ ok: true, winner: b[0] });
});

// ---------- E6.T3: רכש משותף ----------
r.get('/groups', async (req, res) => {
  const { rows } = await q(
    `SELECT g.*, t.name AS creator_name,
            (SELECT count(*)::int FROM purchase_group_members m WHERE m.group_id=g.id) AS participants,
            (SELECT COALESCE(sum(m.qty),0) FROM purchase_group_members m WHERE m.group_id=g.id) AS total_qty,
            (g.unit_price - g.group_price) * (SELECT COALESCE(sum(m.qty),0) FROM purchase_group_members m WHERE m.group_id=g.id) AS est_savings,
            EXISTS(SELECT 1 FROM purchase_group_members m WHERE m.group_id=g.id AND m.tenant_id=$1) AS joined
     FROM purchase_groups g JOIN tenants t ON t.id=g.creator_tenant_id
     ORDER BY g.created_at DESC LIMIT 100`, [req.myTenant ? req.myTenant.id : '00000000-0000-0000-0000-000000000000']);
  res.json({ groups: rows });
});

r.post('/groups', async (req, res) => {
  if (!req.myTenant) return res.status(403).json({ error: 'רק בעלי מכבסות מאומתים יכולים לפתוח קבוצת רכש' });
  const { product, supplier, unit_price, group_price, target_participants, deadline } = req.body || {};
  if (!product || !String(product).trim()) return res.status(400).json({ error: 'מוצר חובה' });
  const up = Number(unit_price), gp = Number(group_price);
  if (!(up > 0) || !(gp > 0) || gp >= up) return res.status(400).json({ error: 'מחיר קבוצה חייב להיות נמוך מהמחיר הרגיל' });
  const dl = new Date(deadline);
  if (isNaN(dl) || dl <= new Date()) return res.status(400).json({ error: 'מועד סגירה חייב להיות עתידי' });
  const { rows } = await q(
    `INSERT INTO purchase_groups(creator_tenant_id, product, supplier, unit_price, group_price, target_participants, deadline)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [req.myTenant.id, String(product).trim(), supplier || null, up, gp, Number(target_participants) || 3, dl.toISOString()]);
  res.status(201).json({ group: rows[0] });
});

r.post('/groups/:id/join', uuidParams('id'), async (req, res) => {
  if (!req.myTenant) return res.status(403).json({ error: 'רק בעלי מכבסות מאומתים יכולים להצטרף' });
  const qty = Number((req.body || {}).qty) || 1;
  if (qty <= 0 || qty > 10000) return res.status(400).json({ error: 'כמות לא תקינה' });
  const { rows: g } = await q('SELECT * FROM purchase_groups WHERE id=$1', [req.params.id]);
  if (!g[0]) return res.status(404).json({ error: 'קבוצה לא נמצאה' });
  if (g[0].status !== 'open' || new Date(g[0].deadline) < new Date()) return res.status(409).json({ error: 'הקבוצה סגורה' });
  await q(
    `INSERT INTO purchase_group_members(group_id, tenant_id, qty) VALUES ($1,$2,$3)
     ON CONFLICT (group_id, tenant_id) DO UPDATE SET qty=EXCLUDED.qty`, [g[0].id, req.myTenant.id, qty]);
  const { rows: c } = await q('SELECT count(*)::int AS n FROM purchase_group_members WHERE group_id=$1', [g[0].id]);
  res.json({ ok: true, participants: c[0].n, target_reached: c[0].n >= g[0].target_participants });
});

r.post('/groups/:id/leave', uuidParams('id'), async (req, res) => {
  if (!req.myTenant) return res.status(403).json({ error: 'אין מכבסה משויכת' });
  await q('DELETE FROM purchase_group_members WHERE group_id=$1 AND tenant_id=$2', [req.params.id, req.myTenant.id]);
  res.json({ ok: true });
});

// ---------- E6.T4: גלוס קיבולת ----------
r.get('/capacity', async (req, res) => {
  const { rows } = await q(
    `SELECT p.*, t.name AS tenant_name, t.city AS tenant_city,
            (SELECT json_agg(json_build_object('id',e.id,'tenant',tn.name,'price',e.agreed_price,'status',e.status,'payment_demo',e.payment_demo))
             FROM capacity_engagements e JOIN tenants tn ON tn.id=e.counter_tenant_id WHERE e.post_id=p.id) AS engagements
     FROM capacity_posts p JOIN tenants t ON t.id=p.tenant_id
     ORDER BY p.created_at DESC LIMIT 100`, []);
  res.json({ posts: rows });
});

r.post('/capacity', async (req, res) => {
  if (!req.myTenant) return res.status(403).json({ error: 'רק בעלי מכבסות מאומתים יכולים לפרסם' });
  const { kind, equipment, kg_per_day, days, area, price, notes } = req.body || {};
  if (!['request','offer'].includes(kind)) return res.status(400).json({ error: 'kind: request | offer' });
  if (!equipment || !String(equipment).trim()) return res.status(400).json({ error: 'ציוד חובה' });
  const { rows } = await q(
    `INSERT INTO capacity_posts(tenant_id, kind, equipment, kg_per_day, days, area, price, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [req.myTenant.id, kind, String(equipment).trim(), kg_per_day || null, days || null, area || null, price || null, notes || null]);
  res.status(201).json({ post: rows[0] });
});

r.post('/capacity/:id/engage', uuidParams('id'), async (req, res) => {
  if (!req.myTenant) return res.status(403).json({ error: 'רק בעלי מכבסות מאומתים' });
  const { rows: p } = await q('SELECT * FROM capacity_posts WHERE id=$1', [req.params.id]);
  if (!p[0]) return res.status(404).json({ error: 'מודעה לא נמצאה' });
  if (p[0].tenant_id === req.myTenant.id) return res.status(400).json({ error: 'לא ניתן להתקשר עם המודעה שלך' });
  if (p[0].status !== 'open') return res.status(409).json({ error: 'המודעה כבר לא פתוחה' });
  const price = Number((req.body || {}).agreed_price) || p[0].price || null;
  const { rows } = await q(
    'INSERT INTO capacity_engagements(post_id, counter_tenant_id, agreed_price) VALUES ($1,$2,$3) RETURNING *',
    [p[0].id, req.myTenant.id, price]);
  await q(`UPDATE capacity_posts SET status='engaged' WHERE id=$1`, [p[0].id]);
  res.status(201).json({ engagement: rows[0] });
});

r.post('/capacity/engagements/:id/done', uuidParams('id'), async (req, res) => {
  const payment = Number((req.body || {}).payment_demo) || null;
  const { rows } = await q(
    `UPDATE capacity_engagements e SET status='done', payment_demo=$2
     FROM capacity_posts p
     WHERE e.id=$1 AND e.status='active' AND p.id=e.post_id AND (p.tenant_id=$3 OR e.counter_tenant_id=$3)
     RETURNING e.id`, [req.params.id, payment, req.myTenant ? req.myTenant.id : null]);
  if (!rows[0]) return res.status(404).json({ error: 'התקשרות לא נמצאה או כבר הסתיימה' });
  await q(`UPDATE capacity_posts SET status='closed' WHERE id=(SELECT post_id FROM capacity_engagements WHERE id=$1)`, [req.params.id]);
  res.json({ ok: true, payment_demo: payment });
});

// ---------- E6.T5: תוכן ענפי ----------
r.get('/content', async (req, res) => {
  const params = [];
  let where = 'a.published';
  if (req.query.category) { params.push(req.query.category); where += ' AND a.category=$1'; }
  const { rows } = await q(
    `SELECT a.id, a.category, a.title, left(a.body, 200) AS excerpt, a.views, a.created_at, u.name AS author_name
     FROM content_articles a JOIN users u ON u.id=a.author_id
     WHERE ${where} ORDER BY a.created_at DESC LIMIT 100`, params);
  res.json({ articles: rows });
});

r.get('/content/:id', uuidParams('id'), async (req, res) => {
  const { rows } = await q(
    `UPDATE content_articles a SET views=views+1 WHERE a.id=$1 AND a.published
     RETURNING a.id, a.category, a.title, a.body, a.views, a.created_at, (SELECT name FROM users WHERE id=a.author_id) AS author_name`,
    [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'מאמר לא נמצא' });
  res.json({ article: rows[0] });
});

// פרסום ע"י אדמין פלטפורמה בלבד
r.post('/content', requireAdmin, async (req, res) => {
  const { category, title, body } = req.body || {};
  if (!['article','guide','standard','news'].includes(category)) return res.status(400).json({ error: 'קטגוריה לא תקינה' });
  if (!title || !String(title).trim() || !body || !String(body).trim()) return res.status(400).json({ error: 'כותרת ותוכן חובה' });
  const { rows } = await q(
    'INSERT INTO content_articles(author_id, category, title, body) VALUES ($1,$2,$3,$4) RETURNING *',
    [req.user.id, category, String(title).trim(), String(body).trim()]);
  res.status(201).json({ article: rows[0] });
});

module.exports = r;
