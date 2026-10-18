-- T94: תיעוד גביית מזומן של שליח — צעד חובה לפני סגירת משימת מזומן, עם חותמת זמן, להתחשבנות מול המכבסה.
CREATE TABLE courier_cash_collections (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 courier_id uuid NOT NULL REFERENCES couriers(id) ON DELETE CASCADE,
 order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
 tenant_id uuid REFERENCES tenants(id) ON DELETE SET NULL,
 outcome text NOT NULL CHECK (outcome IN ('collected','partial','refused')),
 amount numeric(9,2),
 note text,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX courier_cash_courier_idx ON courier_cash_collections(courier_id, created_at);
CREATE INDEX courier_cash_tenant_idx ON courier_cash_collections(tenant_id, created_at);
