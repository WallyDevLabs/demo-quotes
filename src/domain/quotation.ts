import type { CalendarDate } from "./dates";
import { DomainError } from "./errors";
import { splitByPercentages } from "./milestones";
import { formatMoney, dec, type Cents, type Currency } from "./money";
import type { EstimateDraft } from "./pricing/draft";
import type { EstimateResult } from "./pricing/engine";

/**
 * QUO1: a quotation copies a fixed WHITELIST of client-facing fields from an estimate. Every
 * object below is built field by field, never spread from the estimate, so anything added to the
 * estimate later (cost, markup, effective rate, internal hours, notes) is hidden by default.
 */

export type QuotationLineKind = "LABOUR" | "DELIVERABLE" | "EXPENSE" | "URGENCY" | "CONTINGENCY" | "RECURRING";

export interface QuotationLineContent {
  kind: QuotationLineKind;
  description: string;
  /** Client-facing detail such as "40 h x R600.00" or "per month". */
  detail: string;
  amountCents: Cents;
}

export interface QuotationContent {
  /** Itemised lines. RECURRING lines are listed separately and are not part of the totals. */
  lines: QuotationLineContent[];
  subtotalCents: Cents;
  discountCents: Cents;
  totalCents: Cents;
}

const hoursLabel = (h: string) => `${dec(h).toString()} h`;

export function buildQuotationContent(draft: EstimateDraft, result: EstimateResult, currency: Currency): QuotationContent {
  const money = (c: Cents) => formatMoney(c, currency);
  const lines: QuotationLineContent[] = [];

  if (draft.method === "time") {
    draft.labour.forEach((l) => {
      const r = result.lines.find((x) => x.id === l.id)!;
      lines.push({
        kind: "LABOUR",
        description: l.task,
        detail: `${hoursLabel(r.hours!)} x ${money(r.rateCents!)}`,
        amountCents: r.amountCents,
      });
    });
  } else {
    draft.deliverables.forEach((d) => {
      const r = result.lines.find((x) => x.id === d.id)!;
      // The client sees the price they pay. Hours and the complexity multiplier stay internal.
      lines.push({ kind: "DELIVERABLE", description: d.name, detail: "", amountCents: r.adjustedCents! });
    });
  }

  if (result.breakdown.urgencyCents > 0) {
    lines.push({ kind: "URGENCY", description: "Urgent delivery surcharge", detail: `${dec(draft.urgencyPct).toString()}%`, amountCents: result.breakdown.urgencyCents });
  }
  if (result.breakdown.contingencyCents > 0) {
    lines.push({ kind: "CONTINGENCY", description: "Contingency", detail: `${dec(draft.contingencyPct).toString()}%`, amountCents: result.breakdown.contingencyCents });
  }

  // Expenses: the billed amount only. Cost and markup never leave the estimate.
  draft.expenses
    .filter((e) => !e.recurring)
    .forEach((e) => {
      const r = result.expenseLines.find((x) => x.id === e.id)!;
      lines.push({ kind: "EXPENSE", description: e.description, detail: "", amountCents: r.billedCents });
    });

  draft.expenses
    .filter((e) => e.recurring)
    .forEach((e) => {
      const r = result.recurringLines.find((x) => x.id === e.id)!;
      lines.push({ kind: "RECURRING", description: e.description, detail: r.period === "annual" ? "per year" : "per month", amountCents: r.billedCents });
    });

  const content: QuotationContent = {
    lines,
    subtotalCents: result.breakdown.subtotalCents,
    discountCents: result.breakdown.discountCents,
    totalCents: result.breakdown.totalCents,
  };
  assertReconciles(content);
  return content;
}

/** The lines must add up to the totals to the cent, or the quotation is not created. */
export function assertReconciles(c: QuotationContent): void {
  const sum = c.lines.filter((l) => l.kind !== "RECURRING").reduce((s, l) => s + l.amountCents, 0);
  if (sum !== c.subtotalCents || c.subtotalCents - c.discountCents !== c.totalCents) {
    throw new DomainError("INVALID_AMOUNT", "Quotation lines do not add up to the total");
  }
}

export interface MilestoneInput {
  label: string;
  percent: string | number;
}
export interface PaymentScheduleItem {
  label: string;
  percent: string;
  amountCents: Cents;
}

/** QUO6: percentages total exactly 100; amounts use largest remainder so they sum to the total. */
export function buildPaymentSchedule(totalCents: Cents, milestones: MilestoneInput[]): PaymentScheduleItem[] {
  const items = milestones.length > 0 ? milestones : [{ label: "Full payment", percent: "100" }];
  const amounts = splitByPercentages(totalCents, items.map((m) => m.percent));
  return items.map((m, i) => ({ label: m.label, percent: dec(m.percent).toFixed(2), amountCents: amounts[i]! }));
}

// ---------- the document model (shared by the PDF, the on-screen view and the tests) ----------

export interface BusinessSnapshot {
  legalName: string;
  tradingName: string | null;
  registrationNumber: string | null;
  address: string;
  email: string;
  phone: string;
  /** Id of the stored logo file, if one was uploaded. */
  logoFileId: string | null;
}

export interface ClientSnapshot {
  name: string;
  companyName: string | null;
  contactPerson: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  registrationNumber: string | null;
}

export interface QuotationDocInput {
  /** Null while it is a draft. */
  number: string | null;
  issueDate: CalendarDate | null;
  expiryDate: CalendarDate | null;
  currency: Currency;
  business: BusinessSnapshot;
  client: ClientSnapshot;
  projectName: string;
  title: string;
  scope: string;
  deliverables: string;
  exclusions: string;
  timeline: string;
  revisionPolicy: string;
  terms: string;
  content: QuotationContent;
  schedule: PaymentScheduleItem[];
}

export interface DocLine {
  description: string;
  detail: string;
  amount: string;
}

export interface QuotationDocument {
  title: string;
  number: string;
  issueDate: string;
  expiryDate: string;
  isDraft: boolean;
  business: { name: string; lines: string[]; logoFileId: string | null };
  client: { name: string; lines: string[] };
  projectName: string;
  heading: string;
  text: { scope: string; deliverables: string; exclusions: string; timeline: string; revisionPolicy: string; terms: string };
  lines: DocLine[];
  recurring: DocLine[];
  totals: { subtotal: string; discount: string | null; total: string };
  schedule: { label: string; percent: string; amount: string }[];
  acceptance: string;
}

const compact = (xs: (string | null | undefined)[]) => xs.map((x) => x?.trim()).filter((x): x is string => !!x);

/**
 * Pure and presentation-neutral: the same model feeds the PDF and the HTML view. VAT mode is NONE
 * in the MVP, so nothing here can mention VAT, a tax invoice or a VAT number (render tests assert it).
 */
export function buildQuotationDocument(i: QuotationDocInput): QuotationDocument {
  const money = (c: Cents) => formatMoney(c, i.currency);
  const line = (l: QuotationLineContent): DocLine => ({ description: l.description, detail: l.detail, amount: money(l.amountCents) });
  const b = i.business;
  return {
    title: "Quotation",
    number: i.number ?? "Draft (no number yet)",
    issueDate: i.issueDate ?? "Not yet issued",
    expiryDate: i.expiryDate ?? "Set when sent",
    isDraft: i.number === null,
    business: {
      name: b.tradingName?.trim() ? `${b.tradingName} (${b.legalName})` : b.legalName,
      lines: compact([b.address, b.email, b.phone, b.registrationNumber ? `Reg. ${b.registrationNumber}` : null]),
      logoFileId: b.logoFileId,
    },
    client: {
      name: i.client.companyName?.trim() ? `${i.client.companyName}` : i.client.name,
      lines: compact([
        i.client.companyName?.trim() ? i.client.contactPerson || i.client.name : i.client.contactPerson,
        i.client.address,
        i.client.email,
        i.client.phone,
        i.client.registrationNumber ? `Reg. ${i.client.registrationNumber}` : null,
      ]),
    },
    projectName: i.projectName,
    heading: i.title,
    text: {
      scope: i.scope,
      deliverables: i.deliverables,
      exclusions: i.exclusions,
      timeline: i.timeline,
      revisionPolicy: i.revisionPolicy,
      terms: i.terms,
    },
    lines: i.content.lines.filter((l) => l.kind !== "RECURRING").map(line),
    recurring: i.content.lines.filter((l) => l.kind === "RECURRING").map(line),
    totals: {
      subtotal: money(i.content.subtotalCents),
      discount: i.content.discountCents > 0 ? money(i.content.discountCents) : null,
      total: money(i.content.totalCents),
    },
    schedule: i.schedule.map((s) => ({ label: s.label, percent: `${s.percent}%`, amount: money(s.amountCents) })),
    acceptance: "To accept this quotation, sign and date below, or confirm acceptance in writing.",
  };
}

/** Every string a client could read, for render tests. */
export function documentText(d: QuotationDocument): string {
  return JSON.stringify(d);
}

export interface ReconcileCheck {
  label: string;
  /** What the figures say it should be. */
  expectedCents: Cents | null;
  /** What is stored and printed. */
  actualCents: Cents | null;
  ok: boolean;
  note?: string;
}

/**
 * Re-adds a stored quotation from its own lines and milestones, so a hand check compares what is
 * actually printed, not a recalculation. Every check must pass; a failing one is a bug to report.
 */
export function reconcileQuotation(q: {
  lines: { kind: QuotationLineKind; description: string; amountCents: Cents }[];
  subtotalCents: Cents;
  discountCents: Cents;
  totalCents: Cents;
  milestones: { label: string; percent: string; amountCents: Cents }[];
}): ReconcileCheck[] {
  const billed = q.lines.filter((l) => l.kind !== "RECURRING").reduce((s, l) => s + l.amountCents, 0);
  const pctTimes100 = q.milestones.reduce((s, m) => s + Math.round(Number(m.percent) * 100), 0);
  const msTotal = q.milestones.reduce((s, m) => s + m.amountCents, 0);
  const checks: ReconcileCheck[] = [
    { label: "Lines add up to the subtotal", expectedCents: billed, actualCents: q.subtotalCents, ok: billed === q.subtotalCents },
    { label: "Subtotal minus discount equals the total", expectedCents: q.subtotalCents - q.discountCents, actualCents: q.totalCents, ok: q.subtotalCents - q.discountCents === q.totalCents },
    { label: "Milestone amounts add up to the total", expectedCents: q.totalCents, actualCents: msTotal, ok: msTotal === q.totalCents },
    { label: "Milestone percentages total exactly 100", expectedCents: null, actualCents: null, ok: pctTimes100 === 10000, note: `${pctTimes100 / 100}%` },
  ];
  return checks;
}
