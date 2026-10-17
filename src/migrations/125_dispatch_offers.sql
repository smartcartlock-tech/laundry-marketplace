-- T81: הצעות שיבוץ אוטומטיות לשליחים (דמו) — שרשרת fallback עם מספר ניסיון (attempt)
CREATE TABLE IF NOT EXISTS dispatch_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  courier_id uuid NOT NULL REFERENCES couriers(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'offered' CHECK (status IN ('offered','accepted','expired','skipped')),
  attempt int NOT NULL DEFAULT 1,
  offered_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz
);
CREATE INDEX IF NOT EXISTS dispatch_offers_order_idx ON dispatch_offers(order_id, status);
CREATE INDEX IF NOT EXISTS dispatch_offers_courier_idx ON dispatch_offers(courier_id, status);
CREATE INDEX IF NOT EXISTS dispatch_offers_tenant_idx ON dispatch_offers(tenant_id, status);
