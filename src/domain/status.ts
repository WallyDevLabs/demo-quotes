import { compareDates, type CalendarDate } from "./dates";
import { DomainError } from "./errors";
import type { Cents } from "./money";

export type StoredInvoiceStatus = "draft" | "issued" | "cancelled";
export type StoredQuotationStatus = "draft" | "sent" | "accepted" | "rejected" | "expired";

export type InvoiceDisplayStatus = "draft" | "issued" | "partially_paid" | "paid" | "overdue" | "cancelled";

export interface InvoiceStatusInput {
  stored: StoredInvoiceStatus;
  totalCents: Cents;
  /** Sum of payments minus reversals. */
  paidCents: Cents;
  dueDate: CalendarDate;
  today: CalendarDate;
}

export interface InvoiceStatusResult {
  status: InvoiceDisplayStatus;
  balanceCents: Cents;
  overdue: boolean;
  partiallyPaid: boolean;
}

/**
 * INV5: the one function that turns stored state plus payments and the calendar into the badge.
 * The UI, dashboard and tests all call it, so nothing derived is ever stored.
 *
 * - A zero balance is paid, even when the due date has passed.
 * - An invoice due today is not overdue; it becomes overdue the day after.
 * - Overdue takes precedence over partially paid for the badge; `partiallyPaid` stays available.
 */
export function deriveInvoiceStatus(i: InvoiceStatusInput): InvoiceStatusResult {
  if (i.paidCents < 0 || i.paidCents > i.totalCents) {
    throw new DomainError("INVALID_AMOUNT", "Paid amount must be between zero and the invoice total");
  }
  const balanceCents = i.totalCents - i.paidCents;
  if (i.stored === "draft" || i.stored === "cancelled") {
    return { status: i.stored, balanceCents, overdue: false, partiallyPaid: false };
  }
  if (balanceCents === 0) return { status: "paid", balanceCents, overdue: false, partiallyPaid: false };

  const overdue = compareDates(i.dueDate, i.today) < 0;
  const partiallyPaid = i.paidCents > 0;
  const status: InvoiceDisplayStatus = overdue ? "overdue" : partiallyPaid ? "partially_paid" : "issued";
  return { status, balanceCents, overdue, partiallyPaid };
}

/** QUO3: a sent quotation past its expiry date is expired without anyone updating it. */
export function deriveQuotationStatus(
  stored: StoredQuotationStatus,
  expiryDate: CalendarDate,
  today: CalendarDate,
): StoredQuotationStatus {
  return stored === "sent" && compareDates(expiryDate, today) < 0 ? "expired" : stored;
}
