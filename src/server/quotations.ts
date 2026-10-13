import type { Prisma } from "@prisma/client";
import { addDays, todayInJohannesburg, type CalendarDate } from "@/domain/dates";
import type { Currency } from "@/domain/money";
import { formatDocumentNumber } from "@/domain/numbering";
import { evaluateDraft } from "@/domain/pricing/draft";
import {
  acceptanceSchema,
  quotationDraftSchema,
  rejectionSchema,
  type QuotationDraftInput,
} from "@/domain/schemas";
import {
  buildPaymentSchedule,
  buildQuotationContent,
  buildQuotationDocument,
  type BusinessSnapshot,
  type ClientSnapshot,
  type QuotationDocument,
  type QuotationLineContent,
} from "@/domain/quotation";
import { deriveQuotationStatus, type StoredQuotationStatus } from "@/domain/status";
import { assertQuotationMove } from "@/domain/transitions";
import { audit } from "./audit";
import { big, dateFromDb, dateToDb, dstr, num } from "./convert";
import { db } from "./db";
import { ServiceError } from "./errors";
import { rowsToDraft, toContext } from "./estimates";
import { readFile, storeFile } from "./files";
import { renderQuotationPdf, type PdfLogo } from "./pdf/quotation-pdf";
import { getPricingSettings } from "./settings";

type Tx = Prisma.TransactionClient;

export interface QuotationDTO {
  id: string;
  number: string | null;
  /** The stored status. */
  status: StoredQuotationStatus;
  /** What to display: a sent quotation past its expiry date is expired without anyone updating it (QUO3). */
  displayStatus: StoredQuotationStatus;
  title: string;
  clientId: string;
  clientName: string;
  projectId: string;
  projectName: string;
  currency: Currency;
  issueDate: string | null;
  expiryDate: string | null;
  scope: string;
  deliverables: string;
  exclusions: string;
  timeline: string;
  revisionPolicy: string;
  terms: string;
  lines: QuotationLineContent[];
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  milestones: { label: string; percent: string; amountCents: number }[];
  acceptedAt: string | null;
  acceptedBy: string;
  rejectedAt: string | null;
  rejectionReason: string;
  hasPdf: boolean;
  estimateId: string | null;
}

const include = {
  lines: { orderBy: { position: "asc" } },
  milestones: { orderBy: { position: "asc" } },
  client: true,
  project: { select: { name: true, code: true } },
} as const;
type Row = Prisma.QuotationGetPayload<{ include: typeof include }>;

const today = (now = new Date()): CalendarDate => todayInJohannesburg(now);

function toDTO(q: Row, now = new Date()): QuotationDTO {
  const expiry = dateFromDb(q.expiryDate);
  const stored = q.status.toLowerCase() as StoredQuotationStatus;
  return {
    id: q.id,
    number: q.number,
    status: stored,
    displayStatus: expiry ? deriveQuotationStatus(stored, expiry, today(now)) : stored,
    title: q.title,
    clientId: q.clientId,
    clientName: q.client.name,
    projectId: q.projectId,
    projectName: q.project.name,
    currency: q.currency,
    issueDate: dateFromDb(q.issueDate),
    expiryDate: expiry,
    scope: q.scope,
    deliverables: q.deliverables,
    exclusions: q.exclusions,
    timeline: q.timeline,
    revisionPolicy: q.revisionPolicy,
    terms: q.terms,
    lines: q.lines.map((l) => ({
      kind: l.kind,
      description: l.description,
      detail: l.detail,
      amountCents: num(l.amountCents),
    })),
    subtotalCents: num(q.subtotalCents),
    discountCents: num(q.discountCents),
    totalCents: num(q.totalCents),
    milestones: q.milestones.map((m) => ({ label: m.label, percent: dstr(m.percent), amountCents: num(m.amountCents) })),
    acceptedAt: dateFromDb(q.acceptedAt),
    acceptedBy: q.acceptedBy ?? "",
    rejectedAt: dateFromDb(q.rejectedAt),
    rejectionReason: q.rejectionReason ?? "",
    hasPdf: q.pdfFileId !== null,
    estimateId: q.estimateId,
  };
}

export async function listQuotations(ownerId: string, now = new Date(), scope: { clientId?: string; projectId?: string } = {}): Promise<QuotationDTO[]> {
  const rows = await db.quotation.findMany({ where: { ownerId, ...scope }, include, orderBy: { createdAt: "desc" } });
  return rows.map((r) => toDTO(r, now));
}

export async function getQuotation(ownerId: string, id: string, now = new Date()): Promise<QuotationDTO | null> {
  const q = await db.quotation.findFirst({ where: { id, ownerId }, include });
  return q ? toDTO(q, now) : null;
}

/** Quotations whose estimate is this one, for the estimate page. */
export async function quotationsForEstimate(ownerId: string, estimateId: string) {
  const rows = await db.quotation.findMany({
    where: { ownerId, estimateId },
    select: { id: true, number: true, status: true },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((r) => ({ id: r.id, number: r.number, status: r.status.toLowerCase() as StoredQuotationStatus }));
}

// ---------------------------------------------------------------------------------------------
// Create (QUO1)
// ---------------------------------------------------------------------------------------------

/** Creates a draft from a READY estimate, copying only the whitelisted client-facing fields. */
export async function createQuotationFromEstimate(ownerId: string, estimateId: string): Promise<string> {
  const e = await db.estimate.findFirst({
    where: { id: estimateId, ownerId },
    include: { lines: { orderBy: { position: "asc" } }, project: { include: { client: true } } },
  });
  if (!e) throw new ServiceError("Estimate not found.");
  if (e.status !== "READY") throw new ServiceError("Mark the estimate ready before creating a quotation.");
  if (e.project.client.archivedAt) throw new ServiceError("This client is archived. Unarchive it to quote them.");

  const settingsRow = await db.businessSettings.findUnique({ where: { ownerId } });
  const pricing = await getPricingSettings(ownerId, e.currency);
  const draft = rowsToDraft({ ...e, project: { name: e.project.name, client: { name: e.project.client.name } } });
  const evaluated = evaluateDraft(draft, toContext(pricing));
  if (!evaluated.ok) throw new ServiceError("This estimate no longer prices cleanly. Open it and fix the highlighted problems.", evaluated.issues);
  if (evaluated.result.breakdown.totalCents <= 0) throw new ServiceError("An estimate with a zero total cannot be quoted.");

  const content = buildQuotationContent(draft, evaluated.result, e.currency);
  const defaults = (settingsRow?.defaultMilestones as { label: string; percent: string }[] | undefined) ?? [];
  const schedule = buildPaymentSchedule(content.totalCents, defaults);

  return db.$transaction(async (tx) => {
    const q = await tx.quotation.create({
      data: {
        ownerId,
        clientId: e.project.clientId,
        projectId: e.projectId,
        estimateId: e.id,
        title: e.title,
        scope: e.project.description ?? "",
        revisionPolicy: settingsRow?.revisionPolicy ?? "",
        terms: settingsRow?.termsAndConditions ?? "",
        currency: e.currency,
        vatMode: "NONE",
        subtotalCents: big(content.subtotalCents),
        discountCents: big(content.discountCents),
        vatCents: big(0),
        totalCents: big(content.totalCents),
      },
    });
    await tx.quotationLine.createMany({
      data: content.lines.map((l, i) => ({
        ownerId,
        quotationId: q.id,
        position: i,
        kind: l.kind,
        description: l.description,
        detail: l.detail,
        amountCents: big(l.amountCents),
      })),
    });
    await tx.quotationMilestone.createMany({
      data: schedule.map((m, i) => ({
        ownerId,
        quotationId: q.id,
        position: i,
        label: m.label,
        percent: m.percent,
        amountCents: big(m.amountCents),
      })),
    });
    await audit(tx, ownerId, "quotation", q.id, "create", { estimateId: e.id });
    return q.id;
  });
}

// ---------------------------------------------------------------------------------------------
// Edit a draft (QUO2: only drafts are editable)
// ---------------------------------------------------------------------------------------------

export async function updateDraftQuotation(ownerId: string, id: string, input: QuotationDraftInput): Promise<void> {
  const v = quotationDraftSchema.parse(input);
  await db.$transaction(async (tx) => {
    const q = await lockQuotation(tx, ownerId, id);
    if (q.status !== "DRAFT") throw new ServiceError("Only a draft can be edited. Duplicate this quotation to make changes.");
    await tx.quotation.update({
      where: { id },
      data: {
        title: v.title,
        scope: v.scope,
        deliverables: v.deliverables,
        exclusions: v.exclusions,
        timeline: v.timeline,
        revisionPolicy: v.revisionPolicy,
        terms: v.terms,
      },
    });
    if (v.milestones) {
      const schedule = buildPaymentSchedule(num(q.totalCents), v.milestones);
      await tx.quotationMilestone.deleteMany({ where: { quotationId: id } });
      await tx.quotationMilestone.createMany({
        data: schedule.map((m, i) => ({
          ownerId,
          quotationId: id,
          position: i,
          label: m.label,
          percent: m.percent,
          amountCents: big(m.amountCents),
        })),
      });
    }
  });
}

export async function deleteDraftQuotation(ownerId: string, id: string): Promise<void> {
  await db.$transaction(async (tx) => {
    const q = await lockQuotation(tx, ownerId, id);
    if (q.status !== "DRAFT") throw new ServiceError("Only a draft can be deleted. Sent quotations are kept as records.");
    await tx.quotationLine.deleteMany({ where: { quotationId: id } });
    await tx.quotationMilestone.deleteMany({ where: { quotationId: id } });
    await tx.quotation.delete({ where: { id } });
    await audit(tx, ownerId, "quotation", id, "delete.draft");
  });
}

/** Locks the quotation row for the rest of the transaction, scoped to the owner. */
export async function lockQuotation(tx: Tx, ownerId: string, id: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "Quotation" WHERE "id" = ${id} AND "ownerId" = ${ownerId} FOR UPDATE`;
  if (rows.length === 0) throw new ServiceError("Quotation not found.");
  return tx.quotation.findUniqueOrThrow({ where: { id } });
}

// ---------------------------------------------------------------------------------------------
// Send (QUO4, QUO7): number, snapshot, PDF and freeze in ONE transaction
// ---------------------------------------------------------------------------------------------

export interface SendDeps {
  now?: Date;
  /** Injectable so tests can fail or speed up rendering. */
  renderPdf?: (doc: QuotationDocument, logo: PdfLogo) => Promise<Uint8Array>;
}

export async function loadLogo(tx: Tx, ownerId: string, logoFileId: string | null): Promise<PdfLogo> {
  if (!logoFileId) return null;
  const f = await tx.storedFile.findFirst({ where: { id: logoFileId, ownerId } });
  if (!f?.data) return null;
  return { data: Buffer.from(f.data), format: f.contentType === "image/png" ? "png" : "jpg" };
}

export function documentFromRows(
  q: Pick<Row, "number" | "currency" | "title" | "scope" | "deliverables" | "exclusions" | "timeline" | "revisionPolicy" | "terms" | "subtotalCents" | "discountCents" | "totalCents"> & {
    issueDate: Date | null;
    expiryDate: Date | null;
    lines: Row["lines"];
    milestones: Row["milestones"];
  },
  business: BusinessSnapshot,
  client: ClientSnapshot,
  projectName: string,
): QuotationDocument {
  return buildQuotationDocument({
    number: q.number,
    issueDate: dateFromDb(q.issueDate),
    expiryDate: dateFromDb(q.expiryDate),
    currency: q.currency,
    business,
    client,
    projectName,
    title: q.title,
    scope: q.scope,
    deliverables: q.deliverables,
    exclusions: q.exclusions,
    timeline: q.timeline,
    revisionPolicy: q.revisionPolicy,
    terms: q.terms,
    content: {
      lines: q.lines.map((l) => ({ kind: l.kind, description: l.description, detail: l.detail, amountCents: num(l.amountCents) })),
      subtotalCents: num(q.subtotalCents),
      discountCents: num(q.discountCents),
      totalCents: num(q.totalCents),
    },
    schedule: q.milestones.map((m) => ({ label: m.label, percent: dstr(m.percent), amountCents: num(m.amountCents) })),
  });
}

export const businessSnapshot = (s: Prisma.BusinessSettingsGetPayload<object>): BusinessSnapshot => ({
  legalName: s.legalName,
  tradingName: s.tradingName,
  registrationNumber: s.registrationNumber,
  address: s.address,
  email: s.email,
  phone: s.phone,
  logoFileId: s.logoFileId,
});

export const clientSnapshot = (c: Prisma.ClientGetPayload<object>): ClientSnapshot => ({
  name: c.name,
  companyName: c.companyName,
  contactPerson: c.contactPerson,
  email: c.email,
  phone: c.phone,
  address: c.address,
  registrationNumber: c.registrationNumber,
});

/**
 * QUO4/QUO7. Inside one database transaction: lock the quotation and the counter row, allocate the
 * next number, copy business and client details, render and store the PDF, and freeze the record.
 * If anything fails, including the PDF, the transaction rolls back and no number is consumed.
 */
export async function sendQuotation(ownerId: string, id: string, deps: SendDeps = {}): Promise<{ number: string }> {
  const now = deps.now ?? new Date();
  const render = deps.renderPdf ?? renderQuotationPdf;
  const isoToday = today(now);

  return db.$transaction(
    async (tx) => {
      await lockQuotation(tx, ownerId, id);
      const q = await tx.quotation.findUniqueOrThrow({ where: { id }, include });
      assertQuotationMove(q.status.toLowerCase() as StoredQuotationStatus, "sent", { expiryDate: isoToday, today: isoToday });

      const settings = await tx.businessSettings.findUnique({ where: { ownerId } });
      if (!settings || settings.legalName.trim() === "") {
        throw new ServiceError("Add your business details in Settings before sending a quotation.");
      }
      if (q.lines.filter((l) => l.kind !== "RECURRING").length === 0 || num(q.totalCents) <= 0) {
        throw new ServiceError("A quotation needs priced lines before it can be sent.");
      }
      if (q.client.archivedAt) throw new ServiceError("This client is archived. Unarchive it first.");

      // The counter row is locked for the rest of this transaction: concurrent sends queue here,
      // and a rollback leaves the counter untouched, so numbers have no gaps.
      const counter = await tx.$queryRaw<{ id: string; next: number }[]>`
        SELECT "id", "next" FROM "NumberCounter" WHERE "ownerId" = ${ownerId} AND "kind"::text = 'QUOTATION' FOR UPDATE`;
      const c = counter[0];
      if (!c) throw new ServiceError("Numbering is not set up. Open Settings once to initialise it.");

      const issueDate = isoToday;
      const expiryDate = addDays(issueDate, settings.quotationValidityDays);
      const number = formatDocumentNumber(settings.quotationPattern, c.next, Number(issueDate.slice(0, 4)), {
        project: q.project.code,
        client: q.client.code,
      }).trim();
      await tx.numberCounter.update({ where: { id: c.id }, data: { next: c.next + 1 } });

      const business = businessSnapshot(settings);
      const client = clientSnapshot(q.client);
      const doc = documentFromRows(
        { ...q, number, issueDate: dateToDb(issueDate), expiryDate: dateToDb(expiryDate) },
        business,
        client,
        q.project.name,
      );
      const pdf = await render(doc, await loadLogo(tx, ownerId, settings.logoFileId));
      const file = await storeFile(tx, ownerId, "QUOTATION_PDF", pdf, "application/pdf");

      await tx.quotation.update({
        where: { id },
        data: {
          status: "SENT",
          number,
          issueDate: dateToDb(issueDate),
          expiryDate: dateToDb(expiryDate),
          revisionPolicy: q.revisionPolicy,
          businessSnapshot: business as unknown as Prisma.InputJsonValue,
          clientSnapshot: client as unknown as Prisma.InputJsonValue,
          sentAt: now,
          pdfFileId: file.id,
        },
      });
      if ((await tx.project.findUnique({ where: { id: q.projectId }, select: { status: true } }))?.status === "LEAD") {
        await tx.project.update({ where: { id: q.projectId }, data: { status: "QUOTED" } });
      }
      await audit(tx, ownerId, "quotation", id, "status.sent", { number });
      return { number };
    },
    { maxWait: 30_000, timeout: 60_000 },
  );
}

// ---------------------------------------------------------------------------------------------
// Accept / reject (QUO8), duplicate, PDF
// ---------------------------------------------------------------------------------------------

export async function acceptQuotation(ownerId: string, id: string, input: { acceptedBy?: string }, now = new Date()): Promise<void> {
  const v = acceptanceSchema.parse(input);
  const isoToday = today(now);
  await db.$transaction(async (tx) => {
    const q = await lockQuotation(tx, ownerId, id);
    assertQuotationMove(q.status.toLowerCase() as StoredQuotationStatus, "accepted", {
      expiryDate: dateFromDb(q.expiryDate) ?? isoToday,
      today: isoToday,
    });
    await tx.quotation.update({ where: { id }, data: { status: "ACCEPTED", acceptedAt: dateToDb(isoToday), acceptedBy: v.acceptedBy ?? null } });
    const p = await tx.project.findUnique({ where: { id: q.projectId }, select: { status: true } });
    if (p?.status === "LEAD" || p?.status === "QUOTED") await tx.project.update({ where: { id: q.projectId }, data: { status: "ACTIVE" } });
    await audit(tx, ownerId, "quotation", id, "status.accepted");
  });
}

export async function rejectQuotation(ownerId: string, id: string, input: { reason?: string }, now = new Date()): Promise<void> {
  const v = rejectionSchema.parse(input);
  const isoToday = today(now);
  await db.$transaction(async (tx) => {
    const q = await lockQuotation(tx, ownerId, id);
    assertQuotationMove(q.status.toLowerCase() as StoredQuotationStatus, "rejected", {
      expiryDate: dateFromDb(q.expiryDate) ?? isoToday,
      today: isoToday,
    });
    await tx.quotation.update({ where: { id }, data: { status: "REJECTED", rejectedAt: dateToDb(isoToday), rejectionReason: v.reason ?? null } });
    await audit(tx, ownerId, "quotation", id, "status.rejected");
  });
}

/** Changing a sent quotation means duplicating it as a new draft (QUO2); an expired one is duplicated to extend it (QUO3). */
export async function duplicateQuotation(ownerId: string, id: string): Promise<string> {
  return db.$transaction(async (tx) => {
    const src = await tx.quotation.findFirst({ where: { id, ownerId }, include: { lines: true, milestones: true } });
    if (!src) throw new ServiceError("Quotation not found.");
    const copy = await tx.quotation.create({
      data: {
        ownerId,
        clientId: src.clientId,
        projectId: src.projectId,
        estimateId: src.estimateId,
        title: src.title,
        scope: src.scope,
        deliverables: src.deliverables,
        exclusions: src.exclusions,
        timeline: src.timeline,
        revisionPolicy: src.revisionPolicy,
        terms: src.terms,
        currency: src.currency,
        vatMode: src.vatMode,
        subtotalCents: src.subtotalCents,
        discountCents: src.discountCents,
        vatCents: src.vatCents,
        totalCents: src.totalCents,
      },
    });
    await tx.quotationLine.createMany({
      data: src.lines.map((l) => ({ ownerId, quotationId: copy.id, position: l.position, kind: l.kind, description: l.description, detail: l.detail, amountCents: l.amountCents })),
    });
    await tx.quotationMilestone.createMany({
      data: src.milestones.map((m) => ({ ownerId, quotationId: copy.id, position: m.position, label: m.label, percent: m.percent, amountCents: m.amountCents })),
    });
    await audit(tx, ownerId, "quotation", copy.id, "duplicate", { from: id });
    return copy.id;
  });
}

/** The stored PDF, served exactly as it was made at send time (QUO7). */
export async function getQuotationPdf(ownerId: string, id: string) {
  const q = await db.quotation.findFirst({ where: { id, ownerId }, select: { pdfFileId: true, number: true } });
  if (!q?.pdfFileId) return null;
  const f = await readFile(ownerId, q.pdfFileId);
  return f ? { ...f, number: q.number } : null;
}

/** On-screen view of any quotation: a draft uses live details, a sent one uses its own snapshot. */
export async function getQuotationDocument(ownerId: string, id: string): Promise<QuotationDocument | null> {
  const q = await db.quotation.findFirst({ where: { id, ownerId }, include });
  if (!q) return null;
  let business = q.businessSnapshot as unknown as BusinessSnapshot | null;
  let client = q.clientSnapshot as unknown as ClientSnapshot | null;
  if (!business || !client) {
    const s = await db.businessSettings.findUnique({ where: { ownerId } });
    business = s
      ? businessSnapshot(s)
      : { legalName: "", tradingName: null, registrationNumber: null, address: "", email: "", phone: "", logoFileId: null };
    client = clientSnapshot(q.client);
  }
  return documentFromRows(q, business, client, q.project.name);
}
