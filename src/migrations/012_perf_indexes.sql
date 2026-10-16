-- D1: אינדקסים לשאילתות חמות — מבדק EXPLAIN מלא ב-docs/PERF.md
-- reviews לפי מכבסה (דף מכבסה + דירוג ב-bot-central) ולפי משתמש (עמוד "שלי")
CREATE INDEX IF NOT EXISTS reviews_tenant_idx ON reviews(tenant_id);
CREATE INDEX IF NOT EXISTS reviews_user_idx ON reviews(user_id);
-- דוח SLA לאדמין: אירועי picked_up ב-30 הימים האחרונים
CREATE INDEX IF NOT EXISTS order_events_status_created_idx ON order_events(status, created_at DESC);
