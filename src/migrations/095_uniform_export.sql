-- הנה"ח אמיתי (095): רישום הפקות מבנה אחיד (OPENFRMT) — INI.TXT + BKMVDATA.TXT (מכווץ ZIP).
-- כל הפקה נשמרת עם מזהה ראשי ייחודי (15 ספרות רנדומליות), ספירות רשומות, וטביעות אצבע SHA-256.
-- הערה: שדה רישום התוכנה (1006) מופק כאפסים — התוכנה טרם נרשמה ברשות המסים, ההפקה היא טיוטה בלבד.
CREATE TABLE IF NOT EXISTS bk_uniform_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  from_date date NOT NULL,
  to_date date NOT NULL,
  main_identifier text NOT NULL,              -- 15 ספרות, ייחודי לכל הפקה (שדות 1004/1103/1153)
  counts jsonb NOT NULL DEFAULT '{}'::jsonb,  -- ספירות לפי סוג רשומה: B100/B110/C100/D110/D120/M100
  ini_sha256 text NOT NULL,
  zip_sha256 text NOT NULL,
  ini_data bytea NOT NULL,                    -- INI.TXT בקידוד CP862, סיומות CRLF
  zip_data bytea NOT NULL,                    -- BKMVDATA.zip (אחסון STORE ללא דחיסה, לפי סעיף 2.2ד)
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bk_uniform_exports_tenant ON bk_uniform_exports(tenant_id, created_at DESC);
