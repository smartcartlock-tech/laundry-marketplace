-- T81: לוג החלטות שיבוץ אוטומטי (דמו) — מי הוצע, מדוע, ומה הוחלט בכל צעד
CREATE TABLE IF NOT EXISTS dispatch_log (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id uuid REFERENCES orders(id) ON DELETE CASCADE,
  decision text NOT NULL,
  reason text,
  payload jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dispatch_log_tenant_idx ON dispatch_log(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS dispatch_log_order_idx ON dispatch_log(order_id);
