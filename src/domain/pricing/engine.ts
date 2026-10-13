import { dec, formatZAR, hoursTimesRate, pctOf, toCents, type Cents } from "../money";
import { estimateInputSchema, type EstimateInput, type ParsedEstimateInput } from "./schema";

export interface FieldIssue {
  /** Dotted path into the engine input, e.g. "labour.0.hours". */
  path: string;
  message: string;
}

export class PricingValidationError extends Error {
  constructor(
    public readonly issues: string[],
    public readonly fieldIssues: FieldIssue[] = [],
  ) {
    super(`Invalid estimate: ${issues.join("; ")}`);
    this.name = "PricingValidationError";
  }
}

export interface ExplainEntry {
  key: string;
  label: string;
  formula: string;
  inputs: string[];
  amountCents: Cents;
}

export interface Breakdown {
  /** Method A: labour. Method B: deliverables after the complexity adjustment. */
  baseCents: Cents;
  /** Method B only; 0 in Method A. */
  complexityAdjustmentCents: Cents;
  urgencyCents: Cents;
  contingencyCents: Cents;
  /** Once-off expenses at their billed amount (cost plus markup). */
  expensesBilledCents: Cents;
  subtotalCents: Cents;
  discountCents: Cents;
  totalCents: Cents;
}

/** Internal only. Must never reach a client document (QUO1 uses a whitelist). */
export interface InternalView {
  estimatedHours: string;
  /** (total - billed once-off expenses) / hours, in cents per hour; null when there are no hours. */
  effectiveHourlyRateCents: Cents | null;
  minimumHourlyRateCents: Cents;
  belowMinimumRate: boolean;
  expenseCostCents: Cents;
  markupEarnedCents: Cents;
  contingencyCents: Cents;
}

export interface RecurringTotals {
  monthlyCents: Cents;
  annualCents: Cents;
}

export interface EstimateResult {
  method: "time" | "fixed";
  /** Per-line amounts in input order. */
  lines: { id: string; amountCents: Cents; adjustedCents?: Cents; hours?: string; rateCents?: Cents }[];
  expenseLines: { id: string; costCents: Cents; markupCents: Cents; billedCents: Cents }[];
  recurringLines: { id: string; costCents: Cents; markupCents: Cents; billedCents: Cents; period: "monthly" | "annual" }[];
  breakdown: Breakdown;
  /** Listed separately and never part of the project total (EST5). */
  recurring: RecurringTotals;
  internal: InternalView;
  explanations: ExplainEntry[];
}

export function parseEstimate(input: EstimateInput): ParsedEstimateInput {
  const parsed = estimateInputSchema.safeParse(input);
  if (!parsed.success) {
    const fieldIssues = parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
    throw new PricingValidationError(
      fieldIssues.map((f) => (f.path ? `${f.path}: ${f.message}` : f.message)),
      fieldIssues,
    );
  }
  return parsed.data;
}

/**
 * Pure pricing (PRD v2, "Money rules and pricing formulas"). Integer cents throughout; every
 * line and every percentage step rounds half up exactly once, and the total is the sum of
 * already rounded parts, never rounded again.
 *
 *  Method A  labour = sum(round(hours x rate))
 *  Method B  base   = sum(round(price x complexity multiplier))
 *  urgency      = urgency% x base, only when the urgent flag is on
 *  contingency  = contingency% x base (before urgency; neither is charged on the other)
 *  expenses     = sum(round(cost x (1 + markup%))) for once-off lines
 *  subtotal     = base + urgency + contingency + expenses
 *  discount     = percent or fixed amount off the subtotal, never more than the subtotal
 *  total        = subtotal - discount
 * No complexity or margin is applied to time-based pricing, and there is no tax line.
 */
export function calculateEstimate(input: EstimateInput): EstimateResult {
  const est = parseEstimate(input);
  const explanations: ExplainEntry[] = [];

  // Expenses (shared by both methods)
  const priced = est.expenses.map((e) => {
    const markupCents = pctOf(e.costCents, e.markupPct);
    return { ...e, markupCents, billedCents: e.costCents + markupCents };
  });
  const onceOff = priced.filter((e) => !e.recurring);
  const recurringPriced = priced.filter((e) => e.recurring);

  // Base
  let baseCents = 0;
  let complexityAdjustmentCents = 0;
  let lines: EstimateResult["lines"];
  let totalHours;

  if (est.method === "time") {
    lines = est.labour.map((l) => ({
      id: l.id,
      amountCents: hoursTimesRate(l.hours, l.rateCents),
      hours: dec(l.hours).toString(),
      rateCents: l.rateCents,
    }));
    baseCents = lines.reduce((s, l) => s + l.amountCents, 0);
    totalHours = est.labour.reduce((s, l) => s.plus(dec(l.hours)), dec(0));
    explanations.push({
      key: "labour",
      label: "Labour",
      formula: "sum of (hours x rate), each line rounded to the cent",
      inputs: est.labour.map((l) => `${l.task}: ${dec(l.hours)} h x ${formatZAR(l.rateCents)} = ${formatZAR(hoursTimesRate(l.hours, l.rateCents))}`),
      amountCents: baseCents,
    });
  } else {
    const mult = dec(est.complexityMultiplier);
    lines = est.deliverables.map((d) => {
      const adjustedCents = toCents(dec(d.priceCents).mul(mult));
      return { id: d.id, amountCents: d.priceCents, adjustedCents };
    });
    const entered = lines.reduce((s, l) => s + l.amountCents, 0);
    baseCents = lines.reduce((s, l) => s + (l.adjustedCents ?? 0), 0);
    complexityAdjustmentCents = baseCents - entered;
    totalHours = est.deliverables.reduce((s, d) => s.plus(dec(d.estimatedHours)), dec(0));
    explanations.push({
      key: "deliverables",
      label: "Deliverables (after complexity)",
      formula: `sum of (price x ${est.complexity} multiplier ${mult}), each line rounded to the cent`,
      inputs: est.deliverables.map((d, i) => `${d.name}: ${formatZAR(d.priceCents)} x ${mult} = ${formatZAR(lines[i]!.adjustedCents ?? 0)}`),
      amountCents: baseCents,
    });
  }

  // Urgency and contingency: both on the base, neither on expenses or on each other
  const urgencyCents = est.urgent ? pctOf(baseCents, est.urgencyPct) : 0;
  const contingencyCents = pctOf(baseCents, est.contingencyPct);
  explanations.push({
    key: "urgency",
    label: "Urgency surcharge",
    formula: "urgency % x base, only when the urgent flag is on",
    inputs: [est.urgent ? `${dec(est.urgencyPct)}% x ${formatZAR(baseCents)}` : "Urgent flag is off"],
    amountCents: urgencyCents,
  });
  explanations.push({
    key: "contingency",
    label: "Contingency",
    formula: "contingency % x base (before urgency)",
    inputs: [`${dec(est.contingencyPct)}% x ${formatZAR(baseCents)}`],
    amountCents: contingencyCents,
  });

  const expensesBilledCents = onceOff.reduce((s, e) => s + e.billedCents, 0);
  explanations.push({
    key: "expenses",
    label: "Pass-through expenses",
    formula: "sum of cost x (1 + markup %), each line rounded to the cent",
    inputs: onceOff.map((e) => `${e.description}: ${formatZAR(e.costCents)} x (1 + ${dec(e.markupPct)}%) = ${formatZAR(e.billedCents)}`),
    amountCents: expensesBilledCents,
  });

  const subtotalCents = baseCents + urgencyCents + contingencyCents + expensesBilledCents;
  explanations.push({
    key: "subtotal",
    label: "Subtotal",
    formula: "base + urgency + contingency + expenses",
    inputs: [formatZAR(baseCents), formatZAR(urgencyCents), formatZAR(contingencyCents), formatZAR(expensesBilledCents)],
    amountCents: subtotalCents,
  });

  // Discount: applied once, to the subtotal
  let discountCents = 0;
  if (est.discount) {
    discountCents = est.discount.type === "percent" ? pctOf(subtotalCents, est.discount.value) : est.discount.cents;
    if (discountCents > subtotalCents) {
      throw new PricingValidationError(
        ["discount: Discount cannot be larger than the subtotal"],
        [{ path: "discount", message: "Discount cannot be larger than the subtotal" }],
      );
    }
  }
  explanations.push({
    key: "discount",
    label: "Discount",
    formula: "percentage or fixed amount off the subtotal, never more than the subtotal",
    inputs: [
      est.discount
        ? est.discount.type === "percent"
          ? `${dec(est.discount.value)}% x ${formatZAR(subtotalCents)}`
          : `Fixed ${formatZAR(est.discount.cents)}`
        : "No discount",
    ],
    amountCents: discountCents,
  });

  const totalCents = subtotalCents - discountCents;
  explanations.push({
    key: "total",
    label: "Total",
    formula: "subtotal - discount",
    inputs: [formatZAR(subtotalCents), formatZAR(discountCents)],
    amountCents: totalCents,
  });

  // Internal check
  const hoursNum = totalHours.toNumber();
  const effectiveHourlyRateCents = hoursNum > 0 ? toCents(dec(totalCents - expensesBilledCents).div(totalHours)) : null;
  const belowMinimumRate =
    est.minimumHourlyRateCents > 0 && effectiveHourlyRateCents !== null && effectiveHourlyRateCents < est.minimumHourlyRateCents;
  explanations.push({
    key: "effectiveRate",
    label: "Effective hourly rate (internal)",
    formula: "(total - billed pass-through expenses) / estimated hours",
    inputs: [`(${formatZAR(totalCents)} - ${formatZAR(expensesBilledCents)}) / ${totalHours} h`],
    amountCents: effectiveHourlyRateCents ?? 0,
  });

  const sumRecurring = (period: "monthly" | "annual") =>
    recurringPriced.filter((e) => e.period === period).reduce((s, e) => s + e.billedCents, 0);

  return {
    method: est.method,
    lines,
    expenseLines: onceOff.map((e) => ({ id: e.id, costCents: e.costCents, markupCents: e.markupCents, billedCents: e.billedCents })),
    recurringLines: recurringPriced.map((e) => ({
      id: e.id,
      costCents: e.costCents,
      markupCents: e.markupCents,
      billedCents: e.billedCents,
      period: e.period!,
    })),
    breakdown: {
      baseCents,
      complexityAdjustmentCents,
      urgencyCents,
      contingencyCents,
      expensesBilledCents,
      subtotalCents,
      discountCents,
      totalCents,
    },
    recurring: { monthlyCents: sumRecurring("monthly"), annualCents: sumRecurring("annual") },
    internal: {
      estimatedHours: totalHours.toString(),
      effectiveHourlyRateCents,
      minimumHourlyRateCents: est.minimumHourlyRateCents,
      belowMinimumRate,
      expenseCostCents: onceOff.reduce((s, e) => s + e.costCents, 0),
      markupEarnedCents: onceOff.reduce((s, e) => s + e.markupCents, 0),
      contingencyCents,
    },
    explanations,
  };
}
