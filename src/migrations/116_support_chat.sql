-- T83: צ'אט תמיכה לקוח-מכבסה בתוך האפליקציה, עם צפיית אדמין מתועדת.
-- tenant_id בשתי הטבלאות לבידוד טנאנטים; admin_viewed_at מתעד "צפיית מנהל" (שקיפות לצדדים).
CREATE TABLE IF NOT EXISTS support_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  admin_viewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS support_threads_tenant_idx ON support_threads(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS support_threads_customer_idx ON support_threads(customer_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS support_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES support_threads(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sender_role text NOT NULL CHECK (sender_role IN ('customer','laundry')),
  body text NOT NULL,
  read_at timestamptz,
  ts timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS support_messages_thread_idx ON support_messages(thread_id, ts);
CREATE INDEX IF NOT EXISTS support_messages_tenant_idx ON support_messages(tenant_id, ts);
