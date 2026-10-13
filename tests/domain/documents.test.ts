import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { addDays, compareDates, isCalendarDate, todayInJohannesburg } from "@/domain/dates";
import { DomainError } from "@/domain/errors";
import { splitByPercentages } from "@/domain/milestones";
import { formatZAR, pctOf } from "@/domain/money";
import { assertCounterNotLowered, formatDocumentNumber, validateNumberPattern } from "@/domain/numbering";
import { deriveInvoiceStatus, deriveQuotationStatus, type StoredInvoiceStatus, type StoredQuotationStatus } from "@/domain/status";
import {
  assertInvoiceMove,
  assertQuotationMove,
  canMoveInvoice,
  canMoveQuotation,
  isEditable,
} from "@/domain/transitions";

const code = (fn: () => void) => {
  try {
    fn();
  } catch (e) {
    return e instanceof DomainError ? e.code : "OTHER";
  }
  return null;
};

describe("money helpers", () => {
  it("rounds half up", () => {
    expect(pctOf(1001, 15)).toBe(150); // 150.15
    expect(pctOf(1003, 15)).toBe(150); // 150.45
    expect(pctOf(1010, 15)).toBe(152); // 151.5 -> 152
  });
  it("formats rand", () => {
    expect(formatZAR(3_706_900)).toBe("R37 069.00");
    expect(formatZAR(5)).toBe("R0.05");
    expect(formatZAR(-500)).toBe("-R5.00");
  });
});

describe("dates", () => {
  it("validates real calendar dates", () => {
    expect(isCalendarDate("2026-02-28")).toBe(true);
    expect(isCalendarDate("2026-02-30")).toBe(false);
    expect(isCalendarDate("2026-2-3")).toBe(false);
  });
  it("adds days across month and year ends", () => {
    expect(addDays("2026-12-25", 14)).toBe("2027-01-08");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });
  it("uses the Johannesburg calendar day", () => {
    // 22:30 UTC on the 31st is already 00:30 on the 1st in Johannesburg (UTC+2).
    expect(todayInJohannesburg(new Date("2026-10-31T22:30:00Z"))).toBe("2026-11-01");
    expect(todayInJohannesburg(new Date("2026-10-31T21:59:59Z"))).toBe("2026-10-31");
  });
  it("compares dates", () => {
    expect(compareDates("2026-01-01", "2026-01-02")).toBeLessThan(0);
    expect(compareDates("2026-01-02", "2026-01-02")).toBe(0);
  });
});

describe("milestone splitting (QUO6)", () => {
  it("splits evenly when it can", () => {
    expect(splitByPercentages(100_000, [50, 50])).toEqual([50_000, 50_000]);
  });
  it("rejects percentages that do not total 100", () => {
    expect(code(() => splitByPercentages(100, [50, 40]))).toBe("INVALID_PERCENTAGES");
    expect(code(() => splitByPercentages(100, [50, 50.01]))).toBe("INVALID_PERCENTAGES");
    expect(code(() => splitByPercentages(100, []))).toBe("INVALID_PERCENTAGES");
    expect(code(() => splitByPercentages(100, [100, 0]))).toBe("INVALID_PERCENTAGES");
  });
  it("handles one cent", () => {
    const r = splitByPercentages(1, [50, 50]);
    expect(r.reduce((a, b) => a + b, 0)).toBe(1);
    expect(r).toEqual([1, 0]);
  });
  it("handles thirds", () => {
    expect(splitByPercentages(100, ["33.33", "33.33", "33.34"])).toEqual([33, 33, 34]);
    expect(splitByPercentages(1000, ["33.33", "33.33", "33.34"])).toEqual([333, 333, 334]);
    const r = splitByPercentages(10_001, ["33.33", "33.33", "33.34"]);
    expect(r.reduce((a, b) => a + b, 0)).toBe(10_001);
  });
  it("gives leftover cents to the largest remainders, earliest first on ties", () => {
    expect(splitByPercentages(5, [50, 50])).toEqual([3, 2]);
    expect(splitByPercentages(7, [25, 25, 25, 25])).toEqual([2, 2, 2, 1]);
  });
  it("always sums to the total, for any total", () => {
    const splits = [["30", "40", "30"], ["50", "50"], ["33.33", "33.33", "33.34"], ["10", "20", "30", "40"], ["99.99", "0.01"]];
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2_000_000_000 }), fc.constantFrom(...splits), (total, pcts) => {
        const r = splitByPercentages(total, pcts);
        expect(r.reduce((a, b) => a + b, 0)).toBe(total);
        expect(r.every((x) => Number.isInteger(x) && x >= 0)).toBe(true);
      }),
    );
  });
});

describe("derived invoice status (INV5)", () => {
  const base = { totalCents: 100_000, dueDate: "2026-11-14", today: "2026-11-01" };
  const s = (o: Partial<Parameters<typeof deriveInvoiceStatus>[0]>) =>
    deriveInvoiceStatus({ stored: "issued", paidCents: 0, ...base, ...o });

  it("issued with no payment", () => {
    expect(s({}).status).toBe("issued");
    expect(s({}).balanceCents).toBe(100_000);
  });
  it("partially paid", () => {
    const r = s({ paidCents: 40_000 });
    expect(r.status).toBe("partially_paid");
    expect(r.balanceCents).toBe(60_000);
  });
  it("paid", () => {
    expect(s({ paidCents: 100_000 }).status).toBe("paid");
  });
  it("is not overdue on the due date, but is the day after", () => {
    expect(s({ today: "2026-11-14" }).status).toBe("issued");
    expect(s({ today: "2026-11-15" }).status).toBe("overdue");
  });
  it("overdue takes precedence over partially paid but keeps the flag", () => {
    const r = s({ paidCents: 1, today: "2026-12-01" });
    expect(r.status).toBe("overdue");
    expect(r.partiallyPaid).toBe(true);
  });
  it("a zero balance is paid even after the due date", () => {
    expect(s({ paidCents: 100_000, today: "2027-01-01" }).status).toBe("paid");
  });
  it("a zero total invoice has a zero balance", () => {
    expect(s({ totalCents: 0 }).status).toBe("paid");
  });
  it("draft and cancelled ignore payments and dates", () => {
    expect(s({ stored: "draft", today: "2030-01-01" }).status).toBe("draft");
    expect(s({ stored: "cancelled", today: "2030-01-01" }).status).toBe("cancelled");
  });
  it("rejects impossible paid amounts", () => {
    expect(code(() => s({ paidCents: 100_001 }))).toBe("INVALID_AMOUNT");
    expect(code(() => s({ paidCents: -1 }))).toBe("INVALID_AMOUNT");
  });
});

describe("derived quotation expiry (QUO3)", () => {
  it("a sent quotation is valid through its expiry date and expired the day after", () => {
    expect(deriveQuotationStatus("sent", "2026-11-14", "2026-11-14")).toBe("sent");
    expect(deriveQuotationStatus("sent", "2026-11-14", "2026-11-15")).toBe("expired");
  });
  it("only sent quotations expire", () => {
    for (const st of ["draft", "accepted", "rejected"] as const) {
      expect(deriveQuotationStatus(st, "2020-01-01", "2026-01-01")).toBe(st);
    }
  });
});

describe("state transitions (QUO2, INV5/INV6)", () => {
  const qStates: StoredQuotationStatus[] = ["draft", "sent", "accepted", "rejected", "expired"];
  const allowedQ = new Set(["draft>sent", "sent>accepted", "sent>rejected", "sent>expired"]);
  const iStates: StoredInvoiceStatus[] = ["draft", "issued", "cancelled"];
  const allowedI = new Set(["draft>issued", "issued>cancelled"]);

  it("allows exactly the permitted quotation moves", () => {
    for (const from of qStates) for (const to of qStates) {
      expect(canMoveQuotation(from, to), `${from}>${to}`).toBe(allowedQ.has(`${from}>${to}`));
    }
  });
  it("allows exactly the permitted invoice moves", () => {
    for (const from of iStates) for (const to of iStates) {
      expect(canMoveInvoice(from, to), `${from}>${to}`).toBe(allowedI.has(`${from}>${to}`));
    }
  });
  const dates = { expiryDate: "2026-11-14", today: "2026-11-01" };
  it("throws on every disallowed quotation move", () => {
    for (const from of qStates) for (const to of qStates) {
      const c = code(() => assertQuotationMove(from, to, dates));
      expect(c === null, `${from}>${to}`).toBe(allowedQ.has(`${from}>${to}`));
    }
  });
  it("blocks accepting an expired quotation", () => {
    expect(code(() => assertQuotationMove("sent", "accepted", { expiryDate: "2026-11-14", today: "2026-11-15" }))).toBe("QUOTATION_EXPIRED");
    expect(code(() => assertQuotationMove("sent", "accepted", { expiryDate: "2026-11-14", today: "2026-11-14" }))).toBeNull();
  });
  it("cancels an invoice only with no payments and a reason", () => {
    expect(code(() => assertInvoiceMove("issued", "cancelled", { paymentCount: 0, reason: "Wrong client" }))).toBeNull();
    expect(code(() => assertInvoiceMove("issued", "cancelled", { paymentCount: 1, reason: "Wrong client" }))).toBe("INVOICE_HAS_PAYMENTS");
    expect(code(() => assertInvoiceMove("issued", "cancelled", { paymentCount: 0 }))).toBe("REASON_REQUIRED");
    expect(code(() => assertInvoiceMove("issued", "cancelled", { paymentCount: 0, reason: "   " }))).toBe("REASON_REQUIRED");
  });
  it("rejects every other invoice move", () => {
    expect(code(() => assertInvoiceMove("draft", "cancelled", { paymentCount: 0, reason: "x" }))).toBe("INVALID_TRANSITION");
    expect(code(() => assertInvoiceMove("cancelled", "issued", { paymentCount: 0 }))).toBe("INVALID_TRANSITION");
    expect(code(() => assertInvoiceMove("issued", "draft", { paymentCount: 0 }))).toBe("INVALID_TRANSITION");
  });
  it("only drafts are editable", () => {
    expect(isEditable("draft")).toBe(true);
    for (const st of ["sent", "accepted", "rejected", "expired", "issued", "cancelled"] as const) {
      expect(isEditable(st)).toBe(false);
    }
  });
});

describe("document numbering (SET5)", () => {
  it("formats the PRD example pattern", () => {
    expect(formatDocumentNumber("QUO{YYYY}{SEQ:4}", 7, 2026)).toBe("QUO20260007");
    expect(formatDocumentNumber("INV-{YY}-{SEQ:3}", 42, 2026)).toBe("INV-26-042");
    expect(formatDocumentNumber("INV{SEQ}", 12345, 2026)).toBe("INV12345");
  });
  it("does not truncate when the sequence outgrows its width", () => {
    expect(formatDocumentNumber("QUO{SEQ:2}", 1234, 2026)).toBe("QUO1234");
  });
  it("requires exactly one SEQ token and no unknown tokens", () => {
    expect(code(() => validateNumberPattern("QUO{YYYY}"))).toBe("INVALID_PATTERN");
    expect(code(() => validateNumberPattern("{SEQ}{SEQ:4}"))).toBe("INVALID_PATTERN");
    expect(code(() => validateNumberPattern("QUO{MONTH}{SEQ}"))).toBe("INVALID_PATTERN");
  });
  it("rejects a non-positive sequence", () => {
    expect(code(() => formatDocumentNumber("QUO{SEQ}", 0, 2026))).toBe("INVALID_AMOUNT");
  });
  it("never allows the counter to be lowered", () => {
    expect(code(() => assertCounterNotLowered(10, 9))).toBe("COUNTER_LOWERED");
    expect(code(() => assertCounterNotLowered(10, 10))).toBeNull();
    expect(code(() => assertCounterNotLowered(10, 11))).toBeNull();
  });
});
