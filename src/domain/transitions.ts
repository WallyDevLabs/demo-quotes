import type { CalendarDate } from "./dates";
import { DomainError } from "./errors";
import { deriveQuotationStatus, type StoredInvoiceStatus, type StoredQuotationStatus } from "./status";

/** QUO2. Only drafts are editable; changing a sent quotation means duplicating it as a draft. */
const QUOTATION_MOVES: Record<StoredQuotationStatus, readonly StoredQuotationStatus[]> = {
  draft: ["sent"],
  sent: ["accepted", "rejected", "expired"],
  accepted: [],
  rejected: [],
  expired: [],
};

/** INV5/INV6. Paid, partially paid and overdue are derived, so they are not moves. */
const INVOICE_MOVES: Record<StoredInvoiceStatus, readonly StoredInvoiceStatus[]> = {
  draft: ["issued"],
  issued: ["cancelled"],
  cancelled: [],
};

export function canMoveQuotation(from: StoredQuotationStatus, to: StoredQuotationStatus): boolean {
  return QUOTATION_MOVES[from].includes(to);
}

export function canMoveInvoice(from: StoredInvoiceStatus, to: StoredInvoiceStatus): boolean {
  return INVOICE_MOVES[from].includes(to);
}

export function assertQuotationMove(
  from: StoredQuotationStatus,
  to: StoredQuotationStatus,
  ctx: { expiryDate: CalendarDate; today: CalendarDate },
): void {
  if (to === "accepted" && deriveQuotationStatus(from, ctx.expiryDate, ctx.today) === "expired") {
    throw new DomainError("QUOTATION_EXPIRED", "An expired quotation cannot be accepted; duplicate it with a new expiry date");
  }
  if (!canMoveQuotation(from, to)) {
    throw new DomainError("INVALID_TRANSITION", `A ${from} quotation cannot become ${to}`);
  }
}

export function assertInvoiceMove(
  from: StoredInvoiceStatus,
  to: StoredInvoiceStatus,
  ctx: { paymentCount: number; reason?: string },
): void {
  if (!canMoveInvoice(from, to)) {
    throw new DomainError("INVALID_TRANSITION", `A ${from} invoice cannot become ${to}`);
  }
  if (to === "cancelled") {
    if (ctx.paymentCount > 0) {
      throw new DomainError("INVOICE_HAS_PAYMENTS", "An invoice with payments cannot be cancelled; a credit note is needed (phase two)");
    }
    if (!ctx.reason?.trim()) throw new DomainError("REASON_REQUIRED", "A reason is required to cancel an invoice");
  }
}

/** Only drafts may be edited (QUO2, INV6). */
export function isEditable(status: StoredQuotationStatus | StoredInvoiceStatus): boolean {
  return status === "draft";
}
