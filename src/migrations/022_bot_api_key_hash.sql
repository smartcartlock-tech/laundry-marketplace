-- B3: מפתחות הבוט נשמרים כ-sha256 בלבד. המפתחות הקיימים מגובבים במקום (pgcrypto) ועוברים לעמודת ה-hash;
-- העמודה הגלויה מתאפסת. אינטגרציות קיימות ממשיכות לעבוד כי האימות משווה hash מול hash.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS api_key_hash text;
UPDATE tenants SET api_key_hash = encode(digest(api_key, 'sha256'), 'hex') WHERE api_key IS NOT NULL AND api_key_hash IS NULL;
ALTER TABLE tenants ALTER COLUMN api_key DROP DEFAULT;
UPDATE tenants SET api_key = NULL;
CREATE UNIQUE INDEX IF NOT EXISTS tenants_api_key_hash_uniq ON tenants(api_key_hash) WHERE api_key_hash IS NOT NULL;
