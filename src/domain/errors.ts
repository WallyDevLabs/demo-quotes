export type DomainErrorCode =
  | "INVALID_TRANSITION"
  | "QUOTATION_EXPIRED"
  | "INVOICE_HAS_PAYMENTS"
  | "REASON_REQUIRED"
  | "INVALID_PERCENTAGES"
  | "INVALID_PATTERN"
  | "COUNTER_LOWERED"
  | "INVALID_AMOUNT"
  | "INVALID_DATE"
  | "OVER_INVOICED"
  | "OVERPAYMENT"
  | "NOT_PAYABLE"
  | "NOT_REVERSIBLE"
  | "INVALID_INVOICE";

/** A business rule was broken. Services map these to user-facing messages. */
export class DomainError extends Error {
  constructor(
    public readonly code: DomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}
