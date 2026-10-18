CREATE TABLE subscription_document_charges (
 tenant_id uuid NOT NULL REFERENCES tenants(id), subscription_id uuid NOT NULL REFERENCES subscriptions(id),
 period_start date NOT NULL, invoice_id uuid NOT NULL REFERENCES documents(id), receipt_id uuid NOT NULL REFERENCES documents(id),
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,subscription_id,period_start)
);
CREATE TABLE business_fiscal_documents (
 tenant_id uuid NOT NULL REFERENCES tenants(id), account_id uuid NOT NULL REFERENCES business_accounts(id),
 year int NOT NULL, month int NOT NULL, document_id uuid NOT NULL UNIQUE REFERENCES documents(id),
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,account_id,year,month)
);
