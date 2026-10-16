-- CX-B1: כתובות — ברירת מחדל והערות לשליח
ALTER TABLE user_addresses ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;
ALTER TABLE user_addresses ADD COLUMN IF NOT EXISTS courier_note text;
-- ברירת מחדל אחת לכל משתמש
CREATE UNIQUE INDEX IF NOT EXISTS user_addresses_one_default ON user_addresses(user_id) WHERE is_default;
