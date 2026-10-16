-- N1: מרכז הודעות בתוך האפליקציה — הודעות/התראות פנימיות למשתמש (בלי שליחה חיצונית)
CREATE TABLE IF NOT EXISTS user_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id uuid REFERENCES tenants(id) ON DELETE SET NULL,
  kind text NOT NULL DEFAULT 'system' CHECK (kind IN ('system','order','template','sim')),
  title text NOT NULL,
  body text NOT NULL,
  data jsonb DEFAULT '{}',
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_user_messages_user ON user_messages(user_id, read_at, created_at DESC);
