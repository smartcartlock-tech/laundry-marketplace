-- נתונים פיננסיים אמיתיים של מכבסה (בנק/ספקים) — כל השדות הרגישים מוצפנים ברמת שדה (src/fieldcrypto.js)
CREATE TABLE IF NOT EXISTS tenant_financials(
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  bank_code_enc text,
  branch_enc text,
  account_number_enc text,
  iban_enc text,
  beneficiary_enc text,
  supplier_notes_enc text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
