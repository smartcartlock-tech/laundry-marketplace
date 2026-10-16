-- N5 (ממצא 7): טוקני שיחה של הבוט ומפתח הפלטפורמה נשמרים כ-sha256 בלבד.
-- הטוקן הגלוי מוחזר פעם אחת ביצירת הסשן (handoff) ולא נשמר; גישה לפי hash בלבד.
ALTER TABLE bot_sessions ADD COLUMN IF NOT EXISTS token_hash text;
UPDATE bot_sessions SET token_hash = encode(digest(token, 'sha256'), 'hex') WHERE token_hash IS NULL;
ALTER TABLE bot_sessions ALTER COLUMN token DROP NOT NULL;
ALTER TABLE bot_sessions ALTER COLUMN token DROP DEFAULT;
UPDATE bot_sessions SET token = NULL;
ALTER TABLE bot_sessions ALTER COLUMN token_hash SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS bot_sessions_token_hash_idx ON bot_sessions(token_hash);

ALTER TABLE platform_keys ADD COLUMN IF NOT EXISTS key_hash text;
UPDATE platform_keys SET key_hash = encode(digest(key, 'sha256'), 'hex') WHERE key_hash IS NULL;
