-- ביקורת סשנים: מעקב מכשירים מחוברים, ניתוק מרחוק, תפוגה
CREATE TABLE IF NOT EXISTS auth_sessions(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  jti text UNIQUE NOT NULL,
  user_agent text,
  ip text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id) WHERE revoked_at IS NULL;
