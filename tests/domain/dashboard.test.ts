import { describe, expect, it } from "vitest";
import { addMonths, trailingYearStart } from "@/domain/dates";
import { computeDashboard, vatMonitor, type DashInvoice, type DashQuotation, type DashboardInput } from "@/domain/dashboard";

const TODAY = "2026-10-13";

const q = (currency: "ZAR" | "USD", stored: DashQuotation["stored"], totalCents: number, expiryDate: string | null): DashQuotation => ({ currency, stored, totalCents, expiryDate });
const inv = (
  id: string,
  currency: "ZAR" | "USD",
  stored: DashInvoice["stored"],
  totalCents: number,
  paidCents: number,
  dueDate: string | null,
  issueDate: string | null,
  zar: number | null = null,
): DashInvoice => ({ id, number: id, currency, stored, totalCents, paidCents, issueDate, dueDate, zarValueAtIssueCents: zar, clientName: "Acme" });

/**
 * A seeded dataset with every expected figure worked out by hand (the milestone 5 gate).
 * Money is in cents: 1 000 000 = R10 000.00.
 */
const seeded: DashboardInput = {
  today: TODAY,
  upcomingWindowDays: 14,
  vat: { thresholdCents: 10_000_000, warnSharePct: 80 },
  quotations: [
    q("ZAR", "sent", 1_000_000, "2026-11-12"), // quoted
    q("ZAR", "sent", 500_000, "2026-10-13"), // expires today: still valid, so quoted
    q("ZAR", "sent", 300_000, "2026-10-12"), // expired yesterday: not quoted
    q("ZAR", "accepted", 2_000_000, "2026-10-01"), // confirmed
    q("ZAR", "accepted", 700_000, "2026-10-01"), // confirmed
    q("ZAR", "draft", 9_999_999, null), // nothing
    q("ZAR", "rejected", 800_000, "2026-10-30"), // nothing
    q("USD", "sent", 250_000, "2026-12-01"), // quoted (USD)
    q("USD", "accepted", 400_000, "2026-10-20"), // confirmed (USD)
  ],
  invoices: [
    inv("I1", "ZAR", "issued", 1_000_000, 1_000_000, "2026-09-01", "2026-08-18"), // fully paid
    inv("I2", "ZAR", "issued", 500_000, 200_000, "2026-10-01", "2026-09-17"), // overdue by 300 000
    inv("I3", "ZAR", "issued", 400_000, 0, "2026-10-13", "2026-09-29"), // due today: upcoming, not overdue
    inv("I4", "ZAR", "issued", 600_000, 0, "2026-10-27", "2026-10-13"), // last day inside the 14 day window
    inv("I5", "ZAR", "issued", 100_000, 0, "2026-10-28", "2026-10-13"), // just outside the window
    inv("I6", "ZAR", "cancelled", 900_000, 0, "2026-10-20", "2026-10-01"), // excluded
    inv("I7", "ZAR", "draft", 800_000, 0, null, null), // excluded
    inv("I8", "ZAR", "issued", 50_000, 0, "2026-10-12", "2026-09-28"), // overdue by 50 000
    inv("U1", "USD", "issued", 250_000, 100_000, "2026-10-20", "2026-10-01", 4_500_000),
    inv("U2", "USD", "issued", 150_000, 0, "2026-09-30", "2026-09-15"), // overdue, no rand value entered
  ],
};

describe("dashboard figures: a seeded dataset reproduces every definition", () => {
  const d = computeDashboard(seeded);
  const zar = d.byCurrency.ZAR;
  const usd = d.byCurrency.USD;

  it("Quoted: sent and not expired (a quotation expiring today still counts)", () => {
    expect(zar.quotedCents).toBe(1_500_000);
  });
  it("Confirmed: accepted quotations", () => {
    expect(zar.confirmedCents).toBe(2_700_000);
  });
  it("Invoiced: issued invoices, excluding cancelled and drafts", () => {
    expect(zar.invoicedCents).toBe(2_650_000);
  });
  it("Received: payments excluding reversed ones", () => {
    expect(zar.receivedCents).toBe(1_200_000);
  });
  it("Outstanding: invoiced minus received on issued invoices", () => {
    expect(zar.outstandingCents).toBe(1_450_000);
    expect(zar.invoicedCents - zar.receivedCents).toBe(zar.outstandingCents);
  });
  it("Overdue: the balance of invoices whose due date has passed (due today is not overdue)", () => {
    expect(zar.overdueCents).toBe(350_000);
    expect(zar.overdueCount).toBe(2);
  });
  it("Upcoming: issued invoices with a balance due inside the window, soonest first", () => {
    expect(zar.upcoming.map((u) => [u.id, u.dueDate, u.balanceCents, u.daysUntilDue])).toEqual([
      ["I3", "2026-10-13", 400_000, 0],
      ["I4", "2026-10-27", 600_000, 14],
    ]);
  });
  it("is reported per currency and never summed across them", () => {
    expect(usd.quotedCents).toBe(250_000);
    expect(usd.confirmedCents).toBe(400_000);
    expect(usd.invoicedCents).toBe(400_000);
    expect(usd.receivedCents).toBe(100_000);
    expect(usd.outstandingCents).toBe(300_000);
    expect(usd.overdueCents).toBe(150_000);
    expect(usd.upcoming.map((u) => [u.id, u.daysUntilDue])).toEqual([["U1", 7]]);
  });
  it("invoiced revenue is never confused with money received", () => {
    expect(zar.invoicedCents).not.toBe(zar.receivedCents);
  });
  it("the window is configurable", () => {
    const wide = computeDashboard({ ...seeded, upcomingWindowDays: 15 }).byCurrency.ZAR.upcoming.map((u) => u.id);
    expect(wide).toEqual(["I3", "I4", "I5"]);
    expect(computeDashboard({ ...seeded, upcomingWindowDays: 0 }).byCurrency.ZAR.upcoming.map((u) => u.id)).toEqual(["I3"]);
  });
  it("an empty dataset is all zeros", () => {
    const e = computeDashboard({ ...seeded, quotations: [], invoices: [] }).byCurrency.ZAR;
    expect([e.quotedCents, e.confirmedCents, e.invoicedCents, e.receivedCents, e.outstandingCents, e.overdueCents]).toEqual([0, 0, 0, 0, 0, 0]);
    expect(e.upcoming).toEqual([]);
  });
  it("a paid invoice is neither outstanding, overdue nor upcoming", () => {
    const paid = computeDashboard({ ...seeded, invoices: [inv("P", "ZAR", "issued", 500_000, 500_000, "2026-10-14", "2026-10-01")] }).byCurrency.ZAR;
    expect([paid.outstandingCents, paid.overdueCents, paid.upcoming.length]).toEqual([0, 0, 0]);
    expect(paid.receivedCents).toBe(500_000);
  });
});

describe("VAT threshold monitor (trailing twelve months)", () => {
  const base = (invoices: DashInvoice[], thresholdCents: number | null = 10_000_000, warn: number | string = 80): DashboardInput => ({
    ...seeded,
    invoices,
    vat: { thresholdCents, warnSharePct: warn },
  });

  it("counts rand invoices plus the rand value of USD invoices, and flags USD without one", () => {
    const m = vatMonitor(seeded);
    // ZAR issued: 1 000 000 + 500 000 + 400 000 + 600 000 + 100 000 + 50 000; plus U1's R45 000 (4 500 000)
    expect(m.invoicedZarCents).toBe(2_650_000 + 4_500_000);
    expect(m.usdInvoicesWithoutRand).toBe(1);
    expect(m.sharePct).toBe("71.50");
    expect(m.level).toBe("ok");
    expect(m.windowStart).toBe("2025-10-14");
    expect(m.windowEnd).toBe(TODAY);
  });

  it("excludes cancelled and draft invoices", () => {
    const m = vatMonitor(base([inv("A", "ZAR", "cancelled", 9_000_000, 0, null, "2026-10-01"), inv("B", "ZAR", "draft", 9_000_000, 0, null, null)]));
    expect(m.invoicedZarCents).toBe(0);
    expect(m.level).toBe("ok");
  });

  it("includes an invoice issued on the first day of the window and today, not the day before", () => {
    const at = (issue: string) => vatMonitor(base([inv("A", "ZAR", "issued", 1_000, 0, null, issue)])).invoicedZarCents;
    expect(at("2025-10-14")).toBe(1_000);
    expect(at("2025-10-13")).toBe(0);
    expect(at(TODAY)).toBe(1_000);
  });

  it("warns at exactly the configured share and not one cent below", () => {
    const level = (cents: number) => vatMonitor(base([inv("A", "ZAR", "issued", cents, 0, null, "2026-10-01")])).level;
    expect(level(7_999_999)).toBe("ok");
    expect(level(8_000_000)).toBe("warn");
    expect(level(9_999_999)).toBe("warn");
    expect(level(10_000_000)).toBe("over");
    expect(level(12_000_000)).toBe("over");
  });

  it("respects a different warning share", () => {
    const level = (warn: number) => vatMonitor(base([inv("A", "ZAR", "issued", 5_000_000, 0, null, "2026-10-01")], 10_000_000, warn)).level;
    expect(level(50)).toBe("warn");
    expect(level(51)).toBe("ok");
  });

  it("is unset until a threshold is entered, so nothing is assumed", () => {
    const m = vatMonitor(base([inv("A", "ZAR", "issued", 5_000_000, 0, null, "2026-10-01")], null));
    expect(m.level).toBe("unset");
    expect(m.sharePct).toBeNull();
  });
});

describe("calendar helpers", () => {
  it("adds months with end-of-month clamping", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonths("2026-10-13", -12)).toBe("2025-10-13");
    expect(addMonths("2026-03-31", -1)).toBe("2026-02-28");
    expect(addMonths("2026-12-15", 2)).toBe("2027-02-15");
  });
  it("the trailing year starts the day after the same date a year ago", () => {
    expect(trailingYearStart("2026-10-13")).toBe("2025-10-14");
    expect(trailingYearStart("2028-02-29")).toBe("2027-03-01"); // 29 Feb a year ago clamps to 28 Feb
  });
});
