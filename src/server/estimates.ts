import type { Prisma } from "@prisma/client";
import { centsToAmountString, type Currency } from "@/domain/money";
import { evaluateDraft, type EstimateDraft, type PricingContext } from "@/domain/pricing/draft";
import { estimateDraftSchema } from "@/domain/pricing/draft-schema";
import type { EstimateResult } from "@/domain/pricing/engine";
import type { LabourCategory } from "@/domain/pricing/schema";
import { estimateMetaSchema, type EstimateMetaInput } from "@/domain/schemas";
import { audit } from "./audit";
import { big, catFromDb, catToDb, cxFromDb, cxToDb, dstr, num, numOrNull } from "./convert";
import { db } from "./db";
import { ServiceError } from "./errors";
import { getPricingSettings, type PricingSettings } from "./settings";

export interface EstimateDTO {
  id: string;
  projectId: string;
  projectName: string;
  clientName: string;
  title: string;
  internalNotes: string;
  status: "DRAFT" | "READY";
  updatedAt: string;
  draft: EstimateDraft;
}

export interface EstimateListItem {
  id: string;
  projectId: string;
  title: string;
  projectName: string;
  clientName: string;
  currency: Currency;
  status: "DRAFT" | "READY";
  method: "time" | "fixed";
  /** Null when the saved lines no longer evaluate (for example after a settings change). */
  totalCents: number | null;
  updatedAt: string;
}

export const toContext = (s: PricingSettings): PricingContext => ({
  multipliers: s.multipliers,
  minimumHourlyRateCents: s.minimumHourlyRateCents,
  defaultRatesCents: s.defaultRatesCents,
});

type EstimateRow = Prisma.EstimateGetPayload<{
  include: { lines: true; project: { select: { name: true; client: { select: { name: true } } } } };
}>;
const include = { lines: { orderBy: { position: "asc" } }, project: { select: { name: true, client: { select: { name: true } } } } } as const;

/** Rebuilds the form model from stored rows. Lines of the inactive method are never stored (EST2). */
export function rowsToDraft(e: EstimateRow): EstimateDraft {
  const lines = e.lines;
  return {
    method: e.method === "TIME" ? "time" : "fixed",
    currency: e.currency,
    complexity: e.complexity ? cxFromDb(e.complexity) : null,
    urgent: e.urgent,
    urgencyPct: dstr(e.urgencyPct),
    contingencyPct: dstr(e.contingencyPct),
    discount:
      e.discountCents !== null
        ? { type: "fixed", value: centsToAmountString(num(e.discountCents)) }
        : e.discountPct !== null
          ? { type: "percent", value: dstr(e.discountPct) }
          : { type: "none", value: "" },
    labour: lines
      .filter((l) => l.kind === "LABOUR")
      .map((l) => ({
        id: l.id,
        task: l.description,
        category: catFromDb(l.category!) as LabourCategory,
        hours: dstr(l.hours),
        rate: centsToAmountString(num(l.rateCents)),
      })),
    deliverables: lines
      .filter((l) => l.kind === "DELIVERABLE")
      .map((l) => ({ id: l.id, name: l.description, price: centsToAmountString(num(l.priceCents)), estimatedHours: dstr(l.hours) })),
    expenses: lines
      .filter((l) => l.kind === "EXPENSE")
      .map((l) => ({
        id: l.id,
        description: l.description,
        cost: centsToAmountString(num(l.costCents)),
        markupPct: dstr(l.markupPct),
        recurring: l.recurring,
        period: l.period === "ANNUAL" ? "annual" : "monthly",
      })),
  };
}

function toDTO(e: EstimateRow): EstimateDTO {
  return {
    id: e.id,
    projectId: e.projectId,
    projectName: e.project.name,
    clientName: e.project.client.name,
    title: e.title,
    internalNotes: e.internalNotes ?? "",
    status: e.status,
    updatedAt: e.updatedAt.toISOString(),
    draft: rowsToDraft(e),
  };
}

export async function getEstimate(ownerId: string, id: string): Promise<EstimateDTO | null> {
  const e = await db.estimate.findFirst({ where: { id, ownerId }, include });
  return e ? toDTO(e) : null;
}

export async function listEstimates(ownerId: string): Promise<EstimateListItem[]> {
  const rows = await db.estimate.findMany({ where: { ownerId }, include, orderBy: { updatedAt: "desc" } });
  const settings = new Map<Currency, PricingSettings>();
  const items: EstimateListItem[] = [];
  for (const e of rows) {
    if (!settings.has(e.currency)) settings.set(e.currency, await getPricingSettings(ownerId, e.currency));
    const r = evaluateDraft(rowsToDraft(e), toContext(settings.get(e.currency)!));
    items.push({
      id: e.id,
      projectId: e.projectId,
      title: e.title,
      projectName: e.project.name,
      clientName: e.project.client.name,
      currency: e.currency,
      status: e.status,
      method: e.method === "TIME" ? "time" : "fixed",
      totalCents: r.ok ? r.result.breakdown.totalCents : null,
      updatedAt: e.updatedAt.toISOString(),
    });
  }
  return items;
}

export interface SaveEstimateInput {
  meta: EstimateMetaInput;
  draft: EstimateDraft;
}

/**
 * Creates or updates a draft. The server re-runs the same Zod schemas and the same engine as the
 * browser, so a stored estimate is always one the engine can price. Returns the fresh result.
 */
export async function saveEstimate(
  ownerId: string,
  id: string | null,
  input: SaveEstimateInput,
): Promise<{ id: string; result: EstimateResult }> {
  const meta = estimateMetaSchema.parse(input.meta);
  const draft = estimateDraftSchema.parse(input.draft) as EstimateDraft;
  if (draft.currency !== meta.currency) throw new ServiceError("Currency mismatch.");

  const project = await db.project.findFirst({ where: { id: meta.projectId, ownerId }, select: { id: true } });
  if (!project) throw new ServiceError("Choose a project.", [{ path: "projectId", message: "Choose a project" }]);

  const settings = await getPricingSettings(ownerId, draft.currency);
  if (!settings.ratesConfigured) {
    throw new ServiceError(`Set your ${draft.currency} hourly rates in Settings before creating estimates.`);
  }
  const evaluated = evaluateDraft({ ...draft, complexity: meta.complexity ?? draft.complexity }, toContext(settings));
  if (!evaluated.ok) throw new ServiceError("Some fields need attention.", evaluated.issues);

  const multiplier = draft.method === "fixed" && draft.complexity ? settings.multipliers[draft.complexity] : null;

  const savedId = await db.$transaction(async (tx) => {
    const data = {
      projectId: meta.projectId,
      title: meta.title,
      currency: draft.currency,
      method: draft.method === "time" ? ("TIME" as const) : ("FIXED" as const),
      complexity: draft.method === "fixed" && draft.complexity ? cxToDb(draft.complexity) : null,
      complexityMultiplier: multiplier,
      urgent: draft.urgent,
      urgencyPct: draft.urgencyPct,
      contingencyPct: draft.contingencyPct,
      discountPct: draft.discount.type === "percent" ? draft.discount.value : null,
      discountCents:
        draft.discount.type === "fixed" && evaluated.ok ? big(evaluated.result.breakdown.discountCents) : null,
      internalNotes: meta.internalNotes ?? null,
    };

    let estimateId = id;
    if (id) {
      const existing = await tx.estimate.findFirst({ where: { id, ownerId }, select: { id: true } });
      if (!existing) throw new ServiceError("Estimate not found.");
      await tx.estimate.update({ where: { id }, data: { ...data, status: "DRAFT" } });
      await tx.estimateLine.deleteMany({ where: { estimateId: id } });
    } else {
      estimateId = (await tx.estimate.create({ data: { ownerId, ...data } })).id;
    }

    const lines: Prisma.EstimateLineCreateManyInput[] = [];
    if (draft.method === "time") {
      const inputLabour = evaluated.input.method === "time" ? evaluated.input.labour : [];
      draft.labour.forEach((l, i) =>
        lines.push({
          id: l.id,
          ownerId,
          estimateId: estimateId!,
          kind: "LABOUR",
          position: i,
          description: l.task,
          category: catToDb(l.category),
          hours: l.hours,
          rateCents: big(inputLabour[i]!.rateCents),
          rateOverridden: inputLabour[i]!.rateOverridden ?? false,
        }),
      );
    } else {
      const inputDel = evaluated.input.method === "fixed" ? evaluated.input.deliverables : [];
      draft.deliverables.forEach((d, i) =>
        lines.push({
          id: d.id,
          ownerId,
          estimateId: estimateId!,
          kind: "DELIVERABLE",
          position: i,
          description: d.name,
          priceCents: big(inputDel[i]!.priceCents),
          hours: d.estimatedHours,
        }),
      );
    }
    draft.expenses.forEach((x, i) =>
      lines.push({
        id: x.id,
        ownerId,
        estimateId: estimateId!,
        kind: "EXPENSE",
        position: i,
        description: x.description,
        costCents: big(evaluated.input.expenses?.[i]?.costCents ?? 0),
        markupPct: x.markupPct,
        recurring: x.recurring,
        period: x.recurring ? (x.period === "annual" ? "ANNUAL" : "MONTHLY") : null,
      }),
    );
    await tx.estimateLine.createMany({ data: lines });
    return estimateId!;
  });

  return { id: savedId, result: evaluated.result };
}

/** EST1: duplicating creates a new draft with its own lines. */
export async function duplicateEstimate(ownerId: string, id: string): Promise<string> {
  return db.$transaction(async (tx) => {
    const src = await tx.estimate.findFirst({ where: { id, ownerId }, include: { lines: true } });
    if (!src) throw new ServiceError("Estimate not found.");
    const copy = await tx.estimate.create({
      data: {
        ownerId,
        projectId: src.projectId,
        title: `Copy of ${src.title}`.slice(0, 200),
        currency: src.currency,
        method: src.method,
        complexity: src.complexity,
        complexityMultiplier: src.complexityMultiplier,
        urgent: src.urgent,
        urgencyPct: src.urgencyPct,
        contingencyPct: src.contingencyPct,
        discountPct: src.discountPct,
        discountCents: src.discountCents,
        internalNotes: src.internalNotes,
      },
    });
    await tx.estimateLine.createMany({
      data: src.lines.map(({ id: _id, estimateId: _e, ...rest }) => ({ ...rest, estimateId: copy.id })),
    });
    return copy.id;
  });
}

/** An estimate must price cleanly before it can be marked ready for a quotation (QUO1). */
export async function setEstimateReady(ownerId: string, id: string, ready: boolean): Promise<void> {
  const e = await db.estimate.findFirst({ where: { id, ownerId }, include });
  if (!e) throw new ServiceError("Estimate not found.");
  if (ready) {
    const settings = await getPricingSettings(ownerId, e.currency);
    const r = evaluateDraft(rowsToDraft(e), toContext(settings));
    if (!r.ok) throw new ServiceError("Fix the highlighted problems before marking this estimate ready.", r.issues);
    if (r.result.breakdown.totalCents <= 0) throw new ServiceError("An estimate with a zero total cannot be marked ready.");
  }
  await db.$transaction(async (tx) => {
    await tx.estimate.update({ where: { id }, data: { status: ready ? "READY" : "DRAFT" } });
    await audit(tx, ownerId, "estimate", id, ready ? "status.ready" : "status.draft");
  });
}

export async function deleteEstimate(ownerId: string, id: string): Promise<void> {
  const e = await db.estimate.findFirst({ where: { id, ownerId }, select: { id: true, _count: { select: { quotations: true } } } });
  if (!e) throw new ServiceError("Estimate not found.");
  if (e._count.quotations > 0) throw new ServiceError("This estimate has quotations. Financial records are kept, so it cannot be deleted.");
  await db.estimate.delete({ where: { id } });
}

export { numOrNull };
