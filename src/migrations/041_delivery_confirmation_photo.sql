-- מסך שליח: צילום אישור מסירה נשמר ב-DB (בדומה לתמונות תקלות/מסמכי שליח)
ALTER TABLE delivery_confirmations ADD COLUMN IF NOT EXISTS photo_data bytea;
ALTER TABLE delivery_confirmations ADD COLUMN IF NOT EXISTS photo_mime text;
