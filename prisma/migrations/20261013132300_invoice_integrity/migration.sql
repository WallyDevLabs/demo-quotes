-- Invoice and payment integrity (PRD "Document integrity"). The service layer enforces each rule
-- first; these constraints and triggers make the database refuse the same things on its own.

-- A milestone is invoiced once. A cancelled invoice frees it to be invoiced again.
CREATE UNIQUE INDEX "Invoice_active_milestone_key"
  ON "Invoice" ("milestoneId")
  WHERE "milestoneId" IS NOT NULL AND "status" <> 'CANCELLED';

-- A document has a number as soon as it leaves draft, and its parts always add up.
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_number_when_issued"
  CHECK ("status" = 'DRAFT' OR "number" IS NOT NULL);
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_totals_add_up"
  CHECK ("subtotalCents" >= 0 AND "discountCents" >= 0 AND "totalCents" >= 0
         AND "totalCents" = "subtotalCents" - "discountCents" + "vatCents");
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_number_when_sent"
  CHECK ("status" = 'DRAFT' OR "number" IS NOT NULL);
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_totals_add_up"
  CHECK ("totalCents" = "subtotalCents" - "discountCents" + "vatCents");
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_amount_not_negative" CHECK ("amountCents" >= 0);
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_amount_positive" CHECK ("amountCents" > 0);

-- ---------------------------------------------------------------------------------------------
-- Invoices: frozen once issued. Only a cancellation (with a reason, and no active payments) is allowed.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION invoice_guard() RETURNS trigger AS $$
DECLARE
  open_cols text[] := ARRAY['status', 'cancelledAt', 'cancelReason', 'updatedAt'];
  active_payments integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" <> 'DRAFT' THEN
      RAISE EXCEPTION 'Invoice % is issued and cannot be deleted', OLD."id";
    END IF;
    RETURN OLD;
  END IF;

  IF OLD."status" = 'DRAFT' THEN
    RETURN NEW;
  END IF;

  IF (to_jsonb(NEW) - open_cols) IS DISTINCT FROM (to_jsonb(OLD) - open_cols) THEN
    RAISE EXCEPTION 'Invoice % is frozen: its content cannot be changed', OLD."id";
  END IF;

  IF OLD."status" = 'CANCELLED'
     AND (to_jsonb(NEW) - 'updatedAt') IS DISTINCT FROM (to_jsonb(OLD) - 'updatedAt') THEN
    RAISE EXCEPTION 'Invoice % is cancelled and final', OLD."id";
  END IF;

  IF NEW."status" <> OLD."status" THEN
    IF NOT (OLD."status" = 'ISSUED' AND NEW."status" = 'CANCELLED') THEN
      RAISE EXCEPTION 'Invalid invoice status change % to %', OLD."status", NEW."status";
    END IF;
    IF NEW."cancelReason" IS NULL OR btrim(NEW."cancelReason") = '' THEN
      RAISE EXCEPTION 'A reason is required to cancel an invoice';
    END IF;
    SELECT count(*) INTO active_payments
      FROM "Payment" p
     WHERE p."invoiceId" = OLD."id"
       AND p."reversesPaymentId" IS NULL
       AND NOT EXISTS (SELECT 1 FROM "Payment" r WHERE r."reversesPaymentId" = p."id");
    IF active_payments > 0 THEN
      RAISE EXCEPTION 'Invoice % has payments and cannot be cancelled', OLD."id";
    END IF;
  ELSIF NEW."cancelledAt" IS DISTINCT FROM OLD."cancelledAt"
        OR NEW."cancelReason" IS DISTINCT FROM OLD."cancelReason" THEN
    RAISE EXCEPTION 'Cancellation details can only be set when cancelling';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER invoice_guard
  BEFORE UPDATE OR DELETE ON "Invoice"
  FOR EACH ROW EXECUTE FUNCTION invoice_guard();

-- ---------------------------------------------------------------------------------------------
-- The invoicing ceiling: the invoices of a quotation (not cancelled) never exceed its accepted total.
-- The quotation row is locked, so two invoices created at the same moment cannot both fit.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION invoice_ceiling_guard() RETURNS trigger AS $$
DECLARE
  q RECORD;
  others bigint;
BEGIN
  IF NEW."quotationId" IS NULL OR NEW."status" = 'CANCELLED' THEN
    RETURN NEW;
  END IF;

  SELECT "status", "totalCents", "currency" INTO q
    FROM "Quotation" WHERE "id" = NEW."quotationId" FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quotation not found for invoice';
  END IF;
  IF q."status" <> 'ACCEPTED' THEN
    RAISE EXCEPTION 'Invoices can only be created from an accepted quotation';
  END IF;
  IF q."currency" <> NEW."currency" THEN
    RAISE EXCEPTION 'An invoice must be in the same currency as its quotation';
  END IF;

  SELECT COALESCE(SUM("totalCents"), 0) INTO others
    FROM "Invoice"
   WHERE "quotationId" = NEW."quotationId" AND "status" <> 'CANCELLED' AND "id" <> NEW."id";
  IF others + NEW."totalCents" > q."totalCents" THEN
    RAISE EXCEPTION 'Invoices for quotation % would exceed its accepted total', NEW."quotationId";
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER invoice_ceiling_guard
  BEFORE INSERT OR UPDATE ON "Invoice"
  FOR EACH ROW EXECUTE FUNCTION invoice_ceiling_guard();

-- Lines are part of the invoice: frozen with it.
CREATE OR REPLACE FUNCTION invoice_child_guard() RETURNS trigger AS $$
DECLARE
  iid text;
  st "InvoiceStatus";
BEGIN
  IF TG_OP = 'DELETE' THEN iid := OLD."invoiceId"; ELSE iid := NEW."invoiceId"; END IF;
  SELECT "status" INTO st FROM "Invoice" WHERE "id" = iid;
  IF st IS NOT NULL AND st <> 'DRAFT' THEN
    RAISE EXCEPTION 'Invoice % is frozen: its lines cannot be changed', iid;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER invoice_line_guard
  BEFORE INSERT OR UPDATE OR DELETE ON "InvoiceLine"
  FOR EACH ROW EXECUTE FUNCTION invoice_child_guard();

-- ---------------------------------------------------------------------------------------------
-- Payments: append only. Recorded only against issued invoices, never above the balance.
-- A reversal is a new row that points at the original and restores the balance.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION payment_guard() RETURNS trigger AS $$
DECLARE
  inv RECORD;
  orig RECORD;
  paid bigint;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    RAISE EXCEPTION 'Payments are append only: they cannot be changed or deleted';
  END IF;

  SELECT "status", "totalCents" INTO inv FROM "Invoice" WHERE "id" = NEW."invoiceId" FOR UPDATE;
  IF NOT FOUND OR inv."status" <> 'ISSUED' THEN
    RAISE EXCEPTION 'Payments can only be recorded against issued invoices';
  END IF;

  IF NEW."reversesPaymentId" IS NULL THEN
    SELECT COALESCE(SUM(CASE WHEN "reversesPaymentId" IS NULL THEN "amountCents" ELSE -"amountCents" END), 0)
      INTO paid FROM "Payment" WHERE "invoiceId" = NEW."invoiceId";
    IF NEW."amountCents" > inv."totalCents" - paid THEN
      RAISE EXCEPTION 'Payment exceeds the outstanding balance';
    END IF;
  ELSE
    SELECT "invoiceId", "amountCents", "reversesPaymentId" INTO orig
      FROM "Payment" WHERE "id" = NEW."reversesPaymentId";
    IF NOT FOUND OR orig."invoiceId" <> NEW."invoiceId"
       OR orig."reversesPaymentId" IS NOT NULL OR orig."amountCents" <> NEW."amountCents" THEN
      RAISE EXCEPTION 'Invalid payment reversal';
    END IF;
    IF NEW."reversalReason" IS NULL OR btrim(NEW."reversalReason") = '' THEN
      RAISE EXCEPTION 'A reason is required to reverse a payment';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payment_guard
  BEFORE INSERT OR UPDATE OR DELETE ON "Payment"
  FOR EACH ROW EXECUTE FUNCTION payment_guard();
