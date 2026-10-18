-- T93: קוד מסירה חד-פעמי אצל הלקוח (6 ספרות) — מחליף את מסלול 4 ספרות הטלפון.
-- ברירת מחדל ברמת DB כדי שכל נתיב יצירת הזמנה (אפליקציה/בוט/B2B/איסוף קבוע) יקבל קוד.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_code text;
ALTER TABLE orders ALTER COLUMN delivery_code SET DEFAULT lpad(floor(random()*1000000)::int::text, 6, '0');
UPDATE orders SET delivery_code = lpad(floor(random()*1000000)::int::text, 6, '0') WHERE delivery_code IS NULL;
ALTER TABLE orders ALTER COLUMN delivery_code SET NOT NULL;
