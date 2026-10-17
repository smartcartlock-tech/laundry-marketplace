-- G17.T6: קודי OTP ייעודיים למחיקת חשבון — מבודדים מקודי הכניסה (otp_codes) כדי
-- שקוד מחיקה לא יוכל לשמש לכניסה ולהפך. נשמר HMAC בלבד, בדוגמת B2.
CREATE TABLE IF NOT EXISTS account_deletion_otps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed boolean NOT NULL DEFAULT false,
  attempts int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS acct_del_otp_user_idx ON account_deletion_otps(user_id, created_at DESC);
