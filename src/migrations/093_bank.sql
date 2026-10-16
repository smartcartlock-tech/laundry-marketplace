-- הנה"ח אמיתי (093): ייבוא תנועות בנק מ-CSV והתאמת בנק מול חשבון הבנק בספר (1010).
CREATE TABLE IF NOT EXISTS bk_bank_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  file_name text,
  rows_count int NOT NULL DEFAULT 0,
  skipped_count int NOT NULL DEFAULT 0,
  imported_by uuid REFERENCES users(id),
  imported_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS bk_bank_txs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  import_id uuid NOT NULL REFERENCES bk_bank_imports(id) ON DELETE CASCADE,
  tx_date date NOT NULL,
  description text,
  reference text,
  amount numeric(12,2) NOT NULL,        -- חיובי=זכות (נכנס), שלילי=חובה (יצא)
  balance_after numeric(12,2),
  status text NOT NULL DEFAULT 'unmatched' CHECK (status IN ('unmatched','matched','booked','ignored')),
  matched_line_id uuid REFERENCES bk_lines(id),
  booked_entry_id uuid REFERENCES bk_entries(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bk_bank_txs_tenant ON bk_bank_txs(tenant_id, status, tx_date);
