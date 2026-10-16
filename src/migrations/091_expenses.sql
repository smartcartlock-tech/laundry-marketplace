-- הנה"ח אמיתי (091): הוצאות וספקים עם צירוף קובץ חשבונית ספק.
-- הקובץ נשמר ב-DB (bytea) כמו שאר קבצי המערכת, ונכנס לגיבוי היומי המוצפן הקיים.
CREATE TABLE IF NOT EXISTS bk_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  party_id uuid NOT NULL REFERENCES bk_parties(id),
  expense_date date NOT NULL,
  description text NOT NULL,
  account_code text NOT NULL CHECK (account_code ~ '^5[0-9]{3}$'), -- חשבון הוצאה בלבד
  amount_net numeric(12,2) NOT NULL CHECK (amount_net >= 0),
  vat_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (vat_amount >= 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted','void')),
  entry_id uuid REFERENCES bk_entries(id),      -- פקודת הרישום בספר (אחרי post)
  void_entry_id uuid REFERENCES bk_entries(id), -- פקודת הסטורנו (אחרי void ממצב posted)
  file_name text, file_mime text, file_data bytea,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bk_expenses_tenant ON bk_expenses(tenant_id, expense_date);
