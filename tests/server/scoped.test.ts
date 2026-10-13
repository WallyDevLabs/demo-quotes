import { describe, expect, it } from "vitest";
import { createClient, createProject } from "@/server/clients";
import { getDashboard } from "@/server/dashboard";
import { saveEstimate, setEstimateReady } from "@/server/estimates";
import { createMilestoneInvoice, issueInvoice, listInvoices, listPaymentsForClient, recordPayment, reversePayment } from "@/server/invoices";
import { acceptQuotation, createQuotationFromEstimate, listQuotations, rejectQuotation, sendQuotation } from "@/server/quotations";
import { fakePdf, newOwner, setupAcceptedQuotation, workedExample } from "./helpers";

const OCT_13 = new Date("2026-10-13T10:00:00Z");
const send = (o: string, q: string) => sendQuotation(o, q, { now: OCT_13, renderPdf: fakePdf });
const accept = (o: string, q: string) => acceptQuotation(o, q, { acceptedBy: "x" }, new Date("2026-10-14T10:00:00Z"));

/** A second client, with its own project and an ACCEPTED quotation of R37 069.00, for the same owner. */
async function anotherClient(ownerId: string) {
  const clientId = await createClient(ownerId, { name: "Second Client", code: "SEC" });
  const projectId = await createProject(ownerId, { clientId, name: "Second project", code: "SEC1" });
  const est = await saveEstimate(ownerId, null, { meta: { projectId, title: "Second", currency: "ZAR", complexity: null }, draft: workedExample() });
  await setEstimateReady(ownerId, est.id, true);
  const quotationId = await createQuotationFromEstimate(ownerId, est.id);
  await send(ownerId, quotationId);
  await accept(ownerId, quotationId);
  return { clientId, projectId, estimateId: est.id, quotationId };
}

describe("a client's balance and documents (CLI2)", () => {
  it("shows that client's totals only, with the dashboard's definitions", async () => {
    const a = await setupAcceptedQuotation();
    const b = await anotherClient(a.ownerId);
    const inv = await createMilestoneInvoice(a.ownerId, a.quotationId, a.milestoneIds[0]!);
    await issueInvoice(a.ownerId, inv, {}, { now: OCT_13, renderPdf: fakePdf });
    await recordPayment(a.ownerId, inv, { amount: "5000", receivedOn: "2026-10-13", method: "EFT", label: "OTHER" }, OCT_13);

    const clientA = (await getDashboard(a.ownerId, OCT_13, { clientId: a.clientId })).byCurrency.ZAR;
    expect([clientA.confirmedCents, clientA.invoicedCents, clientA.receivedCents, clientA.outstandingCents]).toEqual([3_706_900, 1_853_450, 500_000, 1_353_450]);

    const clientB = (await getDashboard(a.ownerId, OCT_13, { clientId: b.clientId })).byCurrency.ZAR;
    expect([clientB.confirmedCents, clientB.invoicedCents, clientB.receivedCents, clientB.outstandingCents]).toEqual([3_706_900, 0, 0, 0]);

    // The two clients add up to the whole business.
    const all = (await getDashboard(a.ownerId, OCT_13)).byCurrency.ZAR;
    expect(all.confirmedCents).toBe(clientA.confirmedCents + clientB.confirmedCents);
    expect(all.invoicedCents).toBe(clientA.invoicedCents + clientB.invoicedCents);
    expect(all.outstandingCents).toBe(clientA.outstandingCents + clientB.outstandingCents);
  });

  it("lists only that client's quotations and invoices", async () => {
    const a = await setupAcceptedQuotation();
    const b = await anotherClient(a.ownerId);
    await createMilestoneInvoice(a.ownerId, a.quotationId, a.milestoneIds[0]!);
    expect((await listQuotations(a.ownerId, OCT_13, { clientId: a.clientId })).map((q) => q.clientId)).toEqual([a.clientId]);
    expect((await listQuotations(a.ownerId, OCT_13, { clientId: b.clientId })).map((q) => q.id)).toEqual([b.quotationId]);
    expect(await listInvoices(a.ownerId, OCT_13, { clientId: b.clientId })).toHaveLength(0);
    expect(await listInvoices(a.ownerId, OCT_13, { clientId: a.clientId })).toHaveLength(1);
  });

  it("lists every payment entry for the client, reversals included, and nobody else's", async () => {
    const a = await setupAcceptedQuotation();
    const other = await anotherClient(a.ownerId);
    const inv = await createMilestoneInvoice(a.ownerId, a.quotationId, a.milestoneIds[0]!);
    await issueInvoice(a.ownerId, inv, {}, { now: OCT_13, renderPdf: fakePdf });
    const p1 = await recordPayment(a.ownerId, inv, { amount: "3000", receivedOn: "2026-10-13", method: "EFT", label: "DEPOSIT" }, OCT_13);
    await recordPayment(a.ownerId, inv, { amount: "2000", receivedOn: "2026-10-13", method: "CARD", label: "OTHER" }, OCT_13);
    await reversePayment(a.ownerId, p1, { reason: "Wrong invoice" }, OCT_13);

    const rows = await listPaymentsForClient(a.ownerId, a.clientId);
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.id === p1)).toMatchObject({ reversed: true, isReversal: false, amountCents: 300_000, currency: "ZAR" });
    expect(rows.find((r) => r.isReversal)).toMatchObject({ amountCents: 300_000, reversalReason: "Wrong invoice" });
    expect(rows.every((r) => r.invoiceNumber === "INV20260001")).toBe(true);

    expect(await listPaymentsForClient(a.ownerId, other.clientId)).toEqual([]);
    expect(await listPaymentsForClient(await newOwner(), a.clientId)).toEqual([]);
  });
});

describe("a project's agreed price (PRJ2)", () => {
  it("is the sum of its accepted quotations: a scope change is a new quotation on the same project", async () => {
    const a = await setupAcceptedQuotation(); // first accepted quotation: R37 069.00
    const agreed = async () => (await getDashboard(a.ownerId, OCT_13, { projectId: a.projectId })).byCurrency.ZAR.confirmedCents;
    expect(await agreed()).toBe(3_706_900);

    // A change of scope: a second quotation on the same project. Sent but not accepted, it adds nothing.
    const change = await createQuotationFromEstimate(a.ownerId, a.estimateId);
    await send(a.ownerId, change);
    expect(await agreed()).toBe(3_706_900);

    // Once accepted, the agreed price grows by exactly its total.
    await accept(a.ownerId, change);
    expect(await agreed()).toBe(7_413_800);

    // A rejected quotation never counts.
    const rejected = await createQuotationFromEstimate(a.ownerId, a.estimateId);
    await send(a.ownerId, rejected);
    await rejectQuotation(a.ownerId, rejected, { reason: "No" }, new Date("2026-10-15T10:00:00Z"));
    expect(await agreed()).toBe(7_413_800);
  });

  it("is kept apart from other projects", async () => {
    const a = await setupAcceptedQuotation();
    const b = await anotherClient(a.ownerId);
    expect((await getDashboard(a.ownerId, OCT_13, { projectId: b.projectId })).byCurrency.ZAR.confirmedCents).toBe(3_706_900);
    expect((await getDashboard(a.ownerId, OCT_13, { projectId: a.projectId })).byCurrency.ZAR.confirmedCents).toBe(3_706_900);
    expect((await getDashboard(a.ownerId, OCT_13)).byCurrency.ZAR.confirmedCents).toBe(7_413_800);
  });

  it("is zero for a project with nothing accepted, and for another owner", async () => {
    const a = await setupAcceptedQuotation();
    const other = await newOwner();
    expect((await getDashboard(other, OCT_13, { projectId: a.projectId })).byCurrency.ZAR.confirmedCents).toBe(0);
  });
});
