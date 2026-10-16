-- N2: תבניות הודעה — ניהול תבניות עם משתנים ({{var}}) לשימוש פנימי ולסימולציות
CREATE TABLE IF NOT EXISTS message_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL,
  channel text NOT NULL DEFAULT 'in_app' CHECK (channel IN ('in_app','whatsapp_sim','email_sim')),
  title text NOT NULL,
  body text NOT NULL,
  variables text[] DEFAULT '{}',
  active boolean DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
