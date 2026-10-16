-- יומן ביקורת לפעולות מנהל פלטפורמה
CREATE TABLE IF NOT EXISTS audit_log(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid,
  actor_label text,
  action text NOT NULL,
  target_type text,
  target_id text,
  meta jsonb,
  ip text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at DESC);
