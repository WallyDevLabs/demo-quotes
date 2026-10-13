import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { createClient, createProject } from "@/server/clients";
import {
  acceptQuotation,
  createQuotationFromEstimate,
  deleteDraftQuotation,
  duplicateQuotation,
  getQuotation,
  getQuotationDocument,
  getQuotationPdf,
  listQuotations,
  rejectQuotation,
  sendQuotation,
  updateDraftQuotation,
} from "@/server/quotations";
import { saveEstimate, setEstimateReady } from "@/server/estimates";
import { fakePdf, newOwner, setupReadyEstimate, workedExample, configureRates } from "./helpers";

const OCT_13 = new Date("2026-10-13T10:00:00Z"); // 12:00 in Johannesburg
const send = (ownerId: string, id: string, now = OCT_13) => sendQuotation(ownerId, id, { now, renderPdf: fakePdf });
const draftOf = async () => {
  const s = await setupReadyEstimate();
  const id = await createQuotationFromEstimate(s.ownerId, s.estimateId);
  return { ...s, id };
};
const raw = (sql: string) => db.$executeRawUnsafe(sql);

describe("creating a quotation from an estimate (QUO1)", () => {
  it("needs a READY estimate", async () => {
    const s = await setupReadyEstimate();
    await setEstimateReady(s.ownerId, s.estimateId, false);
    await expect(createQuotationFromEstimate(s.ownerId, s.estimateId)).rejects.toThrow(/ready/i);
  });

  it("copies only client-facing lines and reconciles to R37,069.00", async () => {
    const { ownerId, id } = await draftOf();
    const q = (await getQuotation(ownerId, id))!;
    expect(q.status).toBe("draft");
    expect(q.number).toBeNull();
    expect(q.totalCents).toBe(3_706_900);
    expect(q.subtotalCents).toBe(3_902_000);
    expect(q.lines.map((l) => l.kind)).toEqual(["LABOUR", "LABOUR", "URGENCY", "CONTINGENCY", "EXPENSE", "RECURRING"]);
    const text = JSON.stringify(q).toLowerCase();
    for (const w of ["markup", "effective", "internal", "1200"]) expect(text).not.toContain(w);
    expect(q.milestones).toEqual([{ label: "Full payment", percent: "100.00", amountCents: 3_706_900 }]);
  });

  it("is not changed by later edits to the estimate or to rates", async () => {
    const s = await setupReadyEstimate();
    const id = await createQuotationFromEstimate(s.ownerId, s.estimateId);
    const before = await getQuotation(s.ownerId, id);
    const d = workedExample();
    d.labour[0]!.hours = "99";
    await saveEstimate(s.ownerId, s.estimateId, { meta: { projectId: s.projectId, title: "Changed", currency: "ZAR", complexity: null }, draft: d });
    expect(await getQuotation(s.ownerId, id)).toEqual(before);
  });

  it("is scoped to its owner", async () => {
    const s = await setupReadyEstimate();
    const other = await newOwner();
    await expect(createQuotationFromEstimate(other, s.estimateId)).rejects.toThrow();
  });
});

describe("editing a draft (QUO2)", () => {
  it("saves text and a milestone schedule that sums to the total", async () => {
    const { ownerId, id } = await draftOf();
    await updateDraftQuotation(ownerId, id, {
      title: "Phase 1",
      scope: "Build it.",
      milestones: [{ label: "Deposit", percent: "33.33" }, { label: "Build", percent: "33.33" }, { label: "Final", percent: "33.34" }],
    });
    const q = (await getQuotation(ownerId, id))!;
    expect(q.scope).toBe("Build it.");
    expect(q.milestones.reduce((s, m) => s + m.amountCents, 0)).toBe(3_706_900);
  });

  it("rejects milestones that do not total 100", async () => {
    const { ownerId, id } = await draftOf();
    await expect(updateDraftQuotation(ownerId, id, { milestones: [{ label: "A", percent: "60" }, { label: "B", percent: "30" }] })).rejects.toThrow();
  });

  it("can be deleted while a draft", async () => {
    const { ownerId, id } = await draftOf();
    await deleteDraftQuotation(ownerId, id);
    expect(await getQuotation(ownerId, id)).toBeNull();
  });
});

describe("sending (QUO4, QUO7)", () => {
  it("allocates the number, dates, snapshot and stored PDF, and freezes it", async () => {
    const { ownerId, id } = await draftOf();
    const { number } = await send(ownerId, id);
    expect(number).toBe("QUO20260001");
    const q = (await getQuotation(ownerId, id, OCT_13))!;
    expect(q.status).toBe("sent");
    expect(q.number).toBe("QUO20260001");
    expect(q.issueDate).toBe("2026-10-13");
    expect(q.expiryDate).toBe("2026-11-12");
    const pdf = await getQuotationPdf(ownerId, id);
    expect(pdf!.bytes.toString().startsWith("%PDF")).toBe(true);
    expect(await db.auditLog.count({ where: { ownerId, entity: "quotation", entityId: id, action: "status.sent" } })).toBe(1);
  });

  it("uses the Johannesburg calendar day for the issue date", async () => {
    const { ownerId, id } = await draftOf();
    await send(ownerId, id, new Date("2026-10-31T22:30:00Z")); // already 1 Nov in Johannesburg
    expect((await getQuotation(ownerId, id))!.issueDate).toBe("2026-11-01");
  });

  it("needs business details, and a failed send keeps the quotation a draft", async () => {
    const s = await setupReadyEstimate({ business: false });
    const id = await createQuotationFromEstimate(s.ownerId, s.estimateId);
    await expect(send(s.ownerId, id)).rejects.toThrow(/business details/i);
    expect((await getQuotation(s.ownerId, id))!.status).toBe("draft");
  });

  it("cannot be sent twice", async () => {
    const { ownerId, id } = await draftOf();
    await send(ownerId, id);
    await expect(send(ownerId, id)).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });

  it("supports {PRJ} and {CLIENT} in the pattern, and refuses a missing code without using a number", async () => {
    const s = await setupReadyEstimate({ projectCode: null });
    await db.businessSettings.update({ where: { ownerId: s.ownerId }, data: { quotationPattern: "QUO-{PRJ}-{SEQ:3}" } });
    const id = await createQuotationFromEstimate(s.ownerId, s.estimateId);
    await expect(send(s.ownerId, id)).rejects.toThrow(/project code/i);
    expect((await db.numberCounter.findFirstOrThrow({ where: { ownerId: s.ownerId, kind: "QUOTATION" } })).next).toBe(1);

    await db.project.update({ where: { id: s.projectId }, data: { code: "DISP" } });
    expect((await send(s.ownerId, id)).number).toBe("QUO-DISP-001");
  });

  it("a rolled back send consumes no number and stores no file", async () => {
    const { ownerId, id } = await draftOf();
    await expect(
      sendQuotation(ownerId, id, { now: OCT_13, renderPdf: async () => { throw new Error("render failed"); } }),
    ).rejects.toThrow("render failed");
    expect((await db.numberCounter.findFirstOrThrow({ where: { ownerId, kind: "QUOTATION" } })).next).toBe(1);
    expect(await db.storedFile.count({ where: { ownerId, kind: "QUOTATION_PDF" } })).toBe(0);
    expect((await getQuotation(ownerId, id))!.status).toBe("draft");
    expect((await send(ownerId, id)).number).toBe("QUO20260001");
  });

  it("twenty concurrent sends produce twenty unique, consecutive numbers", async () => {
    const s = await setupReadyEstimate();
    const ids: string[] = [];
    for (let i = 0; i < 20; i++) ids.push(await createQuotationFromEstimate(s.ownerId, s.estimateId));
    const results = await Promise.all(ids.map((id) => send(s.ownerId, id)));
    const numbers = results.map((r) => r.number).sort();
    expect(new Set(numbers).size).toBe(20);
    expect(numbers).toEqual(Array.from({ length: 20 }, (_, i) => `QUO2026${String(i + 1).padStart(4, "0")}`));
    expect((await db.numberCounter.findFirstOrThrow({ where: { ownerId: s.ownerId, kind: "QUOTATION" } })).next).toBe(21);
  }, 60_000);
});

describe("a sent quotation cannot be edited (the milestone gate)", () => {
  it("is rejected by the service", async () => {
    const { ownerId, id } = await draftOf();
    await send(ownerId, id);
    await expect(updateDraftQuotation(ownerId, id, { scope: "changed" })).rejects.toThrow(/draft/i);
    await expect(deleteDraftQuotation(ownerId, id)).rejects.toThrow(/draft/i);
  });

  it("is rejected by the database, even for direct updates", async () => {
    const { ownerId, id } = await draftOf();
    await send(ownerId, id);
    const line = await db.quotationLine.findFirstOrThrow({ where: { quotationId: id } });
    const ms = await db.quotationMilestone.findFirstOrThrow({ where: { quotationId: id } });
    const file = await db.storedFile.findFirstOrThrow({ where: { ownerId, kind: "QUOTATION_PDF" } });

    await expect(raw(`UPDATE "Quotation" SET "totalCents" = 1 WHERE "id" = '${id}'`)).rejects.toThrow(/frozen/);
    await expect(raw(`UPDATE "Quotation" SET "scope" = 'x' WHERE "id" = '${id}'`)).rejects.toThrow(/frozen/);
    await expect(raw(`UPDATE "Quotation" SET "number" = 'HACK' WHERE "id" = '${id}'`)).rejects.toThrow(/frozen/);
    await expect(raw(`DELETE FROM "Quotation" WHERE "id" = '${id}'`)).rejects.toThrow(/frozen/);
    await expect(raw(`UPDATE "QuotationLine" SET "amountCents" = 1 WHERE "id" = '${line.id}'`)).rejects.toThrow(/frozen/);
    await expect(raw(`DELETE FROM "QuotationLine" WHERE "id" = '${line.id}'`)).rejects.toThrow(/frozen/);
    await expect(raw(`UPDATE "QuotationMilestone" SET "amountCents" = 1 WHERE "id" = '${ms.id}'`)).rejects.toThrow(/frozen/);
    await expect(raw(`INSERT INTO "QuotationMilestone" ("id","ownerId","quotationId","position","label","percent","amountCents") VALUES (gen_random_uuid(),'${ownerId}','${id}',9,'x',1,1)`)).rejects.toThrow(/frozen/);
    await expect(raw(`UPDATE "StoredFile" SET "sha256" = 'x' WHERE "id" = '${file.id}'`)).rejects.toThrow(/immutable/);
    await expect(raw(`DELETE FROM "StoredFile" WHERE "id" = '${file.id}'`)).rejects.toThrow(/immutable/);

    const q = (await getQuotation(ownerId, id))!;
    expect(q.totalCents).toBe(3_706_900);
    expect(q.number).toBe("QUO20260001");
  });

  it("enforces the allowed status moves in the database", async () => {
    const { ownerId, id } = await draftOf();
    await send(ownerId, id);
    await expect(raw(`UPDATE "Quotation" SET "status" = 'DRAFT' WHERE "id" = '${id}'`)).rejects.toThrow();
    await raw(`UPDATE "Quotation" SET "status" = 'ACCEPTED' WHERE "id" = '${id}'`); // sent -> accepted is allowed
    await expect(raw(`UPDATE "Quotation" SET "status" = 'SENT' WHERE "id" = '${id}'`)).rejects.toThrow();
    await expect(raw(`UPDATE "Quotation" SET "acceptedBy" = 'someone' WHERE "id" = '${id}'`)).rejects.toThrow(/final/);
  });
});

describe("accepting and rejecting (QUO3, QUO8)", () => {
  it("accepts with a date and name, and the project becomes active", async () => {
    const { ownerId, id, projectId } = await draftOf();
    await send(ownerId, id);
    await acceptQuotation(ownerId, id, { acceptedBy: "Thabo Mokoena" }, new Date("2026-10-20T08:00:00Z"));
    const q = (await getQuotation(ownerId, id))!;
    expect(q.status).toBe("accepted");
    expect(q.acceptedAt).toBe("2026-10-20");
    expect(q.acceptedBy).toBe("Thabo Mokoena");
    expect((await db.project.findUniqueOrThrow({ where: { id: projectId } })).status).toBe("ACTIVE");
  });

  it("can be accepted on its expiry date but not the day after", async () => {
    const a = await draftOf();
    await send(a.ownerId, a.id); // expires 2026-11-12
    await expect(acceptQuotation(a.ownerId, a.id, {}, new Date("2026-11-12T20:00:00Z"))).resolves.toBeUndefined(); // 22:00, still the 12th

    const b = await draftOf();
    await send(b.ownerId, b.id);
    await expect(acceptQuotation(b.ownerId, b.id, {}, new Date("2026-11-13T00:00:00Z"))).rejects.toMatchObject({ code: "QUOTATION_EXPIRED" });
  });

  it("shows a sent quotation past its expiry as expired without any update", async () => {
    const { ownerId, id } = await draftOf();
    await send(ownerId, id);
    expect((await getQuotation(ownerId, id, new Date("2026-11-12T10:00:00Z")))!.displayStatus).toBe("sent");
    const later = (await getQuotation(ownerId, id, new Date("2026-11-13T10:00:00Z")))!;
    expect(later.displayStatus).toBe("expired");
    expect(later.status).toBe("sent");
    expect((await listQuotations(ownerId, new Date("2026-11-13T10:00:00Z")))[0]!.displayStatus).toBe("expired");
  });

  it("rejects with an optional reason, and a draft cannot be accepted", async () => {
    const { ownerId, id } = await draftOf();
    await expect(acceptQuotation(ownerId, id, {})).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    await send(ownerId, id);
    await rejectQuotation(ownerId, id, { reason: "Budget" }, new Date("2026-10-15T08:00:00Z"));
    const q = (await getQuotation(ownerId, id))!;
    expect(q.status).toBe("rejected");
    expect(q.rejectionReason).toBe("Budget");
    await expect(acceptQuotation(ownerId, id, {})).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });
});

describe("duplicating (QUO2, QUO3)", () => {
  it("creates a new editable draft with no number from a sent quotation", async () => {
    const { ownerId, id } = await draftOf();
    await send(ownerId, id);
    const copyId = await duplicateQuotation(ownerId, id);
    const copy = (await getQuotation(ownerId, copyId))!;
    expect(copy.status).toBe("draft");
    expect(copy.number).toBeNull();
    expect(copy.expiryDate).toBeNull();
    expect(copy.totalCents).toBe(3_706_900);
    expect(copy.lines).toHaveLength(6);
    await updateDraftQuotation(ownerId, copyId, { scope: "Edited copy" });
    expect((await getQuotation(ownerId, id))!.scope).not.toBe("Edited copy");
    expect((await send(ownerId, copyId)).number).toBe("QUO20260002");
  });
});

describe("snapshots and stored PDFs", () => {
  it("later changes to settings or the client never alter a sent quotation or its stored PDF", async () => {
    const { ownerId, id, clientId } = await draftOf();
    await send(ownerId, id);
    const before = await getQuotationPdf(ownerId, id);
    const docBefore = await getQuotationDocument(ownerId, id);

    await db.businessSettings.update({ where: { ownerId }, data: { legalName: "Someone Else", quotationPattern: "ZZ{SEQ}" } });
    await db.client.update({ where: { id: clientId }, data: { name: "Renamed", companyName: "Renamed Co" } });
    await configureRates(ownerId);

    const after = await getQuotationPdf(ownerId, id);
    expect(createHash("sha256").update(after!.bytes).digest("hex")).toBe(before!.sha256);
    expect(after!.bytes.equals(before!.bytes)).toBe(true);
    expect(await getQuotationDocument(ownerId, id)).toEqual(docBefore);
    expect(docBefore!.business.name).toBe("Katlego Barayi");
    expect(docBefore!.client.name).toBe("Acme (Pty) Ltd");
  });

  it("a draft's PDF is not available until it is sent", async () => {
    const { ownerId, id } = await draftOf();
    expect(await getQuotationPdf(ownerId, id)).toBeNull();
  });

  it("another owner cannot read the stored PDF", async () => {
    const { ownerId, id } = await draftOf();
    await send(ownerId, id);
    expect(await getQuotationPdf(await newOwner(), id)).toBeNull();
    expect(await getQuotationPdf(ownerId, id)).not.toBeNull();
  });
});
