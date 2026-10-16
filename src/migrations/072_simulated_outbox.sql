-- N4: תיבת דואר יוצא מדומה — דוא"ל/וואטסאפ נרשמים בלבד, אין שליחה אמיתית לאף אחד
CREATE TABLE IF NOT EXISTS simulated_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('whatsapp','email')),
  recipient text NOT NULL,
  subject text,
  body text NOT NULL,
  meta jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_simulated_outbox_user ON simulated_outbox(user_id, created_at DESC);
