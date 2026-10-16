-- B7 שלב א: דיווחי הפרת CSP (Report-Only) — לאומת מדיניות מחמירה לפני אכיפה
CREATE TABLE IF NOT EXISTS csp_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_uri text,
  violated_directive text,
  blocked_uri text,
  source_file text,
  line_number integer,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);
