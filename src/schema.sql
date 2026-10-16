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
  unit text DEFAULT 'item' CHECK (unit IN ('item','kg','bag')),
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
  kind text NOT NULL CHECK (kind IN ('invoice','receipt','credit','consolidated')),
  year int NOT NULL,
  next_number int NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, kind, year)
);

CREATE TABLE IF NOT EXISTS documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id uuid REFERENCES orders(id),
  customer_id uuid REFERENCES users(id),
  kind text NOT NULL CHECK (kind IN ('invoice','receipt','credit','consolidated')),
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
-- E2: מנוי כביסה חודשי
CREATE TABLE IF NOT EXISTS subscription_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  bags_per_month int NOT NULL CHECK (bags_per_month > 0),
  kg_per_bag numeric(5,1) NOT NULL DEFAULT 8,
  price numeric(8,2) NOT NULL,
  extra_bag_price numeric(8,2),        -- מחיר שק חורג; NULL = לפי מחירון
  perks text,
  active boolean NOT NULL DEFAULT true,
  sort int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS plans_tenant_idx ON subscription_plans(tenant_id) WHERE active;

CREATE TABLE IF NOT EXISTS subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES subscription_plans(id),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','cancelled')),
  period_start date NOT NULL DEFAULT CURRENT_DATE,
  period_end date NOT NULL DEFAULT (CURRENT_DATE + INTERVAL '1 month'),
  bags_used numeric(6,1) NOT NULL DEFAULT 0,
  auto_renew boolean NOT NULL DEFAULT true,
  payment_status text NOT NULL DEFAULT 'paid_demo',  -- תשלום דמו בלבד
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- מנוי אחד פעיל/מושהה לכל (מכבסה, לקוח); אחרי ביטול אפשר להצטרף מחדש
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_one_live ON subscriptions(tenant_id, user_id) WHERE status <> 'cancelled';

CREATE TABLE IF NOT EXISTS subscription_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  order_id uuid REFERENCES orders(id),
  bags numeric(6,1) NOT NULL DEFAULT 0,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sub_usage_idx ON subscription_usage(subscription_id, created_at DESC);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS subscription_id uuid REFERENCES subscriptions(id);

ALTER TABLE price_items ADD COLUMN IF NOT EXISTS subscription_eligible boolean NOT NULL DEFAULT false;

-- E12.T6: חשבונית מרכזת, קוד אימות לסריקה, מצב הפקת מסמכים
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_kind_check;
ALTER TABLE documents ADD CONSTRAINT documents_kind_check CHECK (kind IN ('invoice','receipt','credit','consolidated'));
ALTER TABLE doc_counters DROP CONSTRAINT IF EXISTS doc_counters_kind_check;
ALTER TABLE doc_counters ADD CONSTRAINT doc_counters_kind_check CHECK (kind IN ('invoice','receipt','credit','consolidated'));
ALTER TABLE documents ADD COLUMN IF NOT EXISTS verify_code text;
UPDATE documents SET verify_code = upper(substr(md5(random()::text || id::text), 1, 10)) WHERE verify_code IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS documents_verify_code_uq ON documents(verify_code);

-- הזמנות המכוסות בחשבונית מרכזת — הזמנה מכוסה לכל היותר פעם אחת
CREATE TABLE IF NOT EXISTS document_orders (
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES orders(id),
  PRIMARY KEY (document_id, order_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS document_orders_order_uq ON document_orders(order_id);

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS invoice_mode text NOT NULL DEFAULT 'per_order';
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_invoice_mode_check;
ALTER TABLE tenants ADD CONSTRAINT tenants_invoice_mode_check CHECK (invoice_mode IN ('per_order','consolidated'));

-- E5.T6: קלאסטרים אזוריים ומסלולים קבועים
CREATE TABLE IF NOT EXISTS courier_clusters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  area text NOT NULL,
  active boolean DEFAULT true,
  mgmt_fee_monthly numeric(8,2) DEFAULT 150,   -- דמי ניהול חודשיים (דמו)
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS courier_cluster_members (
  cluster_id uuid NOT NULL REFERENCES courier_clusters(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cluster_id, tenant_id)
);

CREATE TABLE IF NOT EXISTS cluster_fixed_routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_id uuid NOT NULL REFERENCES courier_clusters(id) ON DELETE CASCADE,
  courier_id uuid NOT NULL REFERENCES couriers(id) ON DELETE CASCADE,
  weekday int NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  active boolean DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(cluster_id, courier_id, weekday)
);

-- E5.T7: דירוג דו-כיווני
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS tags text[];

CREATE TABLE IF NOT EXISTS courier_tenant_ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  courier_id uuid NOT NULL REFERENCES couriers(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
  rating int NOT NULL CHECK (rating BETWEEN 1 AND 5),
  text text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(courier_id, order_id)
);
-- E3: דף עסקי ממותג (White Label)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS slogan text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS whatsapp text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS logo bytea;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS logo_mime text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS signup_source text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS signup_tenant_id uuid REFERENCES tenants(id);
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_source_check;
ALTER TABLE orders ADD CONSTRAINT orders_source_check CHECK (source IN ('app','bot','admin','branded'));
INSERT INTO platform_settings(key, value) VALUES ('branded_commission_pct','5'), ('marketplace_commission_pct','12')
ON CONFLICT (key) DO NOTHING;


-- E6.T1: פורום מנהלים
CREATE TABLE IF NOT EXISTS forum_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category text NOT NULL CHECK (category IN ('operations','suppliers','group_purchase','pricing')),
  title text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS forum_posts_idx ON forum_posts(category, created_at DESC);

CREATE TABLE IF NOT EXISTS forum_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES forum_posts(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS forum_votes (
  post_id uuid NOT NULL REFERENCES forum_posts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

-- E6.T2: מכרזים
CREATE TABLE IF NOT EXISTS tenders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,  -- המפרסם (מכבסה; חשבון עסקי — בעתיד E4)
  poster_type text NOT NULL DEFAULT 'laundry' CHECK (poster_type IN ('laundry','business')),
  business_account_id uuid,          -- יקושר כש-E4.T1 יגיע
  title text NOT NULL,
  description text,
  volume_kg numeric(9,1),
  frequency text,                    -- שבועי/דו-שבועי/חודשי
  sla_text text,
  budget numeric(10,2),
  deadline timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','awarded','closed','cancelled')),
  winner_bid_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tender_bids (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tender_id uuid NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  price_per_kg numeric(8,2) NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tender_id, tenant_id)
);
ALTER TABLE tenders DROP CONSTRAINT IF EXISTS tenders_winner_bid_id_fkey;
ALTER TABLE tenders ADD CONSTRAINT tenders_winner_bid_id_fkey FOREIGN KEY (winner_bid_id) REFERENCES tender_bids(id);

-- E6.T3: רכש משותף
CREATE TABLE IF NOT EXISTS purchase_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product text NOT NULL,
  supplier text,
  unit_price numeric(8,2) NOT NULL,   -- מחיר רגיל
  group_price numeric(8,2) NOT NULL,  -- מחיר קבוצה
  target_participants int NOT NULL DEFAULT 3,
  deadline timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS purchase_group_members (
  group_id uuid NOT NULL REFERENCES purchase_groups(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  qty numeric(9,1) NOT NULL DEFAULT 1,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, tenant_id)
);

-- E6.T4: גלוס קיבולת
CREATE TABLE IF NOT EXISTS capacity_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('request','offer')),
  equipment text NOT NULL,           -- מכונה 18 ק"ג, מגהץ...
  kg_per_day numeric(8,1),
  days int,
  area text,
  price numeric(9,2),                -- מחיר מוצע/מבוקש
  notes text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','engaged','closed')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS capacity_engagements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES capacity_posts(id) ON DELETE CASCADE,
  counter_tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agreed_price numeric(9,2),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','done','cancelled')),
  payment_demo numeric(9,2),         -- תשלום דמו שתועד
  created_at timestamptz NOT NULL DEFAULT now()
);

-- E6.T5: תוכן ענפי
CREATE TABLE IF NOT EXISTS content_articles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id uuid NOT NULL REFERENCES users(id),
  category text NOT NULL CHECK (category IN ('article','guide','standard','news')),
  title text NOT NULL,
  body text NOT NULL,
  views int NOT NULL DEFAULT 0,
  published boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);



-- E12.T7 (spec): חתימת HMAC-SHA256 + גיבוב sha256 של ה-PDF המקורי (מסמך בלתי משתנה)
ALTER TABLE documents ADD COLUMN IF NOT EXISTS signature text;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS sha256 text;
-- E10.T1: בוט מרכזי — מפתח פלטפורמה וסשני שיחה זמניים (handoff)
CREATE TABLE IF NOT EXISTS platform_keys (
  name text PRIMARY KEY,
  key text NOT NULL DEFAULT encode(gen_random_bytes(24),'hex'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS bot_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(24),'hex'),
  phone text NOT NULL,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bot_sessions_token_idx ON bot_sessions(token);

-- E4.T1: חשבונות עסקיים (B2B) — חברה, מחירון הסכמי, שיוך משתמשים, תנאי תשלום
CREATE TABLE IF NOT EXISTS business_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  company_id text,
  contact_name text,
  contact_phone text,
  payment_terms text NOT NULL DEFAULT 'net30',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS business_account_users (
  account_id uuid NOT NULL REFERENCES business_accounts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (account_id, user_id)
);
CREATE TABLE IF NOT EXISTS business_prices (
  account_id uuid NOT NULL REFERENCES business_accounts(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES price_items(id) ON DELETE CASCADE,
  price numeric(10,2) NOT NULL CHECK (price >= 0),
  PRIMARY KEY (account_id, item_id)
);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS business_account_id uuid REFERENCES business_accounts(id) ON DELETE SET NULL;

-- E7.T2: צינור אונבורדינג מכבסות — הסכם → מחירון → בוט → הדרכה → פעיל
CREATE TABLE IF NOT EXISTS tenant_onboarding (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  stage text NOT NULL DEFAULT 'agreement' CHECK (stage IN ('agreement','pricing','bot','training','active')),
  notes text,
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- E7.T3: התראות SLA, דיווחי תקלות מלקוחות ומחלוקות — תור טיפול מרכזי
CREATE TABLE IF NOT EXISTS sla_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES orders(id) ON DELETE CASCADE,
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('late_pickup','late_delivery','customer_issue','courier_dispute')),
  details text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','handled')),
  handled_by uuid REFERENCES users(id),
  handled_at timestamptz,
  handle_note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS sla_alerts_order_kind_idx ON sla_alerts(order_id, kind) WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS sla_alerts_status_idx ON sla_alerts(status, created_at DESC);
-- E4.T2: תבניות הזמנה חוזרת לחשבון עסקי
CREATE TABLE IF NOT EXISTS recurring_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES business_accounts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  days jsonb NOT NULL,
  items jsonb NOT NULL,
  pickup_time text,
  address text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  last_run_on date,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_source_check;
ALTER TABLE orders ADD CONSTRAINT orders_source_check CHECK (source IN ('app','bot','admin','branded','recurring'));

-- E4.T3: חשבוניות מרוכזות חודשיות לחשבונות עסקיים (מסמך דמו — לא חשבונית מס)
CREATE TABLE IF NOT EXISTS business_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES business_accounts(id) ON DELETE CASCADE,
  year int NOT NULL,
  month int NOT NULL,
  orders_count int NOT NULL DEFAULT 0,
  total numeric(10,2) NOT NULL DEFAULT 0,
  pdf bytea,
  issued_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, year, month)
);


-- E9.T1: דיווחי תקלות לקוח עם תמונות — מול המכבסה + דגל גישור לאדמין
CREATE TABLE IF NOT EXISTS issue_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES users(id),
  kind text NOT NULL CHECK (kind IN ('damage','missing','late','other')),
  text text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved')),
  mediation boolean NOT NULL DEFAULT false,
  resolution_note text,
  handled_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS issue_reports_tenant_idx ON issue_reports(tenant_id, status, created_at DESC);
CREATE TABLE IF NOT EXISTS issue_report_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES issue_reports(id) ON DELETE CASCADE,
  content_type text NOT NULL DEFAULT 'image/jpeg',
  data bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS issue_photos_report_idx ON issue_report_photos(report_id);


-- E9.T3: התראות דחיפה (PWA) — מנויי push עם מפתחות VAPID עצמיים
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint text UNIQUE NOT NULL,
  keys jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS push_subs_user_idx ON push_subscriptions(user_id);

CREATE UNIQUE INDEX IF NOT EXISTS issue_reports_one_per_customer ON issue_reports(order_id, customer_id);

-- החלטת משתמש 16.10: מספור רציף ללא פערים לכל סוג מסמך, בלי אתחול שנתי.
-- מעבר לשורת מונה אחת (year=0) לכל (מכבסה, סוג); הרצף הקיים נשמר.
INSERT INTO doc_counters(tenant_id, kind, year, next_number)
SELECT tenant_id, kind, 0, max(next_number) FROM doc_counters WHERE year <> 0 GROUP BY tenant_id, kind
ON CONFLICT (tenant_id, kind, year) DO UPDATE SET next_number = GREATEST(doc_counters.next_number, EXCLUDED.next_number);

-- החלטת משתמש 16.10: חשבונית מרכזת — ברירת מחדל ללקוחות עסקיים, ניתנת לכיבוי
ALTER TABLE business_accounts ADD COLUMN IF NOT EXISTS consolidated_billing boolean NOT NULL DEFAULT true;

-- QA: ביקורת אחת לכל (הזמנה, משתמש) — כביסה ושליח בנפרד; ניקוי כפילויות קיימות לפני האינדקסים
DELETE FROM reviews a USING reviews b
  WHERE a.ctid < b.ctid AND a.order_id=b.order_id AND a.user_id=b.user_id
    AND a.target_courier_id IS NOT DISTINCT FROM b.target_courier_id;
CREATE UNIQUE INDEX IF NOT EXISTS reviews_order_user_uniq ON reviews(order_id, user_id) WHERE target_courier_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS reviews_order_user_courier_uniq ON reviews(order_id, user_id, target_courier_id) WHERE target_courier_id IS NOT NULL;

-- E13.T2: כתובות שמורות של לקוח (בחירה מהירה בצ׳ק-אאוט)
CREATE TABLE IF NOT EXISTS user_addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label text NOT NULL DEFAULT 'בית',
  address text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS user_addresses_user_idx ON user_addresses(user_id);

-- E14.T1: עגלה בענן (רשומה אחת לכל משתמש)
CREATE TABLE IF NOT EXISTS user_carts (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  items jsonb NOT NULL DEFAULT '[]',
  updated_at timestamptz NOT NULL DEFAULT now()
);
