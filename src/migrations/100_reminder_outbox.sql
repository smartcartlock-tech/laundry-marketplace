-- T84: internal inbox only. No external delivery transport.
CREATE TABLE reminder_outbox (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('order_ready','pickup_tomorrow','courier')),
 payload jsonb NOT NULL DEFAULT '{}',
 scheduled_at timestamptz NOT NULL,
 delivered_at timestamptz,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','delivered','cancelled')),
 idempotency_key text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,idempotency_key)
);
CREATE INDEX reminder_due_idx ON reminder_outbox(tenant_id,scheduled_at) WHERE status='pending';
