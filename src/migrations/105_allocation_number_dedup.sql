-- T100: enforce one manual allocation number per tenant across both document surfaces.
-- Existing records are not rewritten; a later attempt to reuse a legacy number is rejected.
CREATE FUNCTION reject_duplicate_allocation() RETURNS trigger AS $$
BEGIN
 IF NEW.allocation_number IS NULL THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND NEW.allocation_number IS NOT DISTINCT FROM OLD.allocation_number THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('allocation:'||NEW.tenant_id::text));
 IF EXISTS(SELECT 1 FROM documents d WHERE d.tenant_id=NEW.tenant_id AND d.allocation_number=NEW.allocation_number AND (TG_TABLE_NAME<>'documents' OR d.id<>NEW.id))
 OR EXISTS(SELECT 1 FROM bk_documents d WHERE d.tenant_id=NEW.tenant_id AND d.allocation_number=NEW.allocation_number AND (TG_TABLE_NAME<>'bk_documents' OR d.id<>NEW.id)) THEN
  RAISE EXCEPTION 'allocation number already in use for tenant' USING ERRCODE='23505';
 END IF;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER documents_allocation_unique BEFORE INSERT OR UPDATE OF allocation_number ON documents FOR EACH ROW EXECUTE FUNCTION reject_duplicate_allocation();
CREATE TRIGGER bk_documents_allocation_unique BEFORE INSERT OR UPDATE OF allocation_number ON bk_documents FOR EACH ROW EXECUTE FUNCTION reject_duplicate_allocation();
