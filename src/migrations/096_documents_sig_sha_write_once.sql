-- הקפאת signature ו-sha256 כ-write-once (כמו pdf): NULL -> ערך מותר (backfill), החלפה/מחיקה אסורה.
-- באה במקום הדריסה השקטה שהייתה ב-migrateDocumentIntegrity (כעת דוח בלבד) — שינוי חתימה/האש
-- של מסמך שויך מתבצע רק דרך זיכוי/מסמך חדש. + ניקוי שורות doc_counters ישנות (year<>0) לאחר שהקיפול ל-year=0 אומת.
CREATE OR REPLACE FUNCTION documents_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'documents are immutable'; END IF;
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.order_id IS DISTINCT FROM OLD.order_id
     OR NEW.customer_id IS DISTINCT FROM OLD.customer_id OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.doc_year IS DISTINCT FROM OLD.doc_year OR NEW.doc_number IS DISTINCT FROM OLD.doc_number
     OR NEW.amount IS DISTINCT FROM OLD.amount OR NEW.vat IS DISTINCT FROM OLD.vat
     OR NEW.total IS DISTINCT FROM OLD.total OR NEW.original_id IS DISTINCT FROM OLD.original_id
     OR NEW.issued_at IS DISTINCT FROM OLD.issued_at THEN
    RAISE EXCEPTION 'document fields are immutable (use a credit note)';
  END IF;
  -- PDF מקור: נשמר פעם אחת בלבד (NULL -> ערך); אין החלפה או מחיקה
  IF NEW.pdf IS DISTINCT FROM OLD.pdf AND NOT (OLD.pdf IS NULL AND NEW.pdf IS NOT NULL) THEN
    RAISE EXCEPTION 'original pdf is write-once';
  END IF;
  -- חתימה ו-sha256: write-once באותו כלל (מאפשר backfill של NULL בלבד)
  IF NEW.signature IS DISTINCT FROM OLD.signature AND NOT (OLD.signature IS NULL AND NEW.signature IS NOT NULL) THEN
    RAISE EXCEPTION 'document signature is write-once';
  END IF;
  IF NEW.sha256 IS DISTINCT FROM OLD.sha256 AND NOT (OLD.sha256 IS NULL AND NEW.sha256 IS NOT NULL) THEN
    RAISE EXCEPTION 'document sha256 is write-once';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- שורות doc_counters מהתקופה שלפני הקיפול ל-year=0: נמחקות רק אם קיימת שורת year=0 לאותו (tenant,kind)
DELETE FROM doc_counters c WHERE c.year <> 0
  AND EXISTS (SELECT 1 FROM doc_counters z WHERE z.tenant_id = c.tenant_id AND z.kind = c.kind AND z.year = 0);
