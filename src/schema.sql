-- מכבסה בקליק — סכימה רב-דיירתית. כל ישות עסקית נושאת tenant_id.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text UNIQUE,               -- E.164, e.g. +9725...
  email text UNIQUE,
  name text,
  role text NOT NULL DEFAULT 'customer' CHECK (role IN ('customer','courier','admin')),
  google_sub text UNIQUE,
  facebook_id text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  name text NOT NULL,
  letter text, color text DEFAULT '#0e7a8a',
  phone text, address text, city text,
  lat double precision, lng double precision,
  services text[] DEFAULT '{}',
  hours jsonb DEFAULT '{}',          -- {"0":[["08:00","20:00"]],...} weekday -> ranges
  terms text,
  delivery_fee numeric(8,2) DEFAULT 0,
  min_order numeric(8,2) DEFAULT 0,
  points_earn_rate numeric(5,4) DEFAULT 0.1,   -- נקודות לכל ₪1
  points_redeem_max_pct numeric(4,2) DEFAULT 0.2,
  is_open boolean DEFAULT true,
  approved boolean DEFAULT false,    -- אדמין פלטפורמה מאשר מכבסה חדשה
  api_key text UNIQUE DEFAULT encode(gen_random_bytes(24),'hex'),  -- לבוט וואטסאפ
  rating numeric(2,1) DEFAULT 0, rating_count int DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant_members (
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'owner' CHECK (role IN ('owner','staff')),
  PRIMARY KEY (tenant_id, user_id)
);

CREATE TABLE IF NOT EXISTS otp_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel text NOT NULL,             -- whatsapp | email | demo
  target text NOT NULL,              -- phone or email
  code text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS otp_target_idx ON otp_codes(target, created_at DESC);

CREATE TABLE IF NOT EXISTS price_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  category text DEFAULT 'כביסה',
  price numeric(8,2) NOT NULL,
  unit text DEFAULT 'item' CHECK (unit IN ('item','kg')),
  active boolean DEFAULT true,
  sort int DEFAULT 0
);
CREATE INDEX IF NOT EXISTS items_tenant_idx ON price_items(tenant_id) WHERE active;

CREATE TABLE IF NOT EXISTS pickup_windows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  weekday int NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time time NOT NULL,
  end_time time NOT NULL,
  capacity int DEFAULT 10,
  kind text DEFAULT 'pickup' CHECK (kind IN ('pickup','delivery'))
);

CREATE TABLE IF NOT EXISTS couriers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id uuid REFERENCES tenants(id) ON DELETE SET NULL,  -- NULL = שליח פלטפורמה עצמאי
  model text NOT NULL DEFAULT 'private' CHECK (model IN ('private','shared','platform')),
  vehicle text, areas text[] DEFAULT '{}',
  availability jsonb DEFAULT '{}',
  approved boolean DEFAULT false,
  rating numeric(2,1) DEFAULT 0, rating_count int DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  customer_id uuid NOT NULL REFERENCES users(id),
  source text NOT NULL DEFAULT 'app' CHECK (source IN ('app','bot','admin')),
  status text NOT NULL DEFAULT 'new' CHECK (status IN
    ('new','confirmed','picked_up','in_work','ready','out_for_delivery','delivered','cancelled')),
  address text NOT NULL,
  lat double precision, lng double precision,
  pickup_at timestamptz, delivery_at timestamptz,
  subtotal numeric(9,2) NOT NULL,
  delivery_fee numeric(8,2) DEFAULT 0,
  discount numeric(8,2) DEFAULT 0,
  total numeric(9,2) NOT NULL,
  payment_method text NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash','demo_online')),
  payment_status text NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending','paid_demo','paid_cash')),
  points_earned int DEFAULT 0, points_redeemed int DEFAULT 0,
  courier_id uuid REFERENCES couriers(id),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS orders_tenant_idx ON orders(tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_customer_idx ON orders(customer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  item_id uuid REFERENCES price_items(id),
  name text NOT NULL, price numeric(8,2) NOT NULL, qty numeric(6,1) NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS order_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status text NOT NULL,
  actor_id uuid REFERENCES users(id),
  note text, photo_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS events_order_idx ON order_events(order_id, created_at);

CREATE TABLE IF NOT EXISTS points_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL REFERENCES users(id),
  delta int NOT NULL,
  reason text,
  order_id uuid REFERENCES orders(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS points_idx ON points_ledger(tenant_id, user_id);

CREATE TABLE IF NOT EXISTS coupons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('percent','amount')),
  value numeric(8,2) NOT NULL,
  active boolean DEFAULT true,
  UNIQUE (tenant_id, code)
);

CREATE TABLE IF NOT EXISTS courier_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  courier_id uuid NOT NULL REFERENCES couriers(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'pickup' CHECK (kind IN ('pickup','delivery')),
  status text NOT NULL DEFAULT 'offered' CHECK (status IN ('offered','accepted','declined','expired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz
);
CREATE INDEX IF NOT EXISTS offers_courier_idx ON courier_offers(courier_id, status);

CREATE TABLE IF NOT EXISTS reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id uuid REFERENCES orders(id),
  user_id uuid REFERENCES users(id),
  target_courier_id uuid REFERENCES couriers(id),
  rating int NOT NULL CHECK (rating BETWEEN 1 AND 5),
  text text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id),
  user_id uuid REFERENCES users(id),
  channel text NOT NULL DEFAULT 'log',   -- whatsapp | log
  body text NOT NULL,
  sent boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
