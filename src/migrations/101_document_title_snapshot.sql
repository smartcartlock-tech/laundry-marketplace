-- Preserve the issued title. Existing documents keep their original legacy title.
ALTER TABLE documents ADD COLUMN title_he text;
CREATE FUNCTION document_title_immutable() RETURNS trigger AS $$
BEGIN
 IF NEW.title_he IS DISTINCT FROM OLD.title_he THEN RAISE EXCEPTION 'document title is immutable'; END IF;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER document_title_immutable BEFORE UPDATE ON documents FOR EACH ROW EXECUTE FUNCTION document_title_immutable();
