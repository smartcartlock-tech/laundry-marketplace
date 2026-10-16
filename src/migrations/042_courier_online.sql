-- מסך שליח: מתג זמינות (אונליין/אופליין) — שיבוץ אוטומטי משבץ רק שליחים זמינים
ALTER TABLE couriers ADD COLUMN IF NOT EXISTS is_online boolean NOT NULL DEFAULT true;
