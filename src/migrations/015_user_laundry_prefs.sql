-- CX-B2: העדפות כביסה שמורות ללקוח (ריח, מרכך, הוראות מיוחדות)
CREATE TABLE IF NOT EXISTS user_laundry_prefs (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  scent text NOT NULL DEFAULT '',
  softener boolean NOT NULL DEFAULT false,
  special_instructions text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);
