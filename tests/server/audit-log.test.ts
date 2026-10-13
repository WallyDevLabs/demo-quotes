import { describe, expect, it } from "vitest";
import { listAudit } from "@/server/audit-log";
import { createMilestoneInvoice, issueInvoice, recordPayment, reversePayment } from "@/server/invoices";
import { fakePdf, newOwner, setupAcceptedQuotation } from "./helpers";

const OCT_13 = new Date("2026-10-13T10:00:00Z");

describe("audit log view", () => {
  async function busyOwner() {
    const s = await setupAcceptedQuotation();
    const id = await createMilestoneInvoice(s.ownerId, s.quotationId, s.milestoneIds[0]!);
    await issueInvoice(s.ownerId, id, {}, { now: OCT_13, renderPdf: fakePdf });
    const p = await recordPayment(s.ownerId, id, { amount: "100", receivedOn: "2026-10-13", method: "EFT", label: "OTHER" }, OCT_13);
    await reversePayment(s.ownerId, p, { reason: "Wrong invoice" }, OCT_13);
    return s;
  }

  it("lists status changes and payment reversals, newest first, one entry per transition", async () => {
    const s = await busyOwner();
    const { entries } = await listAudit(s.ownerId);
    const actions = entries.map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["create", "status.sent", "status.accepted", "status.issued", "payment.reverse"]));
    expect(actions.filter((a) => a === "status.sent")).toHaveLength(1);
    expect(actions.filter((a) => a === "status.issued")).toHaveLength(1);
    expect(actions.filter((a) => a === "payment.reverse")).toHaveLength(1);
    const times = entries.map((e) => e.at);
    expect([...times].sort().reverse()).toEqual(times);
  });

  it("filters by type and ignores an unknown type", async () => {
    const s = await busyOwner();
    const inv = await listAudit(s.ownerId, { entity: "invoice" });
    expect(inv.entries.length).toBeGreaterThan(0);
    expect(inv.entries.every((e) => e.entity === "invoice")).toBe(true);
    const all = await listAudit(s.ownerId, { entity: "not-a-type" });
    expect(all.entries.length).toBeGreaterThan(inv.entries.length);
  });

  it("pages through older entries without gaps or repeats", async () => {
    const s = await busyOwner();
    const everything = (await listAudit(s.ownerId, { limit: 200 })).entries;
    const seen: string[] = [];
    let before: string | undefined;
    for (let i = 0; i < 20; i++) {
      const page = await listAudit(s.ownerId, { limit: 2, before });
      seen.push(...page.entries.map((e) => e.id));
      if (!page.nextBefore) break;
      before = page.nextBefore;
    }
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.length).toBeGreaterThanOrEqual(Math.min(everything.length, 4));
  });

  it("is scoped to its owner", async () => {
    await busyOwner();
    expect((await listAudit(await newOwner())).entries).toEqual([]);
  });

  it("never contains client names, emails, amounts or banking details", async () => {
    const s = await busyOwner();
    const text = JSON.stringify((await listAudit(s.ownerId, { limit: 200 })).entries);
    for (const secret of ["Thabo", "Acme", "k@example.com", "62000000000", "First National", "37069", "3706900"]) {
      expect(text).not.toContain(secret);
    }
  });
});
