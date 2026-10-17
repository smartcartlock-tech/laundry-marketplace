-- T85: איסוף קבוע לצרכן — מנוי איסוף חוזר (שבועי/דו-שבועי) ללקוח פרטי בטנאנט.
CREATE TABLE IF NOT EXISTS consumer_pickup_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  frequency text NOT NULL DEFAULT 'weekly' CHECK (frequency IN ('weekly','biweekly')),
  weekday int NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  pickup_time text,
  address text NOT NULL,
  items jsonb NOT NULL DEFAULT '[]',
  active boolean NOT NULL DEFAULT true,
  anchor_date date,
  last_run_on date,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS consumer_pickup_subs_tenant_idx ON consumer_pickup_subscriptions(tenant_id);
CREATE INDEX IF NOT EXISTS consumer_pickup_subs_user_idx ON consumer_pickup_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS consumer_pickup_subs_due_idx ON consumer_pickup_subscriptions(active, weekday);
