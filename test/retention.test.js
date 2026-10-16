// C3: Retention — נתונים שפגו/ישנים נמחקים; נתונים טריים לא נפגעים
const { test } = require('node:test');
const assert = require('node:assert');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://postgres@127.0.0.1:5433/laundry_test';
process.env.PGSCHEMA = 'test_retention_' + Math.random().toString(36).slice(2, 6);

const { migrate, q, pool } = require('../src/db');
const { runRetention } = require('../src/retention');

test('C3: runRetention מוחק otp/סשנים שפגו והתראות ישנות בלבד', async (t) => {
  await migrate();
  t.after(() => pool.end());

  const { rows: ten } = await q(`INSERT INTO tenants(slug, name) VALUES ('ret', 'מכבסת בדיקה') RETURNING id`);
  const tid = ten[0].id;

  // otp: אחד שפג אתמול (ימחק), אחד טרי (יישאר)
  await q(`INSERT INTO otp_codes(channel, target, code, expires_at) VALUES
    ('demo', '+972500000001', '111111', now() - interval '2 days'),
    ('demo', '+972500000001', '222222', now() + interval '10 minutes')`);
  // bot_sessions: אחד שפג (ימחק), אחד פעיל (יישאר)
  await q(`INSERT INTO bot_sessions(phone, tenant_id, expires_at) VALUES
    ('+972500000001', $1, now() - interval '2 days'),
    ('+972500000001', $1, now() + interval '1 day')`, [tid]);
  // notifications: אחת בת 100 יום (תמחק), אחת חדשה (תישאר)
  await q(`INSERT INTO notifications(tenant_id, channel, body, created_at) VALUES
    ($1, 'log', 'ישנה', now() - interval '100 days'),
    ($1, 'log', 'חדשה', now())`, [tid]);

  // auth_sessions: סשן שפג אתמול (ימחק), סשן פעיל (יישאר), סשן שבוטל לפני שעה (יישאר — חלון 7 ימים)
  const { rows: usr } = await q(`INSERT INTO users(phone) VALUES ('+972500000099') RETURNING id`);
  await q(`INSERT INTO auth_sessions(user_id, jti, expires_at) VALUES
    ($1, 'ret-old', now() - interval '2 days'),
    ($1, 'ret-live', now() + interval '1 day')`, [usr[0].id]);
  await q(`INSERT INTO auth_sessions(user_id, jti, expires_at, revoked_at) VALUES
    ($1, 'ret-rev', now() + interval '1 day', now() - interval '1 hour')`, [usr[0].id]);

  const counts = await runRetention();
  assert.equal(counts.otp_codes, 1);
  assert.equal(counts.bot_sessions, 1);
  assert.equal(counts.notifications, 1);
  assert.equal(counts.auth_sessions, 1, 'רק הסשן שפג נמחק');

  const left = await q(`SELECT
    (SELECT count(*)::int FROM otp_codes) AS otp,
    (SELECT count(*)::int FROM bot_sessions) AS sess,
    (SELECT count(*)::int FROM notifications) AS notif`);
  assert.deepEqual(left.rows[0], { otp: 1, sess: 1, notif: 1 });

  // הרצה כפולה — אין מה למחוק, לא נשבר
  const left2 = await q(`SELECT count(*)::int AS n FROM auth_sessions`);
  assert.equal(left2.rows[0].n, 2, 'סשן פעיל + סשן שבוטל בתוך 7 ימים נשמרים');

  const again = await runRetention();
  assert.deepEqual(again, { otp_codes: 0, bot_sessions: 0, notifications: 0, auth_sessions: 0 });
});
