-- C2: זכות המחיקה (תיקון 13) — חותמת אנונימיזציה על חשבון שנמחק
ALTER TABLE users ADD COLUMN IF NOT EXISTS anonymized_at timestamptz;
