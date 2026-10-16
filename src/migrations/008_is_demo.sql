-- G5: סימון נתוני דמו. purge-demo/reset-demo חייבים לגעת אך ורק בטננטים/משתמשים
-- מסומנים is_demo — לעולם לא בנתונים אחרים (למשל הנה"ח אמיתית על טננט לא-דמו).
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
-- backfill: ארבע מכבסות הדמו הידועות + טלפוני הדמו (+9725000000xx)
UPDATE tenants SET is_demo=true WHERE slug IN ('achuza','express','mumchim','carmel');
UPDATE users SET is_demo=true WHERE phone LIKE '+9725000000%';
