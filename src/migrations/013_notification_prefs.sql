-- CX5: העדפות התראות ללקוח — ברירת מחדל הכל פעיל
CREATE TABLE IF NOT EXISTS user_notification_prefs (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  status_updates boolean NOT NULL DEFAULT true,
  marketing boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
