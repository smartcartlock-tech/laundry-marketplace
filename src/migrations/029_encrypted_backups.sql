-- גיבויים מוצפנים (dump מלא, AES-256-GCM) — נוצרים יומית בתהליך, ניתנים לשחזור-בדיקה
CREATE TABLE IF NOT EXISTS encrypted_backups(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL DEFAULT 'daily',
  payload bytea NOT NULL,
  meta jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_encrypted_backups_created ON encrypted_backups(created_at DESC);
