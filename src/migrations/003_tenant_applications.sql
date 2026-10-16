-- B2: בקשות הצטרפות ציבוריות ממכבסות (טופס ציבורי → תור אישור לאדמין)
CREATE TABLE IF NOT EXISTS tenant_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  laundry_name text NOT NULL,
  city text NOT NULL,
  phone text NOT NULL,
  est_orders int,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','converted','rejected')),
  tenant_id uuid REFERENCES tenants(id) ON DELETE SET NULL,
  handled_by uuid REFERENCES users(id) ON DELETE SET NULL,
  handled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tenant_applications_status_idx ON tenant_applications(status, created_at DESC);
