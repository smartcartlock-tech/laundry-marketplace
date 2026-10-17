-- T82: מעקב שליח חי — pings מיקום עם retention של 24 שעות (פרטיות: מיקום רק במהלך מסירה).
-- הניקוי עצמו lazy (DELETE בתוך ה-endpoints) כי אין pg_cron בתוכנית החינמית.
CREATE TABLE IF NOT EXISTS courier_pings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  courier_id uuid NOT NULL REFERENCES couriers(id),
  order_id uuid NOT NULL REFERENCES orders(id),
  lat double precision NOT NULL,
  lon double precision NOT NULL,
  accuracy real,
  ts timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS courier_pings_order_ts_idx ON courier_pings(order_id, ts DESC);
CREATE INDEX IF NOT EXISTS courier_pings_tenant_idx ON courier_pings(tenant_id);
CREATE INDEX IF NOT EXISTS courier_pings_ts_idx ON courier_pings(ts);
