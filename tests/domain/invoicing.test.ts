import { describe, expect, it } from "vitest";
import { DomainError } from "@/domain/errors";
import {
  activePayments,
  assertCanRecordPayment,
  assertCanReverse,
  assertWithinCeiling,
  bankingIsComplete,
  buildInvoiceDocument,
  customInvoiceContent,
  invoiceDocumentText,
  invoicedCents,
  isReversed,
  milestoneInvoiceContent,
  paidCents,
  remainingToInvoice,
  type InvoiceDocInput,
  type PaymentEntry,
} from "@/domain/invoicing";
import { buildPaymentSchedule } from "@/domain/quotation";
import { deriveInvoiceStatus } from "@/domain/status";

const code = (fn: () => void) => {
  try {
    fn();
  } catch (e) {
    return e instanceof DomainError ? e.code : "OTHER";
  }
  return null;
};

describe("invoicing ceiling (INV2)", () => {
  const inv = (totalCents: number, status: "draft" | "issued" | "cancelled" = "issued") => ({ totalCents, status });

  it("counts draft and issued invoices, not cancelled ones", () => {
    expect(invoicedCents([inv(100), inv(50, "draft"), inv(999, "cancelled")])).toBe(150);
    expect(remainingToInvoice(1000, [inv(100), inv(999, "cancelled")])).toBe(900);
  });

  it("allows up to exactly the accepted total and rejects one cent more", () => {
    expect(code(() => assertWithinCeiling(1000, [inv(600)], 400))).toBeNull();
    expect(code(() => assertWithinCeiling(1000, [inv(600)], 401))).toBe("OVER_INVOICED");
    expect(code(() => assertWithinCeiling(1000, [], 1001))).toBe("OVER_INVOICED");
  });

  it("frees the amount when an invoice is cancelled", () => {
    expect(code(() => assertWithinCeiling(1000, [inv(600, "cancelled")], 1000))).toBeNull();
  });

  it("rejects zero and negative amounts", () => {
    expect(code(() => assertWithinCeiling(1000, [], 0))).toBe("INVALID_AMOUNT");
    expect(code(() => assertWithinCeiling(1000, [], -5))).toBe("INVALID_AMOUNT");
  });

  it("milestone invoices of a quotation add up to its total to the cent", () => {
    const total = 3_706_900;
    const schedule = buildPaymentSchedule(total, [{ label: "A", percent: "33.33" }, { label: "B", percent: "33.33" }, { label: "C", percent: "33.34" }]);
    const invoices = schedule.map((m) => ({ totalCents: m.amountCents, status: "issued" as const }));
    expect(remainingToInvoice(total, invoices)).toBe(0);
    for (const m of schedule) {
      expect(milestoneInvoiceContent({ label: m.label, percent: m.percent, amountCents: m.amountCents, quotationNumber: "Q1", quotationTitle: "" }).totalCents).toBe(m.amountCents);
    }
  });
});

describe("payment balances (PAY2, PAY3)", () => {
  const p = (id: string, amountCents: number, reversesPaymentId: string | null = null): PaymentEntry => ({ id, amountCents, reversesPaymentId });

  it("sums payments and subtracts reversals", () => {
    expect(paidCents([])).toBe(0);
    expect(paidCents([p("a", 400), p("b", 100)])).toBe(500);
    expect(paidCents([p("a", 400), p("b", 100), p("r", 100, "b")])).toBe(400);
    expect(paidCents([p("a", 400), p("r", 400, "a")])).toBe(0);
  });

  it("knows which payments are still active", () => {
    const e = [p("a", 400), p("b", 100), p("r", 100, "b")];
    expect(isReversed(e, "b")).toBe(true);
    expect(isReversed(e, "a")).toBe(false);
    expect(activePayments(e).map((x) => x.id)).toEqual(["a"]);
  });

  const base = { stored: "issued" as const, totalCents: 1000, entries: [] as PaymentEntry[], amountCents: 500, receivedOn: "2026-10-13", today: "2026-10-13" };

  it("accepts partial and final payments up to the balance", () => {
    expect(code(() => assertCanRecordPayment(base))).toBeNull();
    expect(code(() => assertCanRecordPayment({ ...base, entries: [p("a", 600)], amountCents: 400 }))).toBeNull();
  });

  it("rejects overpayment, including by one cent", () => {
    expect(code(() => assertCanRecordPayment({ ...base, amountCents: 1001 }))).toBe("OVERPAYMENT");
    expect(code(() => assertCanRecordPayment({ ...base, entries: [p("a", 600)], amountCents: 401 }))).toBe("OVERPAYMENT");
    expect(code(() => assertCanRecordPayment({ ...base, entries: [p("a", 1000)], amountCents: 1 }))).toBe("OVERPAYMENT");
  });

  it("a reversal restores the balance for new payments", () => {
    const entries = [p("a", 1000), p("r", 1000, "a")];
    expect(code(() => assertCanRecordPayment({ ...base, entries, amountCents: 1000 }))).toBeNull();
  });

  it("rejects payments on drafts and cancelled invoices (PAY4)", () => {
    expect(code(() => assertCanRecordPayment({ ...base, stored: "draft" }))).toBe("NOT_PAYABLE");
    expect(code(() => assertCanRecordPayment({ ...base, stored: "cancelled" }))).toBe("NOT_PAYABLE");
  });

  it("rejects zero, negative, fractional and future-dated payments", () => {
    expect(code(() => assertCanRecordPayment({ ...base, amountCents: 0 }))).toBe("INVALID_AMOUNT");
    expect(code(() => assertCanRecordPayment({ ...base, amountCents: -1 }))).toBe("INVALID_AMOUNT");
    expect(code(() => assertCanRecordPayment({ ...base, amountCents: 10.5 }))).toBe("INVALID_AMOUNT");
    expect(code(() => assertCanRecordPayment({ ...base, receivedOn: "2026-10-14" }))).toBe("INVALID_DATE");
    expect(code(() => assertCanRecordPayment({ ...base, receivedOn: "nope" }))).toBe("INVALID_DATE");
    expect(code(() => assertCanRecordPayment({ ...base, receivedOn: "2026-09-01" }))).toBeNull();
  });

  it("allows one reversal with a reason, and never a reversal of a reversal", () => {
    const e = [p("a", 400), p("b", 100)];
    expect(code(() => assertCanReverse(e, "a", "Wrong invoice"))).toBeNull();
    expect(code(() => assertCanReverse(e, "a", "  "))).toBe("REASON_REQUIRED");
    expect(code(() => assertCanReverse(e, "a", undefined))).toBe("REASON_REQUIRED");
    expect(code(() => assertCanReverse(e, "zzz", "x"))).toBe("NOT_REVERSIBLE");
    const reversed = [...e, p("r", 100, "b")];
    expect(code(() => assertCanReverse(reversed, "b", "again"))).toBe("NOT_REVERSIBLE");
    expect(code(() => assertCanReverse(reversed, "r", "undo the undo"))).toBe("NOT_REVERSIBLE");
  });

  it("status follows the payments, and a reversal restores it", () => {
    const status = (entries: PaymentEntry[], today = "2026-10-13") =>
      deriveInvoiceStatus({ stored: "issued", totalCents: 1000, paidCents: paidCents(entries), dueDate: "2026-10-20", today }).status;
    expect(status([])).toBe("issued");
    expect(status([p("a", 400)])).toBe("partially_paid");
    expect(status([p("a", 400), p("b", 600)])).toBe("paid");
    expect(status([p("a", 400), p("b", 600), p("r", 600, "b")])).toBe("partially_paid");
    expect(status([p("a", 400), p("r", 400, "a")])).toBe("issued");
    expect(status([p("a", 400)], "2026-10-20")).toBe("partially_paid"); // due today: not overdue
    expect(status([p("a", 400)], "2026-10-21")).toBe("overdue");
    expect(status([p("a", 1000)], "2026-10-21")).toBe("paid");
  });
});

describe("invoice content (INV1)", () => {
  it("a milestone invoice is one line with the quotation reference", () => {
    const c = milestoneInvoiceContent({ label: "Deposit", percent: "50.00", amountCents: 1_853_450, quotationNumber: "QUO20260001", quotationTitle: "Phase 1" });
    expect(c.lines).toEqual([{ description: "Deposit (50.00%): Phase 1", detail: "Quotation QUO20260001", amountCents: 1_853_450 }]);
    expect(c.totalCents).toBe(1_853_450);
    expect(c.discountCents).toBe(0);
  });

  it("a custom invoice needs a reason and positive lines", () => {
    expect(customInvoiceContent("Extra hosting setup", [{ description: "Setup", amountCents: 50_000 }, { description: "Domain", amountCents: 25_000 }], "Q1").totalCents).toBe(75_000);
    expect(code(() => customInvoiceContent("", [{ description: "x", amountCents: 1 }], "Q1"))).toBe("REASON_REQUIRED");
    expect(code(() => customInvoiceContent("why", [], "Q1"))).toBe("INVALID_INVOICE");
    expect(code(() => customInvoiceContent("why", [{ description: " ", amountCents: 1 }], "Q1"))).toBe("INVALID_INVOICE");
    expect(code(() => customInvoiceContent("why", [{ description: "x", amountCents: 0 }], "Q1"))).toBe("INVALID_AMOUNT");
  });

  it("banking is complete only with a bank and an account number", () => {
    const b = { bankName: "FNB", accountName: "K B", accountNumber: "123", branchCode: "", swiftCode: "", accountType: "", instructions: "" };
    expect(bankingIsComplete(b)).toBe(true);
    expect(bankingIsComplete({ ...b, accountNumber: "" })).toBe(false);
    expect(bankingIsComplete({ ...b, bankName: " " })).toBe(false);
  });
});

describe("invoice document (INV4, VAT off)", () => {
  const input: InvoiceDocInput = {
    number: "INV20260001",
    issueDate: "2026-10-13",
    dueDate: "2026-10-27",
    currency: "ZAR",
    business: { legalName: "Katlego Barayi", tradingName: null, registrationNumber: null, address: "1 Main Rd", email: "k@example.com", phone: "", logoFileId: null },
    client: { name: "Thabo", companyName: "Acme (Pty) Ltd", contactPerson: "Thabo", email: null, phone: null, address: null, registrationNumber: null },
    projectName: "Dispatch app",
    quotationNumber: "QUO20260001",
    content: milestoneInvoiceContent({ label: "Deposit", percent: "50.00", amountCents: 1_853_450, quotationNumber: "QUO20260001", quotationTitle: "" }),
    paidCents: 0,
    banking: { bankName: "FNB", accountName: "Katlego Barayi", accountNumber: "62000000000", branchCode: "250655", swiftCode: "", accountType: "Cheque", instructions: "Use the reference below." },
    paymentReference: "INV20260001",
  };

  it("is titled Invoice with dates, lines, total, paid, balance, banking and a payment reference", () => {
    const d = buildInvoiceDocument(input);
    expect(d.title).toBe("Invoice");
    expect(d.number).toBe("INV20260001");
    expect(d.invoiceDate).toBe("2026-10-13");
    expect(d.dueDate).toBe("2026-10-27");
    expect(d.totals).toEqual({ subtotal: "R18 534.50", discount: null, total: "R18 534.50", paid: "R0.00", balance: "R18 534.50" });
    expect(d.banking.lines).toContain("Account number: 62000000000");
    expect(d.banking.reference).toBe("INV20260001");
    expect(d.reference).toBe("Quotation QUO20260001");
  });

  it("shows the current balance after payments", () => {
    const d = buildInvoiceDocument({ ...input, paidCents: 853_450 });
    expect(d.totals.paid).toBe("R8 534.50");
    expect(d.totals.balance).toBe("R10 000.00");
  });

  it("never mentions VAT, tax, or a tax invoice", () => {
    const text = invoiceDocumentText(buildInvoiceDocument(input));
    expect(text).not.toMatch(/vat/i);
    expect(text).not.toMatch(/tax/i);
  });

  it("marks a draft and formats USD without converting", () => {
    expect(buildInvoiceDocument({ ...input, number: null, issueDate: null, dueDate: null }).isDraft).toBe(true);
    expect(buildInvoiceDocument({ ...input, currency: "USD" }).totals.total).toBe("US$18 534.50");
  });
});
