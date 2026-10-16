-- מסך שליח: אישור מסירה (קוד לקוח / צילום) — רשומה אחת להזמנה
CREATE TABLE IF NOT EXISTS delivery_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  courier_id uuid NOT NULL REFERENCES couriers(id),
  method text NOT NULL CHECK (method IN ('code','photo')),
  detail text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(order_id)
);
CREATE INDEX IF NOT EXISTS delivery_confirmations_courier_idx ON delivery_confirmations(courier_id, created_at DESC);
