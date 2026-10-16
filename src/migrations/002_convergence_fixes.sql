-- 002_convergence_fixes — תיקונים אידמפוטנטיים שחיים בעבר ב-boot ומבטיחים התכנסות של כל DB למצב הנוכחי.
-- אידמפוטנטי לחלוטין: בטוח להרצה על DB בכל מצב ביניים.

-- QA2.T8: הרחבת יחידת 'שק' (האילוץ נוצר עם הטבלה ולא מתעדכן מ-CREATE IF NOT EXISTS)
ALTER TABLE price_items DROP CONSTRAINT IF EXISTS price_items_unit_check;
ALTER TABLE price_items ADD CONSTRAINT price_items_unit_check CHECK (unit IN ('item','kg','bag'));

-- מספור רציף (החלטת משתמש 16.10): קיפול מונים מבוססי-שנה למונה year=0 יחיד
INSERT INTO doc_counters(tenant_id, kind, year, next_number)
SELECT tenant_id, kind, 0, max(next_number) FROM doc_counters WHERE year <> 0 GROUP BY tenant_id, kind
ON CONFLICT (tenant_id, kind, year) DO UPDATE SET next_number = GREATEST(doc_counters.next_number, EXCLUDED.next_number);

-- חשבונית מרכזת כברירת מחדל לחשבונות עסקיים
ALTER TABLE business_accounts ADD COLUMN IF NOT EXISTS consolidated_billing boolean NOT NULL DEFAULT true;

-- ביקורת אחת לכל (הזמנה, משתמש): ניקוי כפילויות + אינדקסים ייחודיים
DELETE FROM reviews a USING reviews b
  WHERE a.ctid < b.ctid AND a.order_id=b.order_id AND a.user_id=b.user_id
    AND a.target_courier_id IS NOT DISTINCT FROM b.target_courier_id;
CREATE UNIQUE INDEX IF NOT EXISTS reviews_order_user_uniq ON reviews(order_id, user_id) WHERE target_courier_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS reviews_order_user_courier_uniq ON reviews(order_id, user_id, target_courier_id) WHERE target_courier_id IS NOT NULL;
