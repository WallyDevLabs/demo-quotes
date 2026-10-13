import { Prisma } from "@prisma/client";
import { addDays, todayInJohannesburg, type CalendarDate } from "@/domain/dates";
import {
  activePayments,
  assertCanRecordPayment,
  assertCanReverse,
  assertWithinCeiling,
  bankingIsComplete,
  buildInvoiceDocument,
  customInvoiceContent,
  isReversed,
  milestoneInvoiceContent,
  paidCents,
  type BankingSnapshot,
  type InvoiceContent,
  type InvoiceDocument,
  type PaymentEntry,
} from "@/domain/invoicing";
import { formatDocumentNumber } from "@/domain/numbering";
import { parseAmountToCents, type Currency } from "@/domain/money";
import type { BusinessSnapshot, ClientSnapshot } from "@/domain/quotation";
import {
  customInvoiceSchema,
  issueInvoiceSchema,
  paymentSchema,
  reasonSchema,
  type CustomInvoiceInput,
  type IssueInvoiceInput,
  type PaymentInput,
} from "@/domain/schemas";
import { deriveInvoiceStatus, type InvoiceDisplayStatus, type StoredInvoiceStatus } from "@/domain/status";
import { assertInvoiceMove } from "@/domain/transitions";
import type { FieldIssue } from "@/domain/pricing/engine";
import { audit } from "./audit";
import { big, dateFromDb, dateToDb, dstr, num } from "./convert";
import { db } from "./db";
import { ServiceError } from "./errors";
import { readFile, storeFile } from "./files";
import { renderInvoicePdf } from "./pdf/invoice-pdf";
import type { PdfLogo } from "./pdf/quotation-pdf";
import { businessSnapshot, clientSnapshot, loadLogo, lockQuotation } from "./quotations";

type Tx = Prisma.TransactionClient;

export interface PaymentDTO {
  id: string;
  amountCents: number;
  receivedOn: string;
  method: string;
  label: string;
  reference: string;
  notes: string;
  /** Set on a reversal row. */
  reversesPaymentId: string | null;
  reversalReason: string;
  /** True for an original payment that has been reversed. */
  reversed: boolean;
  createdAt: string;
}

export interface InvoiceDTO {
  id: string;
  number: string | null;
  status: StoredInvoiceStatus;
  /** Derived: paid, partially paid and overdue are never stored (INV5). */
  displayStatus: InvoiceDisplayStatus;
  overdue: boolean;
  partiallyPaid: boolean;
  quotationId: string | null;
  quotationNumber: string | null;
  clientId: string;
  clientName: string;
  projectId: string;
  projectName: string;
  currency: Currency;
  milestoneLabel: string | null;
  customReason: string;
  issueDate: string | null;
  dueDate: string | null;
  lines: { description: string; detail: string; amountCents: number }[];
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  paidCents: number;
  balanceCents: number;
  payments: PaymentDTO[];
  cancelledAt: string | null;
  cancelReason: string;
  hasPdf: boolean;
  paymentReference: string;
  zarValueAtIssueCents: number | null;
}

const include = {
  lines: { orderBy: { position: "asc" } },
  payments: { orderBy: { createdAt: "asc" } },
  client: true,
  project: { select: { name: true, code: true } },
  quotation: { select: { number: true, title: true } },
  milestone: { select: { label: true, percent: true } },
} as const;
type Row = Prisma.InvoiceGetPayload<{ include: typeof include }>;

const isoToday = (now = new Date()): CalendarDate => todayInJohannesburg(now);

export const entriesOf = (payments: { id: string; amountCents: bigint; reversesPaymentId: string | null }[]): PaymentEntry[] =>
  payments.map((p) => ({ id: p.id, amountCents: num(p.amountCents), reversesPaymentId: p.reversesPaymentId }));

function toDTO(i: Row, now = new Date()): InvoiceDTO {
  const entries = entriesOf(i.payments);
  const paid = paidCents(entries);
  const total = num(i.totalCents);
  const stored = i.status.toLowerCase() as StoredInvoiceStatus;
  // Drafts have no due date yet; the derivation only needs one for issued invoices.
  const d = deriveInvoiceStatus({
    stored,
    totalCents: total,
    paidCents: paid,
    dueDate: dateFromDb(i.dueDate) ?? isoToday(now),
    today: isoToday(now),
  });
  return {
    id: i.id,
    number: i.number,
    status: stored,
    displayStatus: d.status,
    overdue: d.overdue,
    partiallyPaid: d.partiallyPaid,
    quotationId: i.quotationId,
    quotationNumber: i.quotation?.number ?? null,
    clientId: i.clientId,
    clientName: i.client.name,
    projectId: i.projectId,
    projectName: i.project.name,
    currency: i.currency,
    milestoneLabel: i.milestone ? `${i.milestone.label} (${dstr(i.milestone.percent)}%)` : null,
    customReason: i.customReason ?? "",
    issueDate: dateFromDb(i.issueDate),
    dueDate: dateFromDb(i.dueDate),
    lines: i.lines.map((l) => ({ description: l.description, detail: l.detail, amountCents: num(l.amountCents) })),
    subtotalCents: num(i.subtotalCents),
    discountCents: num(i.discountCents),
    totalCents: total,
    paidCents: paid,
    balanceCents: d.balanceCents,
    payments: i.payments.map((p) => ({
      id: p.id,
      amountCents: num(p.amountCents),
      receivedOn: dateFromDb(p.receivedOn) ?? "",
      method: p.method,
      label: p.label,
      reference: p.reference ?? "",
      notes: p.notes ?? "",
      reversesPaymentId: p.reversesPaymentId,
      reversalReason: p.reversalReason ?? "",
      reversed: !p.reversesPaymentId && isReversed(entries, p.id),
      createdAt: p.createdAt.toISOString(),
    })),
    cancelledAt: i.cancelledAt ? i.cancelledAt.toISOString().slice(0, 10) : null,
    cancelReason: i.cancelReason ?? "",
    hasPdf: i.pdfFileId !== null,
    paymentReference: i.paymentReference ?? "",
    zarValueAtIssueCents: i.zarValueAtIssueCents === null ? null : num(i.zarValueAtIssueCents),
  };
}

export async function listInvoices(ownerId: string, now = new Date(), scope: { clientId?: string; projectId?: string } = {}): Promise<InvoiceDTO[]> {
  const rows = await db.invoice.findMany({ where: { ownerId, ...scope }, include, orderBy: { createdAt: "desc" } });
  return rows.map((r) => toDTO(r, now));
}

export async function getInvoice(ownerId: string, id: string, now = new Date()): Promise<InvoiceDTO | null> {
  const i = await db.invoice.findFirst({ where: { id, ownerId }, include });
  return i ? toDTO(i, now) : null;
}

// ---------------------------------------------------------------------------------------------
// What a quotation can still be invoiced for (INV2)
// ---------------------------------------------------------------------------------------------

export interface QuotationInvoicing {
  quotationId: string;
  currency: Currency;
  totalCents: number;
  invoicedCents: number;
  remainingCents: number;
  milestones: {
    id: string;
    label: string;
    percent: string;
    amountCents: number;
    invoiceId: string | null;
    invoiceNumber: string | null;
    invoiceStatus: StoredInvoiceStatus | null;
  }[];
  invoices: { id: string; number: string | null; status: StoredInvoiceStatus; totalCents: number; milestoneId: string | null; customReason: string }[];
}

export async function getQuotationInvoicing(ownerId: string, quotationId: string): Promise<QuotationInvoicing | null> {
  const q = await db.quotation.findFirst({
    where: { id: quotationId, ownerId },
    include: { milestones: { orderBy: { position: "asc" } }, invoices: { orderBy: { createdAt: "asc" } } },
  });
  if (!q) return null;
  const live = q.invoices.filter((i) => i.status !== "CANCELLED");
  const invoiced = live.reduce((s, i) => s + num(i.totalCents), 0);
  return {
    quotationId: q.id,
    currency: q.currency,
    totalCents: num(q.totalCents),
    invoicedCents: invoiced,
    remainingCents: num(q.totalCents) - invoiced,
    milestones: q.milestones.map((m) => {
      const inv = live.find((i) => i.milestoneId === m.id) ?? null;
      return {
        id: m.id,
        label: m.label,
        percent: dstr(m.percent),
        amountCents: num(m.amountCents),
        invoiceId: inv?.id ?? null,
        invoiceNumber: inv?.number ?? null,
        invoiceStatus: inv ? (inv.status.toLowerCase() as StoredInvoiceStatus) : null,
      };
    }),
    invoices: q.invoices.map((i) => ({
      id: i.id,
      number: i.number,
      status: i.status.toLowerCase() as StoredInvoiceStatus,
      totalCents: num(i.totalCents),
      milestoneId: i.milestoneId,
      customReason: i.customReason ?? "",
    })),
  };
}

// ---------------------------------------------------------------------------------------------
// Create drafts (INV1, INV2)
// ---------------------------------------------------------------------------------------------

async function loadAcceptedQuotation(tx: Tx, ownerId: string, quotationId: string) {
  await lockQuotation(tx, ownerId, quotationId); // serialises every invoice write for this quotation
  const q = await tx.quotation.findUniqueOrThrow({
    where: { id: quotationId },
    include: { invoices: { select: { id: true, totalCents: true, status: true } }, milestones: true },
  });
  if (q.status !== "ACCEPTED") throw new ServiceError("Invoices are created from an accepted quotation.");
  return q;
}

const existingTotals = (q: { invoices: { id: string; totalCents: bigint; status: string }[] }, exceptId?: string) =>
  q.invoices.filter((i) => i.id !== exceptId).map((i) => ({ totalCents: num(i.totalCents), status: i.status.toLowerCase() as StoredInvoiceStatus }));

async function writeDraft(
  tx: Tx,
  ownerId: string,
  q: { id: string; clientId: string; projectId: string; currency: Currency },
  content: InvoiceContent,
  extra: { milestoneId?: string; customReason?: string },
): Promise<string> {
  const inv = await tx.invoice.create({
    data: {
      ownerId,
      clientId: q.clientId,
      projectId: q.projectId,
      quotationId: q.id,
      milestoneId: extra.milestoneId ?? null,
      customReason: extra.customReason ?? null,
      currency: q.currency,
      vatMode: "NONE",
      subtotalCents: big(content.subtotalCents),
      discountCents: big(content.discountCents),
      vatCents: big(0),
      totalCents: big(content.totalCents),
    },
  });
  await tx.invoiceLine.createMany({
    data: content.lines.map((l, i) => ({ ownerId, invoiceId: inv.id, position: i, description: l.description, detail: l.detail, amountCents: big(l.amountCents) })),
  });
  await audit(tx, ownerId, "invoice", inv.id, "create", { quotationId: q.id });
  return inv.id;
}

/** INV1: invoice one milestone of an accepted quotation. A milestone is invoiced once; a cancelled invoice frees it. */
export async function createMilestoneInvoice(ownerId: string, quotationId: string, milestoneId: string): Promise<string> {
  try {
    return await db.$transaction(async (tx) => {
      const q = await loadAcceptedQuotation(tx, ownerId, quotationId);
      const m = q.milestones.find((x) => x.id === milestoneId);
      if (!m) throw new ServiceError("Milestone not found on this quotation.");
      const taken = await tx.invoice.findFirst({ where: { milestoneId, status: { not: "CANCELLED" } }, select: { number: true } });
      if (taken) throw new ServiceError(`This milestone has already been invoiced${taken.number ? ` (${taken.number})` : ""}.`);

      const content = milestoneInvoiceContent({
        label: m.label,
        percent: dstr(m.percent),
        amountCents: num(m.amountCents),
        quotationNumber: q.number ?? "",
        quotationTitle: q.title,
      });
      assertWithinCeiling(num(q.totalCents), existingTotals(q), content.totalCents, q.currency);
      return writeDraft(tx, ownerId, q, content, { milestoneId });
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new ServiceError("This milestone has already been invoiced.");
    }
    throw e;
  }
}

function customLines(input: CustomInvoiceInput): { reason: string; lines: { description: string; amountCents: number }[] } {
  const issues: FieldIssue[] = [];
  const v = customInvoiceSchema.parse(input);
  const lines = v.lines.map((l, i) => {
    try {
      return { description: l.description, amountCents: parseAmountToCents(l.amount) };
    } catch (e) {
      issues.push({ path: `lines.${i}.amount`, message: e instanceof Error ? e.message : "Enter an amount" });
      return { description: l.description, amountCents: 0 };
    }
  });
  if (issues.length) throw new ServiceError("Some fields need attention.", issues);
  return { reason: v.reason, lines };
}

/** INV1: a custom invoice, with a stated reason, still counts against the accepted total. */
export async function createCustomInvoice(ownerId: string, quotationId: string, input: CustomInvoiceInput): Promise<string> {
  const { reason, lines } = customLines(input);
  return db.$transaction(async (tx) => {
    const q = await loadAcceptedQuotation(tx, ownerId, quotationId);
    const content = customInvoiceContent(reason, lines, q.number ?? "");
    assertWithinCeiling(num(q.totalCents), existingTotals(q), content.totalCents, q.currency);
    return writeDraft(tx, ownerId, q, content, { customReason: reason });
  });
}

/** Only a custom draft has anything to edit; a milestone invoice is fixed by its milestone. */
export async function updateDraftCustomInvoice(ownerId: string, id: string, input: CustomInvoiceInput): Promise<void> {
  const { reason, lines } = customLines(input);
  await db.$transaction(async (tx) => {
    const found = await tx.invoice.findFirst({ where: { id, ownerId }, select: { quotationId: true } });
    if (!found?.quotationId) throw new ServiceError("Invoice not found.");
    const q = await loadAcceptedQuotation(tx, ownerId, found.quotationId);
    const inv = await tx.invoice.findUniqueOrThrow({ where: { id } });
    if (inv.status !== "DRAFT") throw new ServiceError("Only a draft invoice can be edited.");
    if (inv.milestoneId) throw new ServiceError("A milestone invoice is fixed by its milestone. Delete the draft to change it.");
    const content = customInvoiceContent(reason, lines, q.number ?? "");
    assertWithinCeiling(num(q.totalCents), existingTotals(q, id), content.totalCents, q.currency);
    await tx.invoiceLine.deleteMany({ where: { invoiceId: id } });
    await tx.invoiceLine.createMany({
      data: content.lines.map((l, i) => ({ ownerId, invoiceId: id, position: i, description: l.description, detail: l.detail, amountCents: big(l.amountCents) })),
    });
    await tx.invoice.update({
      where: { id },
      data: { customReason: reason, subtotalCents: big(content.subtotalCents), totalCents: big(content.totalCents) },
    });
  });
}

export async function deleteDraftInvoice(ownerId: string, id: string): Promise<void> {
  await db.$transaction(async (tx) => {
    const inv = await lockInvoice(tx, ownerId, id);
    if (inv.status !== "DRAFT") throw new ServiceError("Only a draft can be deleted. Issued invoices are kept as records; cancel it instead.");
    await tx.invoiceLine.deleteMany({ where: { invoiceId: id } });
    await tx.invoice.delete({ where: { id } });
    await audit(tx, ownerId, "invoice", id, "delete.draft");
  });
}

async function lockInvoice(tx: Tx, ownerId: string, id: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "Invoice" WHERE "id" = ${id} AND "ownerId" = ${ownerId} FOR UPDATE`;
  if (rows.length === 0) throw new ServiceError("Invoice not found.");
  return tx.invoice.findUniqueOrThrow({ where: { id } });
}

// ---------------------------------------------------------------------------------------------
// Issue (INV3, INV4, INV7): number, due date, snapshots, PDF and freeze in ONE transaction
// ---------------------------------------------------------------------------------------------

export interface IssueDeps {
  now?: Date;
  renderPdf?: (doc: InvoiceDocument, logo: PdfLogo) => Promise<Uint8Array>;
}

const emptyBank: BankingSnapshot = { bankName: "", accountName: "", accountNumber: "", branchCode: "", swiftCode: "", accountType: "", instructions: "" };

function bankingOf(json: unknown): BankingSnapshot {
  const b = (json ?? {}) as Partial<BankingSnapshot>;
  return { ...emptyBank, ...Object.fromEntries(Object.entries(b).map(([k, v]) => [k, String(v ?? "")])) };
}

export function invoiceDocumentFromRows(
  i: { number: string | null; issueDate: Date | null; dueDate: Date | null; currency: Currency; lines: Row["lines"]; subtotalCents: bigint; discountCents: bigint; totalCents: bigint; paymentReference: string | null },
  ctx: { business: BusinessSnapshot; client: ClientSnapshot; projectName: string; quotationNumber: string | null; banking: BankingSnapshot; paidCents: number },
): InvoiceDocument {
  return buildInvoiceDocument({
    number: i.number,
    issueDate: dateFromDb(i.issueDate),
    dueDate: dateFromDb(i.dueDate),
    currency: i.currency,
    business: ctx.business,
    client: ctx.client,
    projectName: ctx.projectName,
    quotationNumber: ctx.quotationNumber,
    content: {
      lines: i.lines.map((l) => ({ description: l.description, detail: l.detail, amountCents: num(l.amountCents) })),
      subtotalCents: num(i.subtotalCents),
      discountCents: num(i.discountCents),
      totalCents: num(i.totalCents),
    },
    paidCents: ctx.paidCents,
    banking: ctx.banking,
    paymentReference: i.paymentReference,
  });
}

/**
 * INV3/INV7. One transaction: lock the quotation, the invoice and the counter row, allocate the next
 * number, set the due date from the payment terms, copy the business, client and banking details,
 * render and store the PDF, and freeze the record. A failure anywhere consumes no number.
 */
export async function issueInvoice(ownerId: string, id: string, input: IssueInvoiceInput = {}, deps: IssueDeps = {}): Promise<{ number: string }> {
  const v = issueInvoiceSchema.parse(input);
  const now = deps.now ?? new Date();
  const render = deps.renderPdf ?? renderInvoicePdf;
  const today = isoToday(now);

  return db.$transaction(
    async (tx) => {
      const found = await tx.invoice.findFirst({ where: { id, ownerId }, select: { quotationId: true } });
      if (!found) throw new ServiceError("Invoice not found.");
      // Lock order everywhere: quotation, then invoice, then counter.
      if (found.quotationId) await lockQuotation(tx, ownerId, found.quotationId);
      await lockInvoice(tx, ownerId, id);
      const inv = await tx.invoice.findUniqueOrThrow({ where: { id }, include });
      assertInvoiceMove(inv.status.toLowerCase() as StoredInvoiceStatus, "issued", { paymentCount: 0 });

      const settings = await tx.businessSettings.findUnique({ where: { ownerId } });
      if (!settings || settings.legalName.trim() === "") throw new ServiceError("Add your business details in Settings before issuing an invoice.");
      const cs = await tx.currencySettings.findUnique({ where: { ownerId_currency: { ownerId, currency: inv.currency } } });
      const banking = bankingOf(cs?.bankingDetails);
      if (!bankingIsComplete(banking)) {
        throw new ServiceError(`Add your ${inv.currency} banking details in Settings (bank name and account number) so the invoice says where to pay.`);
      }
      if (inv.client.archivedAt) throw new ServiceError("This client is archived. Unarchive it first.");
      if (num(inv.totalCents) <= 0) throw new ServiceError("An invoice needs a total above zero.");

      let zarValue: number | null = null;
      if (inv.currency === "USD" && v.zarValue) {
        try {
          zarValue = parseAmountToCents(v.zarValue);
        } catch (e) {
          throw new ServiceError("Check the rand value.", [{ path: "zarValue", message: e instanceof Error ? e.message : "Enter an amount" }]);
        }
      }

      const counter = await tx.$queryRaw<{ id: string; next: number }[]>`
        SELECT "id", "next" FROM "NumberCounter" WHERE "ownerId" = ${ownerId} AND "kind"::text = 'INVOICE' FOR UPDATE`;
      const c = counter[0];
      if (!c) throw new ServiceError("Numbering is not set up. Open Settings once to initialise it.");

      const dueDate = addDays(today, settings.paymentTermsDays);
      const number = formatDocumentNumber(settings.invoicePattern, c.next, Number(today.slice(0, 4)), {
        project: inv.project.code,
        client: inv.client.code,
      }).trim();
      await tx.numberCounter.update({ where: { id: c.id }, data: { next: c.next + 1 } });

      const business = businessSnapshot(settings);
      const client = clientSnapshot(inv.client);
      const doc = invoiceDocumentFromRows(
        { ...inv, number, issueDate: dateToDb(today), dueDate: dateToDb(dueDate), paymentReference: number },
        { business, client, projectName: inv.project.name, quotationNumber: inv.quotation?.number ?? null, banking, paidCents: 0 },
      );
      const pdf = await render(doc, await loadLogo(tx, ownerId, settings.logoFileId));
      const file = await storeFile(tx, ownerId, "INVOICE_PDF", pdf, "application/pdf");

      await tx.invoice.update({
        where: { id },
        data: {
          status: "ISSUED",
          number,
          issueDate: dateToDb(today),
          dueDate: dateToDb(dueDate),
          businessSnapshot: business as unknown as Prisma.InputJsonValue,
          clientSnapshot: client as unknown as Prisma.InputJsonValue,
          bankingSnapshot: banking as unknown as Prisma.InputJsonValue,
          paymentReference: number,
          zarValueAtIssueCents: zarValue === null ? null : big(zarValue),
          pdfFileId: file.id,
        },
      });
      await audit(tx, ownerId, "invoice", id, "status.issued", { number });
      return { number };
    },
    { maxWait: 30_000, timeout: 60_000 },
  );
}

// ---------------------------------------------------------------------------------------------
// Cancel (INV6)
// ---------------------------------------------------------------------------------------------

/** An issued invoice can be cancelled only while it has no active payments, and a reason is mandatory. */
export async function cancelInvoice(ownerId: string, id: string, input: { reason: string }, now = new Date()): Promise<void> {
  const { reason } = reasonSchema.parse(input);
  await db.$transaction(async (tx) => {
    const inv = await lockInvoice(tx, ownerId, id);
    const payments = await tx.payment.findMany({ where: { invoiceId: id } });
    assertInvoiceMove(inv.status.toLowerCase() as StoredInvoiceStatus, "cancelled", {
      paymentCount: activePayments(entriesOf(payments)).length,
      reason,
    });
    await tx.invoice.update({ where: { id }, data: { status: "CANCELLED", cancelledAt: now, cancelReason: reason } });
    await audit(tx, ownerId, "invoice", id, "status.cancelled");
  });
}

// ---------------------------------------------------------------------------------------------
// Payments (PAY1 to PAY5): append only
// ---------------------------------------------------------------------------------------------

export async function recordPayment(ownerId: string, invoiceId: string, input: PaymentInput, now = new Date()): Promise<string> {
  const v = paymentSchema.parse(input);
  let amountCents: number;
  try {
    amountCents = parseAmountToCents(v.amount);
  } catch (e) {
    throw new ServiceError("Check the amount.", [{ path: "amount", message: e instanceof Error ? e.message : "Enter an amount" }]);
  }
  return db.$transaction(async (tx) => {
    const inv = await lockInvoice(tx, ownerId, invoiceId);
    const payments = await tx.payment.findMany({ where: { invoiceId } });
    assertCanRecordPayment({
      stored: inv.status.toLowerCase() as StoredInvoiceStatus,
      totalCents: num(inv.totalCents),
      entries: entriesOf(payments),
      amountCents,
      receivedOn: v.receivedOn,
      today: isoToday(now),
      currency: inv.currency,
    });
    const p = await tx.payment.create({
      data: {
        ownerId,
        invoiceId,
        amountCents: big(amountCents),
        receivedOn: dateToDb(v.receivedOn)!,
        method: v.method,
        label: v.label,
        reference: v.reference ?? null,
        notes: v.notes ?? null,
      },
    });
    return p.id;
  });
}

/** PAY3: a mistaken payment is reversed with a reason. A new row is appended; both stay visible. */
export async function reversePayment(ownerId: string, paymentId: string, input: { reason: string }, now = new Date()): Promise<string> {
  const { reason } = reasonSchema.parse(input);
  return db.$transaction(async (tx) => {
    const original = await tx.payment.findFirst({ where: { id: paymentId, ownerId } });
    if (!original) throw new ServiceError("Payment not found.");
    await lockInvoice(tx, ownerId, original.invoiceId);
    const payments = await tx.payment.findMany({ where: { invoiceId: original.invoiceId } });
    assertCanReverse(entriesOf(payments), paymentId, reason);
    const r = await tx.payment.create({
      data: {
        ownerId,
        invoiceId: original.invoiceId,
        amountCents: original.amountCents,
        receivedOn: dateToDb(isoToday(now))!,
        method: original.method,
        label: original.label,
        reference: null,
        notes: null,
        reversesPaymentId: original.id,
        reversalReason: reason,
      },
    });
    await audit(tx, ownerId, "payment", r.id, "payment.reverse", { reverses: original.id, invoiceId: original.invoiceId });
    return r.id;
  });
}

// ---------------------------------------------------------------------------------------------
// Stored PDF and on-screen document
// ---------------------------------------------------------------------------------------------

export async function getInvoicePdf(ownerId: string, id: string) {
  const i = await db.invoice.findFirst({ where: { id, ownerId }, select: { pdfFileId: true, number: true } });
  if (!i?.pdfFileId) return null;
  const f = await readFile(ownerId, i.pdfFileId);
  return f ? { ...f, number: i.number } : null;
}

/** The invoice as shown on screen: details from its snapshot, amount paid and balance live. */
export async function getInvoiceDocument(ownerId: string, id: string): Promise<InvoiceDocument | null> {
  const i = await db.invoice.findFirst({ where: { id, ownerId }, include });
  if (!i) return null;
  let business = i.businessSnapshot as unknown as BusinessSnapshot | null;
  let client = i.clientSnapshot as unknown as ClientSnapshot | null;
  let banking = i.bankingSnapshot ? bankingOf(i.bankingSnapshot) : null;
  if (!business || !client || !banking) {
    const s = await db.businessSettings.findUnique({ where: { ownerId } });
    const cs = await db.currencySettings.findUnique({ where: { ownerId_currency: { ownerId, currency: i.currency } } });
    business = s ? businessSnapshot(s) : { legalName: "", tradingName: null, registrationNumber: null, address: "", email: "", phone: "", logoFileId: null };
    client = clientSnapshot(i.client);
    banking = bankingOf(cs?.bankingDetails);
  }
  return invoiceDocumentFromRows(i, {
    business,
    client,
    projectName: i.project.name,
    quotationNumber: i.quotation?.number ?? null,
    banking,
    paidCents: paidCents(entriesOf(i.payments)),
  });
}

export interface ClientPaymentRow {
  id: string;
  invoiceId: string;
  invoiceNumber: string | null;
  currency: Currency;
  amountCents: number;
  receivedOn: string;
  method: string;
  isReversal: boolean;
  reversed: boolean;
  reversalReason: string;
}

/** Every payment entry (including reversals) against a client's invoices, newest first. CLI2. */
export async function listPaymentsForClient(ownerId: string, clientId: string): Promise<ClientPaymentRow[]> {
  const rows = await db.payment.findMany({
    where: { ownerId, invoice: { clientId } },
    include: { invoice: { select: { number: true, currency: true } } },
    orderBy: [{ receivedOn: "desc" }, { createdAt: "desc" }],
  });
  const reversedIds = new Set(rows.filter((r) => r.reversesPaymentId).map((r) => r.reversesPaymentId!));
  return rows.map((r) => ({
    id: r.id,
    invoiceId: r.invoiceId,
    invoiceNumber: r.invoice.number,
    currency: r.invoice.currency,
    amountCents: num(r.amountCents),
    receivedOn: dateFromDb(r.receivedOn) ?? "",
    method: r.method,
    isReversal: r.reversesPaymentId !== null,
    reversed: !r.reversesPaymentId && reversedIds.has(r.id),
    reversalReason: r.reversalReason ?? "",
  }));
}
