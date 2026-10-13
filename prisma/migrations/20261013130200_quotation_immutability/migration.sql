-- Document integrity (PRD "Immutability"): once a quotation leaves DRAFT it is a record.
-- The service layer rejects edits first; these triggers make the database refuse them too.

CREATE OR REPLACE FUNCTION quotation_guard() RETURNS trigger AS $$
DECLARE
  open_cols text[] := ARRAY['status','acceptedAt','acceptedBy','rejectedAt','rejectionReason','updatedAt','estimateId'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" <> 'DRAFT' THEN
      RAISE EXCEPTION 'Quotation % is frozen and cannot be deleted', OLD."id";
    END IF;
    RETURN OLD;
  END IF;

  IF OLD."status" = 'DRAFT' THEN
    RETURN NEW;
  END IF;

  -- Sent and later: only the status and the acceptance/rejection details may change.
  IF (to_jsonb(NEW) - open_cols) IS DISTINCT FROM (to_jsonb(OLD) - open_cols) THEN
    RAISE EXCEPTION 'Quotation % is frozen: its content cannot be changed', OLD."id";
  END IF;

  IF NEW."status" <> OLD."status"
     AND NOT (OLD."status" = 'SENT' AND NEW."status" IN ('ACCEPTED', 'REJECTED', 'EXPIRED')) THEN
    RAISE EXCEPTION 'Invalid quotation status change % to %', OLD."status", NEW."status";
  END IF;

  -- Accepted, rejected and expired quotations are final.
  IF OLD."status" <> 'SENT'
     AND (to_jsonb(NEW) - 'updatedAt' - 'estimateId') IS DISTINCT FROM (to_jsonb(OLD) - 'updatedAt' - 'estimateId') THEN
    RAISE EXCEPTION 'Quotation % is final and cannot be changed', OLD."id";
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER quotation_guard
  BEFORE UPDATE OR DELETE ON "Quotation"
  FOR EACH ROW EXECUTE FUNCTION quotation_guard();

CREATE OR REPLACE FUNCTION quotation_child_guard() RETURNS trigger AS $$
DECLARE
  qid text;
  st "QuotationStatus";
BEGIN
  IF TG_OP = 'DELETE' THEN qid := OLD."quotationId"; ELSE qid := NEW."quotationId"; END IF;
  SELECT "status" INTO st FROM "Quotation" WHERE "id" = qid;
  IF st IS NOT NULL AND st <> 'DRAFT' THEN
    RAISE EXCEPTION 'Quotation % is frozen: its lines and milestones cannot be changed', qid;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER quotation_line_guard
  BEFORE INSERT OR UPDATE OR DELETE ON "QuotationLine"
  FOR EACH ROW EXECUTE FUNCTION quotation_child_guard();

CREATE TRIGGER quotation_milestone_guard
  BEFORE INSERT OR UPDATE OR DELETE ON "QuotationMilestone"
  FOR EACH ROW EXECUTE FUNCTION quotation_child_guard();

-- A stored PDF is served exactly as it was made (PRD "Stored PDFs").
CREATE OR REPLACE FUNCTION stored_document_guard() RETURNS trigger AS $$
BEGIN
  IF OLD."kind" IN ('QUOTATION_PDF', 'INVOICE_PDF') THEN
    RAISE EXCEPTION 'Stored documents are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER stored_document_guard
  BEFORE UPDATE OR DELETE ON "StoredFile"
  FOR EACH ROW EXECUTE FUNCTION stored_document_guard();
