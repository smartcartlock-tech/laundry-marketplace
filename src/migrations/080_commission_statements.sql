-- התחשבנות עמלה חודשית מול הפלטפורמה (דמו בלבד, ללא חיוב אמיתי):
-- צילום ציפיית העמלה המחושבת מההזמנות מול החיוב בפועל שהמכבסה מזינה ידנית, כולל הפרש.
CREATE TABLE IF NOT EXISTS commission_statements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  year int NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  month int NOT NULL CHECK (month BETWEEN 1 AND 12),
  own_orders int NOT NULL DEFAULT 0,
  own_revenue numeric(10,2) NOT NULL DEFAULT 0,
  own_pct numeric(5,2) NOT NULL DEFAULT 0,
  marketplace_orders int NOT NULL DEFAULT 0,
  marketplace_revenue numeric(10,2) NOT NULL DEFAULT 0,
  marketplace_pct numeric(5,2) NOT NULL DEFAULT 0,
  expected_total numeric(10,2) NOT NULL DEFAULT 0,
  actual_total numeric(10,2),
  note text,
  recorded_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, year, month)
);
