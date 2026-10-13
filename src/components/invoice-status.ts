/** Plain constants, deliberately not a "use client" module so server components can import them. */
export const INVOICE_TONE = { draft: "neutral", issued: "primary", partially_paid: "caution", paid: "profit", overdue: "cost", cancelled: "neutral" } as const;
export const INVOICE_LABEL = { draft: "Draft", issued: "Issued", partially_paid: "Partially paid", paid: "Paid", overdue: "Overdue", cancelled: "Cancelled" } as const;
