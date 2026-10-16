-- הנה"ח אמיתי (092): מסמכי הכנסה — חשבונית מס/קבלה/חשבונית עסקה.
-- כלל ברזל (הוראת חיים): חשבונית מס (305/320) לעולם לא "מונפקת" בלי מספר הקצאה —
-- עד אז היא טיוטה ("ממתין למספר הקצאה") בלי מספר סידורי. המספר הסידורי ניתן רק בהנפקה,
-- כדי לשמור מספור רציף ללא חורים (הוראות ניהול פנקסים).
CREATE TABLE IF NOT EXISTS bk_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  party_id uuid REFERENCES bk_parties(id),          -- כרטיס לקוח (אופציונלי — לקוח מזדמן)
  customer_name text NOT NULL,                      -- שם לקוח כפי שיודפס
  customer_tax_id text,                             -- מוצפן (fieldcrypto) כמו בכרטיסים
  kind text NOT NULL CHECK (kind IN ('tax_invoice','tax_invoice_receipt','invoice','receipt')),
  doc_year int, doc_number int,                     -- מוקצים רק בהנפקה
  issue_date date,                                  -- תאריך ההנפקה
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','issued','cancelled')),
  allocation_number text,                           -- מוזן ידנית ע"י הבעלים מהאזור האישי ברשות
  allocation_at timestamptz,                        -- מתי הוזן
  amount_net numeric(12,2) NOT NULL CHECK (amount_net >= 0),
  vat_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (vat_amount >= 0),
  entry_id uuid REFERENCES bk_entries(id),          -- פקודת היומן בהנפקה
  notes text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, kind, doc_year, doc_number)
);
CREATE TABLE IF NOT EXISTS bk_document_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES bk_documents(id) ON DELETE CASCADE, -- טיוטה בלבד נמחקת
  description text NOT NULL,
  quantity numeric(10,2) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price numeric(12,2) NOT NULL CHECK (unit_price >= 0),
  total numeric(12,2) NOT NULL CHECK (total >= 0)
);
CREATE INDEX IF NOT EXISTS bk_doc_lines_doc ON bk_document_lines(document_id);
-- מונים רציפים לטננט+סוג+שנה (מוקצה בהנפקה בלבד, בטרנזקציה)
CREATE TABLE IF NOT EXISTS bk_doc_counters (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind text NOT NULL,
  year int NOT NULL,
  next_number int NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, kind, year)
);
