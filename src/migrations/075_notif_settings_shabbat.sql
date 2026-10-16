-- N7: הגדרות התראות מורחבות — הודעות הזמנה, שקט בשבת וחגים; תבנית סיכום יומי לבעל מכבסה
ALTER TABLE user_notification_prefs ADD COLUMN IF NOT EXISTS order_messages boolean NOT NULL DEFAULT true;
ALTER TABLE user_notification_prefs ADD COLUMN IF NOT EXISTS quiet_shabbat boolean NOT NULL DEFAULT false;

INSERT INTO message_templates (key, channel, title, body, variables) VALUES
 ('owner_daily_summary', 'in_app', 'סיכום יומי ליום {{תאריך}}',
  'סיכום יומי (סימולציה): התקבלו היום {{מספר_הזמנות}} הזמנות, הכנסה כוללת ₪{{הכנסה}}. חריגים: {{חריגים}}. מסמך דמו — נתוני המחשה בלבד.',
  ARRAY['תאריך','מספר_הזמנות','הכנסה','חריגים'])
ON CONFLICT (key) DO NOTHING;
