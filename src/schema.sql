-- מכבסה בקליק — סכימה רב-דיירתית. כל ישות עסקית נושאת tenant_id.
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;

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
  expires_at timestamptz,
  min_order numeric(8,2) DEFAULT 0,
  usage_limit int,
  used_count int DEFAULT 0,
  per_user_limit int,
  reason text DEFAULT 'campaign',
  UNIQUE (tenant_id, code)
);
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS expires_at timestamptz;
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS min_order numeric(8,2) DEFAULT 0;
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS usage_limit int;
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS used_count int DEFAULT 0;
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS per_user_limit int;
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS reason text DEFAULT 'campaign';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_id uuid REFERENCES coupons(id);

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

-- E12: חשבוניות עצמאיות (מסמכים חשבונאיים)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS dealer_type text CHECK (dealer_type IN ('morasha','patur'));
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS dealer_id text;

CREATE TABLE IF NOT EXISTS doc_counters (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('invoice','receipt','credit')),
  year int NOT NULL,
  next_number int NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, kind, year)
);

CREATE TABLE IF NOT EXISTS documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id uuid REFERENCES orders(id),
  customer_id uuid REFERENCES users(id),
  kind text NOT NULL CHECK (kind IN ('invoice','receipt','credit')),
  doc_year int NOT NULL,
  doc_number int NOT NULL,
  allocation_number varchar(9),
  amount numeric(10,2) NOT NULL,
  vat numeric(10,2) NOT NULL DEFAULT 0,
  total numeric(10,2) NOT NULL,
  status text NOT NULL DEFAULT 'issued' CHECK (status IN ('issued','partially_credited','credited')),
  credited_amount numeric(10,2) NOT NULL DEFAULT 0,
  original_id uuid REFERENCES documents(id),
  pdf bytea,
  issued_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, kind, doc_year, doc_number)
);

-- אי-שינוי: רק allocation_number / credited_amount / status ניתנים לעדכון; אין DELETE
CREATE OR REPLACE FUNCTION documents_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'documents are immutable'; END IF;
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.order_id IS DISTINCT FROM OLD.order_id
     OR NEW.customer_id IS DISTINCT FROM OLD.customer_id OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.doc_year IS DISTINCT FROM OLD.doc_year OR NEW.doc_number IS DISTINCT FROM OLD.doc_number
     OR NEW.amount IS DISTINCT FROM OLD.amount OR NEW.vat IS DISTINCT FROM OLD.vat
     OR NEW.total IS DISTINCT FROM OLD.total OR NEW.original_id IS DISTINCT FROM OLD.original_id
     OR NEW.issued_at IS DISTINCT FROM OLD.issued_at THEN
    RAISE EXCEPTION 'document fields are immutable (use a credit note)';
  END IF;
  -- PDF מקור: נשמר פעם אחת בלבד (NULL -> ערך); אין החלפה או מחיקה
  IF NEW.pdf IS DISTINCT FROM OLD.pdf AND NOT (OLD.pdf IS NULL AND NEW.pdf IS NOT NULL) THEN
    RAISE EXCEPTION 'original pdf is write-once';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS documents_immutable_trg ON documents;
CREATE TRIGGER documents_immutable_trg BEFORE UPDATE OR DELETE ON documents FOR EACH ROW EXECUTE FUNCTION documents_immutable();

CREATE TABLE IF NOT EXISTS document_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  action text NOT NULL,
  actor_id uuid,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- E5: שליחים משותפים ושליחי פלטפורמה
ALTER TABLE couriers ADD COLUMN IF NOT EXISTS rejected_reason text;
ALTER TABLE couriers ADD COLUMN IF NOT EXISTS priority numeric(3,2) DEFAULT 1.0;  -- E5.T7: יורד עם דירוג נמוך חוזר

CREATE TABLE IF NOT EXISTS courier_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  courier_id uuid NOT NULL REFERENCES couriers(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('license','insurance','photo')),
  filename text NOT NULL,
  mime text NOT NULL,
  data bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS courier_docs_idx ON courier_documents(courier_id);

-- E5.T3: מסלולים משולבים רב-מכבסתיים
CREATE TABLE IF NOT EXISTS courier_routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  courier_id uuid NOT NULL REFERENCES couriers(id) ON DELETE CASCADE,
  route_date date NOT NULL,
  combined boolean DEFAULT false,        -- נוצר מ-2+ מכבסות
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','done')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS routes_courier_idx ON courier_routes(courier_id, route_date);

CREATE TABLE IF NOT EXISTS courier_route_stops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id uuid NOT NULL REFERENCES courier_routes(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  seq int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(route_id, order_id)
);
CREATE INDEX IF NOT EXISTS route_stops_idx ON courier_route_stops(route_id, seq);

-- E5.T4: פיצול תשלום ורווחי שליח
CREATE TABLE IF NOT EXISTS platform_settings (
  key text PRIMARY KEY,
  value text NOT NULL
);
INSERT INTO platform_settings(key, value) VALUES ('courier_rate_per_stop','12'), ('courier_commission_pct','20')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS courier_earnings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  courier_id uuid NOT NULL REFERENCES couriers(id) ON DELETE CASCADE,
  order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
  tenant_id uuid REFERENCES tenants(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('pickup','delivery','adjustment')),
  stops int NOT NULL DEFAULT 1,
  gross numeric(9,2) NOT NULL,
  commission numeric(9,2) NOT NULL,
  net numeric(9,2) NOT NULL,
  status text NOT NULL DEFAULT 'accrued' CHECK (status IN ('accrued','paid_demo','disputed')),
  week_start date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(courier_id, order_id, kind)
);
CREATE INDEX IF NOT EXISTS earnings_courier_idx ON courier_earnings(courier_id, week_start);
