-- T40/T2: linked payments and full credit notes, never mutate issued source amounts.
ALTER TABLE bk_documents ADD COLUMN IF NOT EXISTS source_document_id uuid REFERENCES bk_documents(id);
ALTER TABLE bk_documents DROP CONSTRAINT IF EXISTS bk_documents_kind_check;
ALTER TABLE bk_documents ADD CONSTRAINT bk_documents_kind_check CHECK (kind IN ('tax_invoice','tax_invoice_receipt','invoice','receipt','credit_note'));
CREATE INDEX IF NOT EXISTS bk_documents_source_idx ON bk_documents(tenant_id,source_document_id);
CREATE UNIQUE INDEX IF NOT EXISTS bk_one_issued_credit ON bk_documents(tenant_id,source_document_id) WHERE kind='credit_note' AND status='issued';
