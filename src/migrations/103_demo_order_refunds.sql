-- T98: demo refund evidence, never a payout instruction or provider request.
ALTER TABLE orders ADD COLUMN demo_refunded_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK(demo_refunded_amount>=0);
CREATE TABLE demo_document_refunds (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 order_id uuid REFERENCES orders(id),
 source_receipt_id uuid NOT NULL REFERENCES documents(id),
 credit_id uuid NOT NULL UNIQUE REFERENCES documents(id),
 amount numeric(12,2) NOT NULL CHECK(amount>0),
 status text NOT NULL DEFAULT 'simulated' CHECK(status='simulated'),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX demo_document_refunds_order ON demo_document_refunds(tenant_id,order_id);
