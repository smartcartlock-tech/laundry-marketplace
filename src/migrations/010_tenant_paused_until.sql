-- C1: מצב "עסוק" — השהיית הזמנות חדשות עד שעה מסוימת
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS paused_until timestamptz;
