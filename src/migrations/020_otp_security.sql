-- B2: OTP מאובטח — hash במקום קוד גלוי + מגבלת ניסיונות לקוד
ALTER TABLE otp_codes ADD COLUMN IF NOT EXISTS code_hash text;
ALTER TABLE otp_codes ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;
ALTER TABLE otp_codes ALTER COLUMN code DROP NOT NULL;
