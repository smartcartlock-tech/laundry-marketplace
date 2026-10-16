-- G3b: קוד מעקב ציבורי להזמנה — צפיית סטטוס בלי התחברות לפי קוד בלבד.
-- ברירת המחדל (8 תווי hex בלבד, בלי תווים דומים) ממולאת אחד-אחד גם לשורות קיימות.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_code text NOT NULL DEFAULT upper(encode(gen_random_bytes(4),'hex'));
CREATE UNIQUE INDEX IF NOT EXISTS orders_tracking_code_uidx ON orders(tracking_code);
