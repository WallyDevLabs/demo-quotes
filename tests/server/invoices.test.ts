import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import {
  cancelInvoice,
  createCustomInvoice,
  createMilestoneInvoice,
  deleteDraftInvoice,
  getInvoice,
  getInvoiceDocument,
  getInvoicePdf,
  getQuotationInvoicing,
  issueInvoice,
  listInvoices,
  recordPayment,
  reversePayment,
  updateDraftCustomInvoice,
} from "@/server/invoices";
import { createQuotationFromEstimate, getQuotation } from "@/server/quotations";
import { configureBanking, fakePdf, newOwner, setupAcceptedQuotation, setupReadyEstimate } from "./helpers";

const OCT_13 = new Date("2026-10-13T10:00:00Z");
const issue = (ownerId: string, id: string, now = OCT_13) => issueInvoice(ownerId, id, {}, { now, renderPdf: fakePdf });
const pay = (ownerId: string, invoiceId: string, amount: string, receivedOn = "2026-10-13", now = OCT_13) =>
  recordPayment(ownerId, invoiceId, { amount, receivedOn, method: "EFT", label: "OTHER" }, now);
const raw = (sql: string) => db.$executeRawUnsafe(sql);
const custom = (reason: string, amount: string) => ({ reason, lines: [{ description: reason, amount }] });

/** An accepted quotation (R37 069.00) with its first milestone invoice already issued. */
async function issuedMilestoneInvoice() {
  const s = await setupAcceptedQuotation();
  const id = await createMilestoneInvoice(s.ownerId, s.quotationId, s.milestoneIds[0]!);
  await issue(s.ownerId, id);
  return { ...s, id };
}

describe("creating invoices from an accepted quotation (INV1)", () => {
  it("needs an accepted quotation", async () => {
    const s = await setupReadyEstimate();
    const draftQ = await createQuotationFromEstimate(s.ownerId, s.estimateId);
    await expect(createCustomInvoice(s.ownerId, draftQ, custom("x", "1"))).rejects.toThrow(/accepted/i);
    const a = await setupAcceptedQuotation({ acceptNow: false });
    await expect(createCustomInvoice(a.ownerId, a.quotationId, custom("x", "1"))).rejects.toThrow(/accepted/i);
  });

  it("creates a milestone invoice for exactly the milestone amount, copied from the quotation", async () => {
    const s = await setupAcceptedQuotation();
    const id = await createMilestoneInvoice(s.ownerId, s.quotationId, s.milestoneIds[0]!);
    const inv = (await getInvoice(s.ownerId, id))!;
    expect(inv.status).toBe("draft");
    expect(inv.number).toBeNull();
    expect(inv.totalCents).toBe(1_853_450);
    expect(inv.milestoneLabel).toBe("Deposit (50.00%)");
    expect(inv.lines[0]!.detail).toMatch(/^Quotation QUO2026/);
    expect(inv.discountCents).toBe(0);
  });

  it("several invoices from one quotation add up to its accepted total, and no more", async () => {
    const s = await setupAcceptedQuotation();
    await createMilestoneInvoice(s.ownerId, s.quotationId, s.milestoneIds[0]!);
    await createMilestoneInvoice(s.ownerId, s.quotationId, s.milestoneIds[1]!);
    const r = (await getQuotationInvoicing(s.ownerId, s.quotationId))!;
    expect(r.invoicedCents).toBe(s.total);
    expect(r.remainingCents).toBe(0);
    await expect(createCustomInvoice(s.ownerId, s.quotationId, custom("one more", "0.01"))).rejects.toMatchObject({ code: "OVER_INVOICED" });
  });

  it("invoices a milestone once, and a cancelled invoice frees it", async () => {
    const s = await setupAcceptedQuotation();
    const first = await createMilestoneInvoice(s.ownerId, s.quotationId, s.milestoneIds[0]!);
    await expect(createMilestoneInvoice(s.ownerId, s.quotationId, s.milestoneIds[0]!)).rejects.toThrow(/already been invoiced/);
    await issue(s.ownerId, first);
    await cancelInvoice(s.ownerId, first, { reason: "Raised in error" });
    const second = await createMilestoneInvoice(s.ownerId, s.quotationId, s.milestoneIds[0]!);
    expect(second).not.toBe(first);
    const r = (await getQuotationInvoicing(s.ownerId, s.quotationId))!;
    expect(r.invoicedCents).toBe(1_853_450);
  });

  it("the database also refuses a second live invoice for a milestone", async () => {
    const s = await setupAcceptedQuotation();
    const id = await createMilestoneInvoice(s.ownerId, s.quotationId, s.milestoneIds[0]!);
    await expect(
      raw(`INSERT INTO "Invoice" ("id","ownerId","clientId","projectId","quotationId","milestoneId","currency","vatMode","subtotalCents","discountCents","vatCents","totalCents","updatedAt")
           SELECT gen_random_uuid(), "ownerId","clientId","projectId","quotationId","milestoneId","currency","vatMode",1,0,0,1,now() FROM "Invoice" WHERE "id" = '${id}'`),
    ).rejects.toThrow();
  });

  it("a custom invoice needs a reason and counts against the ceiling (exactly the remainder is allowed)", async () => {
    const s = await setupAcceptedQuotation();
    await expect(createCustomInvoice(s.ownerId, s.quotationId, { reason: " ", lines: [{ description: "x", amount: "1" }] })).rejects.toThrow();
    await expect(createCustomInvoice(s.ownerId, s.quotationId, custom("Too much", "37069.01"))).rejects.toMatchObject({ code: "OVER_INVOICED" });
    const id = await createCustomInvoice(s.ownerId, s.quotationId, custom("Everything", "37069.00"));
    expect((await getInvoice(s.ownerId, id))!.customReason).toBe("Everything");
    expect((await getQuotationInvoicing(s.ownerId, s.quotationId))!.remainingCents).toBe(0);
  });

  it("a draft custom invoice can be edited within the ceiling; a milestone draft cannot", async () => {
    const s = await setupAcceptedQuotation();
    const c = await createCustomInvoice(s.ownerId, s.quotationId, custom("Setup", "100"));
    await updateDraftCustomInvoice(s.ownerId, c, custom("Setup and domain", "250.50"));
    expect((await getInvoice(s.ownerId, c))!.totalCents).toBe(25_050);
    await expect(updateDraftCustomInvoice(s.ownerId, c, custom("Huge", "99999"))).rejects.toMatchObject({ code: "OVER_INVOICED" });
    const m = await createMilestoneInvoice(s.ownerId, s.quotationId, s.milestoneIds[0]!);
    await expect(updateDraftCustomInvoice(s.ownerId, m, custom("x", "1"))).rejects.toThrow(/milestone/i);
  });

  it("reports an unparseable amount against its own line", async () => {
    const s = await setupAcceptedQuotation();
    const err = await createCustomInvoice(s.ownerId, s.quotationId, { reason: "r", lines: [{ description: "a", amount: "abc" }] }).catch((e) => e);
    expect(err.issues).toEqual([{ path: "lines.0.amount", message: expect.any(String) }]);
  });

  it("two invoices created at the same moment cannot both fit (the ceiling race)", async () => {
    const s = await setupAcceptedQuotation();
    const results = await Promise.allSettled([
      createCustomInvoice(s.ownerId, s.quotationId, custom("A", "20000")),
      createCustomInvoice(s.ownerId, s.quotationId, custom("B", "20000")),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await getQuotationInvoicing(s.ownerId, s.quotationId))!.invoicedCents).toBe(2_000_000);
  });

  it("eight simultaneous quarter-total invoices: exactly four succeed and the ceiling holds", async () => {
    const s = await setupAcceptedQuotation({ milestones: [] });
    const quarter = "9267.25"; // 4 x 926 725 = 3 706 900
    const results = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => createCustomInvoice(s.ownerId, s.quotationId, custom(`Part ${i}`, quarter))));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(4);
    const r = (await getQuotationInvoicing(s.ownerId, s.quotationId))!;
    expect(r.invoicedCents).toBe(s.total);
    expect(r.remainingCents).toBe(0);
  }, 60_000);

  it("the database refuses over-invoicing even for direct inserts", async () => {
    const s = await setupAcceptedQuotation();
    const id = await createMilestoneInvoice(s.ownerId, s.quotationId, s.milestoneIds[0]!);
    await expect(raw(`UPDATE "Invoice" SET "subtotalCents" = 99999999, "totalCents" = 99999999 WHERE "id" = '${id}'`)).rejects.toThrow(/exceed/);
    await expect(
      raw(`INSERT INTO "Invoice" ("id","ownerId","clientId","projectId","quotationId","currency","vatMode","subtotalCents","discountCents","vatCents","totalCents","updatedAt")
           SELECT gen_random_uuid(), "ownerId","clientId","projectId","quotationId","currency","vatMode",5000000,0,0,5000000,now() FROM "Invoice" WHERE "id" = '${id}'`),
    ).rejects.toThrow(/exceed/);
  });

  it("is scoped to its owner", async () => {
    const s = await setupAcceptedQuotation();
    const other = await newOwner();
    await expect(createMilestoneInvoice(other, s.quotationId, s.milestoneIds[0]!)).rejects.toThrow();
    const id = await createMilestoneInvoice(s.ownerId, s.quotationId, s.milestoneIds[0]!);
    expect(await getInvoice(other, id)).toBeNull();
    expect(await listInvoices(other)).toHaveLength(0);
  });
});

describe("issuing (INV3, INV4, INV7)", () => {
  it("allocates the number, due date from the payment terms, snapshots and a stored PDF", async () => {
    const s = await setupAcceptedQuotation();
    const id = await createMilestoneInvoice(s.ownerId, s.quotationId, s.milestoneIds[0]!);
    const { number } = await issue(s.ownerId, id);
    expect(number).toBe("INV20260001");
    const inv = (await getInvoice(s.ownerId, id, OCT_13))!;
    expect(inv.status).toBe("issued");
    expect(inv.issueDate).toBe("2026-10-13");
    expect(inv.dueDate).toBe("2026-10-27"); // 14 day terms
    expect(inv.paymentReference).toBe("INV20260001");
    expect(inv.hasPdf).toBe(true);
    const doc = (await getInvoiceDocument(s.ownerId, id))!;
    expect(doc.banking.lines).toContain("Account number: 62000000000");
    expect(doc.banking.reference).toBe("INV20260001");
  });

  it("needs banking details for the invoice's currency, and business details", async () => {
    const s = await setupAcceptedQuotation();
    await db.currencySettings.update({ where: { ownerId_currency: { ownerId: s.ownerId, currency: "ZAR" } }, data: { bankingDetails: {} } });
    const id = await createMilestoneInvoice(s.ownerId, s.quotationId, s.milestoneIds[0]!);
    await expect(issue(s.ownerId, id)).rejects.toThrow(/banking details/i);
    expect((await getInvoice(s.ownerId, id))!.status).toBe("draft");
    await configureBanking(s.ownerId);
    await db.businessSettings.update({ where: { ownerId: s.ownerId }, data: { legalName: "" } });
    await expect(issue(s.ownerId, id)).rejects.toThrow(/business details/i);
  });

  it("cannot be issued twice", async () => {
    const s = await issuedMilestoneInvoice();
    await expect(issue(s.ownerId, s.id)).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });

  it("a rolled back issue consumes no number and stores no file", async () => {
    const s = await setupAcceptedQuotation();
    const id = await createMilestoneInvoice(s.ownerId, s.quotationId, s.milestoneIds[0]!);
    await expect(issueInvoice(s.ownerId, id, {}, { now: OCT_13, renderPdf: async () => { throw new Error("render failed"); } })).rejects.toThrow("render failed");
    expect((await db.numberCounter.findFirstOrThrow({ where: { ownerId: s.ownerId, kind: "INVOICE" } })).next).toBe(1);
    expect(await db.storedFile.count({ where: { ownerId: s.ownerId, kind: "INVOICE_PDF" } })).toBe(0);
    expect((await getInvoice(s.ownerId, id))!.status).toBe("draft");
    expect((await issue(s.ownerId, id)).number).toBe("INV20260001");
  });

  it("twenty concurrent issues produce twenty unique, consecutive numbers", async () => {
    const s = await setupAcceptedQuotation({ milestones: [] });
    const ids: string[] = [];
    for (let i = 0; i < 20; i++) ids.push(await createCustomInvoice(s.ownerId, s.quotationId, custom(`Part ${i}`, "1853.45"))); // 20 x 185 345 = 3 706 900
    const results = await Promise.all(ids.map((id) => issue(s.ownerId, id)));
    const numbers = results.map((r) => r.number).sort();
    expect(new Set(numbers).size).toBe(20);
    expect(numbers).toEqual(Array.from({ length: 20 }, (_, i) => `INV2026${String(i + 1).padStart(4, "0")}`));
    expect((await db.numberCounter.findFirstOrThrow({ where: { ownerId: s.ownerId, kind: "INVOICE" } })).next).toBe(21);
  }, 60_000);

  it("a draft can be deleted; an issued invoice cannot (service and database)", async () => {
    const s = await setupAcceptedQuotation();
    const draft = await createMilestoneInvoice(s.ownerId, s.quotationId, s.milestoneIds[0]!);
    await deleteDraftInvoice(s.ownerId, draft);
    expect(await getInvoice(s.ownerId, draft)).toBeNull();

    const i = await issuedMilestoneInvoice();
    await expect(deleteDraftInvoice(i.ownerId, i.id)).rejects.toThrow(/draft/i);
    await expect(raw(`DELETE FROM "Invoice" WHERE "id" = '${i.id}'`)).rejects.toThrow(/issued/);
  });
});

describe("an issued invoice is frozen (the milestone gate)", () => {
  it("is refused by the database for direct updates and deletes", async () => {
    const s = await issuedMilestoneInvoice();
    const line = await db.invoiceLine.findFirstOrThrow({ where: { invoiceId: s.id } });
    const file = await db.storedFile.findFirstOrThrow({ where: { ownerId: s.ownerId, kind: "INVOICE_PDF" } });
    await expect(raw(`UPDATE "Invoice" SET "totalCents" = 1, "subtotalCents" = 1 WHERE "id" = '${s.id}'`)).rejects.toThrow(/frozen/);
    await expect(raw(`UPDATE "Invoice" SET "number" = 'HACK' WHERE "id" = '${s.id}'`)).rejects.toThrow(/frozen/);
    await expect(raw(`UPDATE "Invoice" SET "dueDate" = '2030-01-01' WHERE "id" = '${s.id}'`)).rejects.toThrow(/frozen/);
    await expect(raw(`UPDATE "Invoice" SET "status" = 'DRAFT' WHERE "id" = '${s.id}'`)).rejects.toThrow();
    await expect(raw(`UPDATE "InvoiceLine" SET "amountCents" = 1 WHERE "id" = '${line.id}'`)).rejects.toThrow(/frozen/);
    await expect(raw(`DELETE FROM "InvoiceLine" WHERE "id" = '${line.id}'`)).rejects.toThrow(/frozen/);
    await expect(raw(`UPDATE "StoredFile" SET "sha256" = 'x' WHERE "id" = '${file.id}'`)).rejects.toThrow(/immutable/);
    expect((await getInvoice(s.ownerId, s.id))!.totalCents).toBe(1_853_450);
  });

  it("only allows cancellation with a reason, and a cancelled invoice is final", async () => {
    const s = await issuedMilestoneInvoice();
    await expect(raw(`UPDATE "Invoice" SET "status" = 'CANCELLED' WHERE "id" = '${s.id}'`)).rejects.toThrow(/reason/);
    await raw(`UPDATE "Invoice" SET "status" = 'CANCELLED', "cancelReason" = 'direct', "cancelledAt" = now() WHERE "id" = '${s.id}'`);
    await expect(raw(`UPDATE "Invoice" SET "cancelReason" = 'changed' WHERE "id" = '${s.id}'`)).rejects.toThrow(/final|cancelled/);
    await expect(raw(`UPDATE "Invoice" SET "status" = 'ISSUED' WHERE "id" = '${s.id}'`)).rejects.toThrow();
  });

  it("later changes to settings, rates, banking or the client never alter it or its stored PDF", async () => {
    const s = await issuedMilestoneInvoice();
    const before = await getInvoicePdf(s.ownerId, s.id);
    const docBefore = await getInvoiceDocument(s.ownerId, s.id);
    await db.businessSettings.update({ where: { ownerId: s.ownerId }, data: { legalName: "Someone Else", invoicePattern: "ZZ{SEQ}", paymentTermsDays: 60 } });
    await db.client.update({ where: { id: s.clientId }, data: { name: "Renamed", companyName: "Renamed Co" } });
    await db.currencySettings.update({ where: { ownerId_currency: { ownerId: s.ownerId, currency: "ZAR" } }, data: { bankingDetails: { bankName: "Other Bank", accountNumber: "999" } } });
    const after = await getInvoicePdf(s.ownerId, s.id);
    expect(createHash("sha256").update(after!.bytes).digest("hex")).toBe(before!.sha256);
    expect(await getInvoiceDocument(s.ownerId, s.id)).toEqual(docBefore);
    expect(docBefore!.business.name).toBe("Katlego Barayi");
    expect(docBefore!.banking.lines).toContain("Bank: First National Bank");
    expect((await getInvoice(s.ownerId, s.id))!.dueDate).toBe("2026-10-27");
  });
});

describe("payments (PAY1 to PAY5)", () => {
  it("records partial then final payments, and the status follows", async () => {
    const s = await issuedMilestoneInvoice(); // R18 534.50
    expect((await getInvoice(s.ownerId, s.id, OCT_13))!.displayStatus).toBe("issued");
    await pay(s.ownerId, s.id, "5000"); // a deposit-like first payment
    let inv = (await getInvoice(s.ownerId, s.id, OCT_13))!;
    expect(inv.displayStatus).toBe("partially_paid");
    expect(inv.paidCents).toBe(500_000);
    expect(inv.balanceCents).toBe(1_353_450);
    await pay(s.ownerId, s.id, "13534.50");
    inv = (await getInvoice(s.ownerId, s.id, OCT_13))!;
    expect(inv.displayStatus).toBe("paid");
    expect(inv.balanceCents).toBe(0);
  });

  it("a deposit is simply the first milestone invoice (PAY5)", async () => {
    const s = await issuedMilestoneInvoice();
    await recordPayment(s.ownerId, s.id, { amount: "18534.50", receivedOn: "2026-10-13", method: "EFT", label: "DEPOSIT" }, OCT_13);
    expect((await getInvoice(s.ownerId, s.id, OCT_13))!.displayStatus).toBe("paid");
    const r = (await getQuotationInvoicing(s.ownerId, s.quotationId))!;
    expect(r.remainingCents).toBe(1_853_450); // the second milestone is still to invoice
  });

  it("rejects overpayment, including by one cent, and shows the remaining balance", async () => {
    const s = await issuedMilestoneInvoice();
    await expect(pay(s.ownerId, s.id, "18534.51")).rejects.toMatchObject({ code: "OVERPAYMENT", message: expect.stringContaining("R18 534.50") });
    await pay(s.ownerId, s.id, "18534.00");
    await expect(pay(s.ownerId, s.id, "0.51")).rejects.toMatchObject({ code: "OVERPAYMENT", message: expect.stringContaining("R0.50") });
    await pay(s.ownerId, s.id, "0.50");
  });

  it("two payments recorded at the same moment cannot overpay", async () => {
    const s = await issuedMilestoneInvoice();
    const results = await Promise.allSettled([pay(s.ownerId, s.id, "12000"), pay(s.ownerId, s.id, "12000")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await getInvoice(s.ownerId, s.id, OCT_13))!.paidCents).toBe(1_200_000);
  });

  it("rejects payments on drafts and on cancelled invoices (PAY4)", async () => {
    const s = await setupAcceptedQuotation();
    const draft = await createMilestoneInvoice(s.ownerId, s.quotationId, s.milestoneIds[0]!);
    await expect(pay(s.ownerId, draft, "10")).rejects.toMatchObject({ code: "NOT_PAYABLE" });
    await issue(s.ownerId, draft);
    await cancelInvoice(s.ownerId, draft, { reason: "Wrong client" });
    await expect(pay(s.ownerId, draft, "10")).rejects.toMatchObject({ code: "NOT_PAYABLE" });
  });

  it("rejects zero, bad and future-dated payments", async () => {
    const s = await issuedMilestoneInvoice();
    await expect(pay(s.ownerId, s.id, "0")).rejects.toThrow();
    await expect(pay(s.ownerId, s.id, "abc")).rejects.toMatchObject({ issues: [{ path: "amount" }] });
    await expect(pay(s.ownerId, s.id, "10", "2026-10-14")).rejects.toMatchObject({ code: "INVALID_DATE" });
    await expect(pay(s.ownerId, s.id, "10", "2026-02-30")).rejects.toThrow();
  });

  it("is overdue the day after the due date, not on it, and never once paid", async () => {
    const s = await issuedMilestoneInvoice(); // due 2026-10-27
    const at = async (iso: string) => (await getInvoice(s.ownerId, s.id, new Date(iso)))!.displayStatus;
    expect(await at("2026-10-27T20:00:00Z")).toBe("issued"); // 22:00 on the 27th in Johannesburg
    expect(await at("2026-10-27T22:00:00Z")).toBe("overdue"); // midnight: the 28th
    await pay(s.ownerId, s.id, "18534.50", "2026-10-13");
    expect(await at("2026-12-01T10:00:00Z")).toBe("paid");
  });

  it("a reversal restores the balance, keeps both rows, and can happen only once with a reason (PAY3)", async () => {
    const s = await issuedMilestoneInvoice();
    const p1 = await pay(s.ownerId, s.id, "8000");
    await pay(s.ownerId, s.id, "2000");
    await expect(reversePayment(s.ownerId, p1, { reason: "  " })).rejects.toThrow();
    const rev = await reversePayment(s.ownerId, p1, { reason: "Paid against the wrong invoice" }, OCT_13);
    const inv = (await getInvoice(s.ownerId, s.id, OCT_13))!;
    expect(inv.paidCents).toBe(200_000);
    expect(inv.balanceCents).toBe(1_653_450);
    expect(inv.payments).toHaveLength(3);
    expect(inv.payments.find((p) => p.id === p1)!.reversed).toBe(true);
    expect(inv.payments.find((p) => p.id === rev)).toMatchObject({ reversesPaymentId: p1, reversalReason: "Paid against the wrong invoice", amountCents: 800_000 });
    await expect(reversePayment(s.ownerId, p1, { reason: "again" })).rejects.toMatchObject({ code: "NOT_REVERSIBLE" });
    await expect(reversePayment(s.ownerId, rev, { reason: "undo" })).rejects.toMatchObject({ code: "NOT_REVERSIBLE" });
    expect(await db.auditLog.count({ where: { ownerId: s.ownerId, action: "payment.reverse" } })).toBe(1);
    await pay(s.ownerId, s.id, "8000"); // the restored balance is payable again
  });

  it("a fully paid invoice returns to partially paid or issued when a payment is reversed", async () => {
    const s = await issuedMilestoneInvoice();
    const p = await pay(s.ownerId, s.id, "18534.50");
    expect((await getInvoice(s.ownerId, s.id, OCT_13))!.displayStatus).toBe("paid");
    await reversePayment(s.ownerId, p, { reason: "Bounced" }, OCT_13);
    expect((await getInvoice(s.ownerId, s.id, OCT_13))!.displayStatus).toBe("issued");
  });

  it("is refused by the database: edits, deletes, overpayment, drafts, bad reversals", async () => {
    const s = await issuedMilestoneInvoice();
    const p = await pay(s.ownerId, s.id, "1000");
    await expect(raw(`UPDATE "Payment" SET "amountCents" = 1 WHERE "id" = '${p}'`)).rejects.toThrow(/append only/);
    await expect(raw(`DELETE FROM "Payment" WHERE "id" = '${p}'`)).rejects.toThrow(/append only/);
    const ins = (amount: number, extra = "") =>
      raw(`INSERT INTO "Payment" ("id","ownerId","invoiceId","amountCents","receivedOn","method","label","createdAt"${extra ? ',"reversesPaymentId","reversalReason"' : ""})
           VALUES (gen_random_uuid(),'${s.ownerId}','${s.id}',${amount},'2026-10-13','EFT','OTHER',now()${extra})`);
    await expect(ins(99_999_999)).rejects.toThrow(/exceeds/);
    await expect(ins(100_000, `,'${p}','x'`)).resolves.toBeDefined(); // a correct reversal (same amount) is allowed
    await expect(ins(999, `,'${p}','x'`)).rejects.toThrow(); // already reversed, and the wrong amount
    const draft = await createMilestoneInvoice(s.ownerId, s.quotationId, s.milestoneIds[1]!);
    await expect(raw(`INSERT INTO "Payment" ("id","ownerId","invoiceId","amountCents","receivedOn","method","label","createdAt") VALUES (gen_random_uuid(),'${s.ownerId}','${draft}',1,'2026-10-13','EFT','OTHER',now())`)).rejects.toThrow(/issued invoices/);
    await expect(raw(`INSERT INTO "Payment" ("id","ownerId","invoiceId","amountCents","receivedOn","method","label","createdAt") VALUES (gen_random_uuid(),'${s.ownerId}','${s.id}',0,'2026-10-13','EFT','OTHER',now())`)).rejects.toThrow();
  });

  it("is scoped to its owner", async () => {
    const s = await issuedMilestoneInvoice();
    const p = await pay(s.ownerId, s.id, "100");
    const other = await newOwner();
    await expect(pay(other, s.id, "100")).rejects.toThrow();
    await expect(reversePayment(other, p, { reason: "x" })).rejects.toThrow();
  });
});

describe("cancelling (INV6)", () => {
  it("needs a reason and no active payments", async () => {
    const s = await issuedMilestoneInvoice();
    await expect(cancelInvoice(s.ownerId, s.id, { reason: " " })).rejects.toThrow();
    const p = await pay(s.ownerId, s.id, "10");
    await expect(cancelInvoice(s.ownerId, s.id, { reason: "Oops" })).rejects.toMatchObject({ code: "INVOICE_HAS_PAYMENTS" });
    await reversePayment(s.ownerId, p, { reason: "Mistake" }, OCT_13);
    await cancelInvoice(s.ownerId, s.id, { reason: "Oops" });
    const inv = (await getInvoice(s.ownerId, s.id))!;
    expect(inv.status).toBe("cancelled");
    expect(inv.displayStatus).toBe("cancelled");
    expect(inv.cancelReason).toBe("Oops");
    expect(await db.auditLog.count({ where: { ownerId: s.ownerId, entityId: s.id, action: "status.cancelled" } })).toBe(1);
  });

  it("a draft cannot be cancelled, and a cancelled invoice cannot be revived", async () => {
    const s = await setupAcceptedQuotation();
    const draft = await createMilestoneInvoice(s.ownerId, s.quotationId, s.milestoneIds[0]!);
    await expect(cancelInvoice(s.ownerId, draft, { reason: "x" })).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    await issue(s.ownerId, draft);
    await cancelInvoice(s.ownerId, draft, { reason: "x" });
    await expect(issue(s.ownerId, draft)).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });
});

describe("quotation to invoice (the milestone gate)", () => {
  it("later rate changes leave issued totals unchanged", async () => {
    const s = await issuedMilestoneInvoice();
    await db.rateSetting.updateMany({ where: { ownerId: s.ownerId }, data: { hourlyCents: 1n } });
    expect((await getInvoice(s.ownerId, s.id))!.totalCents).toBe(1_853_450);
    expect((await getQuotation(s.ownerId, s.quotationId))!.totalCents).toBe(3_706_900);
  });
});
