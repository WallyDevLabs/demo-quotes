import { compareDates, isCalendarDate, type CalendarDate } from "./dates";
import { DomainError } from "./errors";
import { formatMoney, type Cents, type Currency } from "./money";
import type { BusinessSnapshot, ClientSnapshot } from "./quotation";
import type { StoredInvoiceStatus } from "./status";

// ---------------------------------------------------------------------------------------------
// Invoicing ceiling (INV2)
// ---------------------------------------------------------------------------------------------

export interface InvoiceTotal {
  totalCents: Cents;
  status: StoredInvoiceStatus;
}

/** Draft and issued invoices count against the accepted total; cancelled ones do not. */
export function invoicedCents(invoices: InvoiceTotal[]): Cents {
  return invoices.filter((i) => i.status !== "cancelled").reduce((s, i) => s + i.totalCents, 0);
}

export function remainingToInvoice(quotationTotalCents: Cents, invoices: InvoiceTotal[]): Cents {
  return quotationTotalCents - invoicedCents(invoices);
}

/** The total of all non-cancelled invoices for a quotation can never exceed its accepted total. */
export function assertWithinCeiling(quotationTotalCents: Cents, existing: InvoiceTotal[], newAmountCents: Cents, currency: Currency = "ZAR"): void {
  if (!Number.isSafeInteger(newAmountCents) || newAmountCents <= 0) {
    throw new DomainError("INVALID_AMOUNT", "An invoice amount must be above zero");
  }
  const remaining = remainingToInvoice(quotationTotalCents, existing);
  if (newAmountCents > remaining) {
    throw new DomainError(
      "OVER_INVOICED",
      `That is ${formatMoney(newAmountCents - remaining, currency)} more than can still be invoiced on this quotation (remaining: ${formatMoney(remaining, currency)}).`,
    );
  }
}

// ---------------------------------------------------------------------------------------------
// Payments (PAY1 to PAY5): append only, with reversal
// ---------------------------------------------------------------------------------------------

export interface PaymentEntry {
  id: string;
  /** Always positive. For a reversal it equals the original. */
  amountCents: Cents;
  /** Set on a reversal row: the payment it undoes. */
  reversesPaymentId: string | null;
}

/** Original payments minus reversals. */
export function paidCents(entries: PaymentEntry[]): Cents {
  return entries.reduce((s, e) => s + (e.reversesPaymentId ? -e.amountCents : e.amountCents), 0);
}

export function isReversed(entries: PaymentEntry[], paymentId: string): boolean {
  return entries.some((e) => e.reversesPaymentId === paymentId);
}

/** Original payments that have not been reversed. */
export function activePayments(entries: PaymentEntry[]): PaymentEntry[] {
  return entries.filter((e) => !e.reversesPaymentId && !isReversed(entries, e.id));
}

export interface RecordPaymentCheck {
  stored: StoredInvoiceStatus;
  totalCents: Cents;
  entries: PaymentEntry[];
  amountCents: Cents;
  receivedOn: CalendarDate;
  today: CalendarDate;
  currency?: Currency;
}

/** PAY2 and PAY4: only issued invoices are payable, and never above the outstanding balance. */
export function assertCanRecordPayment(c: RecordPaymentCheck): void {
  if (c.stored !== "issued") {
    throw new DomainError("NOT_PAYABLE", `Payments can only be recorded against issued invoices (this one is ${c.stored})`);
  }
  if (!Number.isSafeInteger(c.amountCents) || c.amountCents <= 0) {
    throw new DomainError("INVALID_AMOUNT", "A payment must be above zero");
  }
  if (!isCalendarDate(c.receivedOn)) throw new DomainError("INVALID_DATE", "Enter the date the money was received");
  if (compareDates(c.receivedOn, c.today) > 0) throw new DomainError("INVALID_DATE", "A payment cannot be dated in the future");
  const balance = c.totalCents - paidCents(c.entries);
  if (c.amountCents > balance) {
    throw new DomainError("OVERPAYMENT", `That is more than the outstanding balance of ${formatMoney(balance, c.currency ?? "ZAR")}.`);
  }
}

/** PAY3: a mistaken payment is reversed with a reason, once. Reversals themselves cannot be reversed. */
export function assertCanReverse(entries: PaymentEntry[], paymentId: string, reason: string | undefined): void {
  const p = entries.find((e) => e.id === paymentId);
  if (!p) throw new DomainError("NOT_REVERSIBLE", "Payment not found on this invoice");
  if (p.reversesPaymentId) throw new DomainError("NOT_REVERSIBLE", "A reversal cannot be reversed");
  if (isReversed(entries, paymentId)) throw new DomainError("NOT_REVERSIBLE", "This payment has already been reversed");
  if (!reason?.trim()) throw new DomainError("REASON_REQUIRED", "A reason is required to reverse a payment");
}

// ---------------------------------------------------------------------------------------------
// Invoice content (INV1)
// ---------------------------------------------------------------------------------------------

export interface InvoiceLineContent {
  description: string;
  detail: string;
  amountCents: Cents;
}

export interface InvoiceContent {
  lines: InvoiceLineContent[];
  subtotalCents: Cents;
  discountCents: Cents;
  totalCents: Cents;
}

/**
 * A milestone invoice is one line: the milestone's amount, which already includes any discount on
 * the quotation, so amounts across all milestone invoices add up to the accepted total exactly.
 */
export function milestoneInvoiceContent(m: {
  label: string;
  percent: string;
  amountCents: Cents;
  quotationNumber: string;
  quotationTitle: string;
}): InvoiceContent {
  if (m.amountCents <= 0) throw new DomainError("INVALID_AMOUNT", "This milestone has nothing to invoice");
  return {
    lines: [
      {
        description: `${m.label} (${m.percent}%)${m.quotationTitle ? `: ${m.quotationTitle}` : ""}`,
        detail: `Quotation ${m.quotationNumber}`,
        amountCents: m.amountCents,
      },
    ],
    subtotalCents: m.amountCents,
    discountCents: 0,
    totalCents: m.amountCents,
  };
}

/** A custom invoice states why it is not a milestone, and carries its own lines. */
export function customInvoiceContent(
  reason: string,
  lines: { description: string; amountCents: Cents }[],
  quotationNumber: string,
): InvoiceContent {
  if (!reason.trim()) throw new DomainError("REASON_REQUIRED", "A custom invoice needs a reason");
  if (lines.length === 0) throw new DomainError("INVALID_INVOICE", "Add at least one line");
  const out = lines.map((l) => {
    if (!l.description.trim()) throw new DomainError("INVALID_INVOICE", "Every line needs a description");
    if (!Number.isSafeInteger(l.amountCents) || l.amountCents <= 0) throw new DomainError("INVALID_AMOUNT", "Every line needs an amount above zero");
    return { description: l.description.trim(), detail: `Quotation ${quotationNumber}`, amountCents: l.amountCents };
  });
  const total = out.reduce((s, l) => s + l.amountCents, 0);
  return { lines: out, subtotalCents: total, discountCents: 0, totalCents: total };
}

// ---------------------------------------------------------------------------------------------
// The document model (INV4). VAT mode is NONE: the title is "Invoice" and no VAT line exists.
// ---------------------------------------------------------------------------------------------

export interface BankingSnapshot {
  bankName: string;
  accountName: string;
  accountNumber: string;
  branchCode: string;
  swiftCode: string;
  accountType: string;
  instructions: string;
}

export interface InvoiceDocInput {
  /** Null while it is a draft. */
  number: string | null;
  issueDate: CalendarDate | null;
  dueDate: CalendarDate | null;
  currency: Currency;
  business: BusinessSnapshot;
  client: ClientSnapshot;
  projectName: string;
  quotationNumber: string | null;
  content: InvoiceContent;
  paidCents: Cents;
  banking: BankingSnapshot;
  paymentReference: string | null;
}

export interface InvoiceDocument {
  title: "Invoice";
  number: string;
  isDraft: boolean;
  invoiceDate: string;
  dueDate: string;
  business: { name: string; lines: string[]; logoFileId: string | null };
  client: { name: string; lines: string[] };
  projectName: string;
  reference: string | null;
  lines: { description: string; detail: string; amount: string }[];
  totals: { subtotal: string; discount: string | null; total: string; paid: string; balance: string };
  banking: { lines: string[]; reference: string; instructions: string };
}

const compact = (xs: (string | null | undefined)[]) => xs.map((x) => x?.trim()).filter((x): x is string => !!x);

export function buildInvoiceDocument(i: InvoiceDocInput): InvoiceDocument {
  const money = (c: Cents) => formatMoney(c, i.currency);
  const b = i.business;
  const bank = i.banking;
  const balance = i.content.totalCents - i.paidCents;
  return {
    title: "Invoice",
    number: i.number ?? "Draft (no number yet)",
    isDraft: i.number === null,
    invoiceDate: i.issueDate ?? "Not yet issued",
    dueDate: i.dueDate ?? "Set when issued",
    business: {
      name: b.tradingName?.trim() ? `${b.tradingName} (${b.legalName})` : b.legalName,
      lines: compact([b.address, b.email, b.phone, b.registrationNumber ? `Reg. ${b.registrationNumber}` : null]),
      logoFileId: b.logoFileId,
    },
    client: {
      name: i.client.companyName?.trim() ? i.client.companyName : i.client.name,
      lines: compact([
        i.client.companyName?.trim() ? i.client.contactPerson || i.client.name : i.client.contactPerson,
        i.client.address,
        i.client.email,
        i.client.phone,
        i.client.registrationNumber ? `Reg. ${i.client.registrationNumber}` : null,
      ]),
    },
    projectName: i.projectName,
    reference: i.quotationNumber ? `Quotation ${i.quotationNumber}` : null,
    lines: i.content.lines.map((l) => ({ description: l.description, detail: l.detail, amount: money(l.amountCents) })),
    totals: {
      subtotal: money(i.content.subtotalCents),
      discount: i.content.discountCents > 0 ? money(i.content.discountCents) : null,
      total: money(i.content.totalCents),
      paid: money(i.paidCents),
      balance: money(balance),
    },
    banking: {
      lines: compact([
        bank.bankName && `Bank: ${bank.bankName}`,
        bank.accountName && `Account name: ${bank.accountName}`,
        bank.accountNumber && `Account number: ${bank.accountNumber}`,
        bank.branchCode && `Branch code: ${bank.branchCode}`,
        bank.accountType && `Account type: ${bank.accountType}`,
        bank.swiftCode && `SWIFT / BIC: ${bank.swiftCode}`,
      ]),
      reference: i.paymentReference ?? "Assigned when issued",
      instructions: bank.instructions,
    },
  };
}

export function invoiceDocumentText(d: InvoiceDocument): string {
  return JSON.stringify(d);
}

/** Banking details are needed before an invoice can be issued, so the client knows where to pay. */
export function bankingIsComplete(b: BankingSnapshot): boolean {
  return b.bankName.trim() !== "" && b.accountNumber.trim() !== "";
}
