/** Plain constants, deliberately not a "use client" module so server components can import them. */
export const STATUS_TONE = { draft: "neutral", sent: "primary", accepted: "profit", rejected: "cost", expired: "caution" } as const;
export const STATUS_LABEL = { draft: "Draft", sent: "Sent", accepted: "Accepted", rejected: "Rejected", expired: "Expired" } as const;
