-- T112: סימון טנאנטי בדיקות (הסתרה מהרשימה הציבורית) + ניקוי ביקורות QA גלויות
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;
UPDATE tenants SET is_test=true
 WHERE name ILIKE '%בדיקה%' OR name ILIKE '%E2E%' OR name ILIKE '%פטור דמו%'
    OR slug ILIKE '%test%' OR slug ILIKE '%e2e%';
-- ביקורות בדיקה על טנאנטים אמיתיים (טקסטים מזוהי-QA מדוחות הבודקים)
DELETE FROM reviews
 WHERE text ILIKE '%בדיקת QA%' OR text ILIKE '%ביקורת QA%' OR text ILIKE '%בדיקה חיה%';
