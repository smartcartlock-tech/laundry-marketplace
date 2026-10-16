-- B1: גרסת טוקן למשתמש — מאפשרת ביטול גלובלי של כל הטוקנים (logout/פשרה)
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version integer NOT NULL DEFAULT 0;
