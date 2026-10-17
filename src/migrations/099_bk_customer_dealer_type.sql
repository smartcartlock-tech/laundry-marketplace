-- T44: explicit customer VAT registration classification, never infer from ID length.
ALTER TABLE bk_documents ADD COLUMN IF NOT EXISTS customer_dealer_type text CHECK (customer_dealer_type IN ('morasha','patur','private'));
