-- B3: שמירת טיוטת אשף ההקמה — המשך עבודה אחרי רענון/התנתקות
CREATE TABLE IF NOT EXISTS onboarding_drafts (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  draft jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);
