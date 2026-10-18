-- T111: דה-דופ הודעות — מפתח ייחודי לוגי (אותו סטטוס לאותה הזמנה לא נשלח פעמיים)
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS dedup_key text;
ALTER TABLE user_messages ADD COLUMN IF NOT EXISTS dedup_key text;
CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedup_uniq ON notifications(user_id, dedup_key) WHERE dedup_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS user_messages_dedup_uniq ON user_messages(user_id, dedup_key) WHERE dedup_key IS NOT NULL;
