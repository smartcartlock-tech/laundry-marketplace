-- T97: one ledger entry per newly issued demo marketplace document; no history rewrite.
CREATE TABLE bk_order_document_entries (
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 document_id uuid NOT NULL REFERENCES documents(id),
 entry_id uuid NOT NULL REFERENCES bk_entries(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,document_id), UNIQUE(entry_id)
);
