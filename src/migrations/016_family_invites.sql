-- CX-B3: הצטרפות משפחה/שותף למנוי (דמו) — הזמנה בקישור בלבד, ללא שליחת הודעות
CREATE TABLE IF NOT EXISTS family_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  used_by uuid REFERENCES users(id),
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS family_invites_owner_idx ON family_invites(owner_user_id);
CREATE TABLE IF NOT EXISTS family_members (
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  member_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_user_id, member_user_id)
);
