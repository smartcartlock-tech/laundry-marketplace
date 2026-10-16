-- מודול הנהלת חשבונות אמיתי (לא דמו) — ליבת ספר כפול.
-- הפרדה מלאה מטבלאות הדמו: כל הטבלאות עם קידומת bk_ ונגישות לבעלים בלבד (נאכף ברואטר).
-- עקרונות: פקודה מאוזנת בלבד, אין מחיקה/עדכון של פקודות — תיקון רק בסטורנו (סעיף 23א/24 להוראות ניהול פנקסים).

-- תרשים חשבונות (ישראלי בסיסי, נזרע לכל טננט בנפרד)
CREATE TABLE IF NOT EXISTS bk_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code text NOT NULL CHECK (code ~ '^[0-9]{4}$'),
  name_he text NOT NULL,
  type text NOT NULL CHECK (type IN ('asset','liability','equity','income','expense')),
  system boolean NOT NULL DEFAULT false, -- חשבון מערכת (נזרע) לא ניתן למחיקה
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);

-- כרטיסי לקוחות וספקים
CREATE TABLE IF NOT EXISTS bk_parties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('customer','supplier')),
  name text NOT NULL,
  tax_id text, -- עוסק מורשה/פטור/ח.פ
  email text, phone text, address text, notes text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bk_parties_tenant ON bk_parties(tenant_id, kind);

-- פקודות יומן (כותרת) — אימוטבילי: בלי UPDATE ובלי DELETE ברמת האפליקציה
CREATE TABLE IF NOT EXISTS bk_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entry_no int NOT NULL,
  entry_date date NOT NULL,
  description text NOT NULL,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','invoice','expense','bank','reversal')),
  reversal_of uuid REFERENCES bk_entries(id),
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, entry_no)
);
CREATE INDEX IF NOT EXISTS bk_entries_tenant_date ON bk_entries(tenant_id, entry_date);

-- שורות פקודה — צד אחד בכל שורה (חובה או זכות), תואם מבנה אחיד B100
CREATE TABLE IF NOT EXISTS bk_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entry_id uuid NOT NULL REFERENCES bk_entries(id) ON DELETE RESTRICT,
  account_id uuid NOT NULL REFERENCES bk_accounts(id),
  party_id uuid REFERENCES bk_parties(id),
  debit numeric(12,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit numeric(12,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  details text,
  CHECK (debit > 0 OR credit > 0),
  CHECK (NOT (debit > 0 AND credit > 0))
);
CREATE INDEX IF NOT EXISTS bk_lines_entry ON bk_lines(entry_id);
CREATE INDEX IF NOT EXISTS bk_lines_account ON bk_lines(tenant_id, account_id);

-- סגירת תקופה (חודשית) — פקודה חדשה בתקופה סגורה נחסמת
CREATE TABLE IF NOT EXISTS bk_periods (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  year int NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  month int NOT NULL CHECK (month BETWEEN 1 AND 12),
  closed_by uuid REFERENCES users(id),
  closed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, year, month)
);
