-- מסך שליח: דחיית הצעת שיבוץ עם סיבה (זמן תגובה נגזר מ-responded_at-created_at)
ALTER TABLE courier_offers ADD COLUMN IF NOT EXISTS decline_reason text;
