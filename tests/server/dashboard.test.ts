import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { getDashboard } from "@/server/dashboard";
import { cancelInvoice, createCustomInvoice, createMilestoneInvoice, issueInvoice, recordPayment, reversePayment } from "@/server/invoices";
import { createQuotationFromEstimate, sendQuotation } from "@/server/quotations";
import { fakePdf, newOwner, setupAcceptedQuotation } from "./helpers";

const OCT_13 = new Date("2026-10-13T10:00:00Z");
const issue = (ownerId: string, id: string) => issueInvoice(ownerId, id, {}, { now: OCT_13, renderPdf: fakePdf });
const pay = (ownerId: string, id: string, amount: string) => recordPayment(ownerId, id, { amount, receivedOn: "2026-10-13", method: "EFT", label: "OTHER" }, OCT_13);

describe("the dashboard, from real records", () => {
  it("reproduces every figure from a seeded set of quotations, invoices and payments", async () => {
    // An accepted quotation of R37 069.00 (confirmed), split 50/50 into R18 534.50 milestones.
    const s = await setupAcceptedQuotation();

    // Invoice 1: issued, paid R5 000 then R3 000, and the R3 000 is reversed (so only R5 000 counts).
    const i1 = await createMilestoneInvoice(s.ownerId, s.quotationId, s.milestoneIds[0]!);
    await issue(s.ownerId, i1); // due 2026-10-27
    await pay(s.ownerId, i1, "5000");
    const wrong = await pay(s.ownerId, i1, "3000");
    await reversePayment(s.ownerId, wrong, { reason: "Wrong invoice" }, OCT_13);

    // Invoice 2: issued, unpaid, due the same day.
    const i2 = await createMilestoneInvoice(s.ownerId, s.quotationId, s.milestoneIds[1]!);
    await issue(s.ownerId, i2);

    // A cancelled invoice and a draft never count.
    const cancelled = await createCustomInvoice(s.ownerId, s.quotationId, { reason: "x", lines: [{ description: "x", amount: "0.01" }] }).catch(() => null);
    expect(cancelled).toBeNull(); // the quotation is fully invoiced: the ceiling refuses it

    // A sent, unexpired quotation (quoted) from another estimate for the same owner.
    const draft = await createQuotationFromEstimate(s.ownerId, s.estimateId);
    await sendQuotation(s.ownerId, draft, { now: OCT_13, renderPdf: fakePdf }); // expires 2026-11-12

    const dash = await getDashboard(s.ownerId, OCT_13);
    const zar = dash.byCurrency.ZAR;
    expect(zar.confirmedCents).toBe(3_706_900);
    expect(zar.quotedCents).toBe(3_706_900);
    expect(zar.invoicedCents).toBe(3_706_900);
    expect(zar.receivedCents).toBe(500_000);
    expect(zar.outstandingCents).toBe(3_206_900);
    expect(zar.overdueCents).toBe(0);
    expect(zar.upcoming.map((u) => [u.balanceCents, u.daysUntilDue])).toEqual([
      [1_353_450, 14],
      [1_853_450, 14],
    ]);
    expect(dash.byCurrency.USD.invoicedCents).toBe(0);
    expect(dash.vat.level).toBe("unset");
    expect(dash.vat.invoicedZarCents).toBe(3_706_900);

    // Fourteen days later (the day after the due date) both invoices are overdue.
    const later = await getDashboard(s.ownerId, new Date("2026-10-27T22:00:00Z")); // 28 Oct in Johannesburg
    expect(later.byCurrency.ZAR.overdueCents).toBe(3_206_900);
    expect(later.byCurrency.ZAR.overdueCount).toBe(2);
    expect(later.byCurrency.ZAR.upcoming).toEqual([]);
    // Overdue and the quotation expired on 12 November, so it is no longer quoted after that.
    const muchLater = await getDashboard(s.ownerId, new Date("2026-11-13T10:00:00Z"));
    expect(muchLater.byCurrency.ZAR.quotedCents).toBe(0);
    expect(muchLater.byCurrency.ZAR.confirmedCents).toBe(3_706_900);
  });

  it("a cancelled invoice drops out of invoiced and frees the ceiling", async () => {
    const s = await setupAcceptedQuotation();
    const i1 = await createMilestoneInvoice(s.ownerId, s.quotationId, s.milestoneIds[0]!);
    await issue(s.ownerId, i1);
    expect((await getDashboard(s.ownerId, OCT_13)).byCurrency.ZAR.invoicedCents).toBe(1_853_450);
    await cancelInvoice(s.ownerId, i1, { reason: "Raised in error" });
    const z = (await getDashboard(s.ownerId, OCT_13)).byCurrency.ZAR;
    expect([z.invoicedCents, z.outstandingCents, z.receivedCents]).toEqual([0, 0, 0]);
  });

  it("uses the VAT threshold and warning share from settings", async () => {
    const s = await setupAcceptedQuotation();
    const i1 = await createMilestoneInvoice(s.ownerId, s.quotationId, s.milestoneIds[0]!);
    await issue(s.ownerId, i1); // R18 534.50 invoiced
    await db.businessSettings.update({ where: { ownerId: s.ownerId }, data: { vatThresholdCents: 2_000_000n, vatWarnSharePct: "90" } });
    let m = (await getDashboard(s.ownerId, OCT_13)).vat;
    expect(m.sharePct).toBe("92.67");
    expect(m.level).toBe("warn");
    await db.businessSettings.update({ where: { ownerId: s.ownerId }, data: { vatWarnSharePct: "95" } });
    m = (await getDashboard(s.ownerId, OCT_13)).vat;
    expect(m.level).toBe("ok");
    await db.businessSettings.update({ where: { ownerId: s.ownerId }, data: { vatThresholdCents: 1_800_000n } });
    expect((await getDashboard(s.ownerId, OCT_13)).vat.level).toBe("over");
  });

  it("is scoped to its owner", async () => {
    const s = await setupAcceptedQuotation();
    const i1 = await createMilestoneInvoice(s.ownerId, s.quotationId, s.milestoneIds[0]!);
    await issue(s.ownerId, i1);
    const other = (await getDashboard(await newOwner(), OCT_13)).byCurrency.ZAR;
    expect([other.confirmedCents, other.invoicedCents, other.receivedCents]).toEqual([0, 0, 0]);
  });
});
