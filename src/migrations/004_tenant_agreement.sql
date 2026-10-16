-- B4: הסכם שירות דיגיטלי — תאריך אישור + גרסת ההסכם שאושרה
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS accepted_terms_at timestamptz;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS accepted_terms_version text;
