import { COMPLEXITIES, LABOUR_CATEGORIES, type Complexity, type LabourCategory } from "./schema";
import { calculateEstimate, PricingValidationError, type EstimateResult, type FieldIssue } from "./engine";
import { centsToAmountString, parseAmountToCents, type Currency } from "../money";
import type { EstimateInput } from "./schema";

/**
 * The form-side model of an estimate. Everything a person types is a string (major units for
 * money), so the UI and the server share one conversion and one set of rules. The browser uses
 * this for the live summary; the server uses it again on save. Components never hold formulas.
 */
export interface DraftLabour {
  id: string;
  task: string;
  category: LabourCategory;
  hours: string;
  /** Major units per hour, e.g. "600.00". */
  rate: string;
}
export interface DraftDeliverable {
  id: string;
  name: string;
  price: string;
  estimatedHours: string;
}
export interface DraftExpense {
  id: string;
  description: string;
  cost: string;
  markupPct: string;
  recurring: boolean;
  period: "monthly" | "annual";
}
export interface EstimateDraft {
  method: "time" | "fixed";
  currency: Currency;
  complexity: Complexity | null;
  urgent: boolean;
  urgencyPct: string;
  contingencyPct: string;
  discount: { type: "none" | "percent" | "fixed"; value: string };
  labour: DraftLabour[];
  deliverables: DraftDeliverable[];
  expenses: DraftExpense[];
}

/** Settings that feed a calculation. The server supplies them from the database. */
export interface PricingContext {
  /** Multipliers by complexity level, seeded at "1.00". */
  multipliers: Record<Complexity, string>;
  minimumHourlyRateCents: number;
  /** Configured default rate per category in cents, used to flag overrides (EST3). */
  defaultRatesCents: Partial<Record<LabourCategory, number>>;
}

export type DraftResult =
  | { ok: true; input: EstimateInput; result: EstimateResult }
  | { ok: false; issues: FieldIssue[] };

const FIELD_RENAMES: [RegExp, string][] = [
  [/^(labour\.\d+)\.rateCents$/, "$1.rate"],
  [/^(deliverables\.\d+)\.priceCents$/, "$1.price"],
  [/^(expenses\.\d+)\.costCents$/, "$1.cost"],
  [/^discount\.(cents|value)$/, "discount.value"],
  [/^discount$/, "discount.value"],
];

function renamePath(path: string): string {
  for (const [re, to] of FIELD_RENAMES) if (re.test(path)) return path.replace(re, to);
  return path;
}

function amount(value: string, path: string, issues: FieldIssue[]): number {
  try {
    return parseAmountToCents(value);
  } catch (e) {
    issues.push({ path, message: e instanceof Error ? e.message : "Enter an amount" });
    return 0;
  }
}

/**
 * Turns a draft into engine input and a result, or a list of field-level issues. Never throws
 * for user mistakes. The fixed-price multiplier comes from `ctx` (settings), never from the draft.
 */
export function evaluateDraft(draft: EstimateDraft, ctx: PricingContext): DraftResult {
  const issues: FieldIssue[] = [];

  const discount =
    draft.discount.type === "none"
      ? null
      : draft.discount.type === "percent"
        ? ({ type: "percent", value: draft.discount.value } as const)
        : ({ type: "fixed", cents: amount(draft.discount.value, "discount.value", issues) } as const);

  const expenses = draft.expenses.map((e, i) => ({
    id: e.id,
    description: e.description,
    costCents: amount(e.cost, `expenses.${i}.cost`, issues),
    markupPct: e.markupPct,
    recurring: e.recurring,
    ...(e.recurring ? { period: e.period } : {}),
  }));

  const shared = {
    expenses,
    urgent: draft.urgent,
    urgencyPct: draft.urgencyPct,
    contingencyPct: draft.contingencyPct,
    discount,
    minimumHourlyRateCents: ctx.minimumHourlyRateCents,
  };

  let input: EstimateInput;
  if (draft.method === "time") {
    input = {
      method: "time",
      ...shared,
      labour: draft.labour.map((l, i) => ({
        id: l.id,
        task: l.task,
        category: l.category,
        hours: l.hours,
        rateCents: amount(l.rate, `labour.${i}.rate`, issues),
        rateOverridden: isOverride(l, ctx),
      })),
    };
  } else {
    if (!draft.complexity) issues.push({ path: "complexity", message: "Choose a project complexity" });
    input = {
      method: "fixed",
      ...shared,
      complexity: draft.complexity ?? "basic",
      complexityMultiplier: ctx.multipliers[draft.complexity ?? "basic"],
      deliverables: draft.deliverables.map((d, i) => ({
        id: d.id,
        name: d.name,
        priceCents: amount(d.price, `deliverables.${i}.price`, issues),
        estimatedHours: d.estimatedHours,
      })),
    };
  }

  // Always run the engine, even when an amount failed to parse (that amount is a 0 placeholder),
  // so every problem is reported at once. The parse message wins for any field it already named.
  try {
    const result = calculateEstimate(input);
    return issues.length ? { ok: false, issues } : { ok: true, input, result };
  } catch (e) {
    if (!(e instanceof PricingValidationError)) throw e;
    const seen = new Set(issues.map((i) => i.path));
    for (const f of e.fieldIssues) {
      const path = renamePath(f.path);
      if (!seen.has(path)) {
        seen.add(path);
        issues.push({ path, message: f.message });
      }
    }
    return { ok: false, issues };
  }
}

/** EST3: a rate that differs from the configured default is an override and is flagged. */
export function isOverride(line: Pick<DraftLabour, "category" | "rate">, ctx: PricingContext): boolean {
  const def = ctx.defaultRatesCents[line.category];
  if (def === undefined) return true;
  try {
    return parseAmountToCents(line.rate) !== def;
  } catch {
    return true;
  }
}

export { COMPLEXITIES, LABOUR_CATEGORIES };

/** EST2: which lines are lost when switching method, so the owner can confirm first. */
export function linesDroppedBySwitch(draft: EstimateDraft, to: "time" | "fixed"): string[] {
  if (draft.method === to) return [];
  return draft.method === "time"
    ? draft.labour.map((l) => l.task || "Untitled labour line")
    : draft.deliverables.map((d) => d.name || "Untitled deliverable");
}

/** A new, empty draft. Ids are supplied by the caller so this stays pure. */
export function blankDraft(
  currency: Currency,
  newId: () => string,
  defaults: { urgencyPct: string; contingencyPct: string },
  ctx: Pick<PricingContext, "defaultRatesCents">,
): EstimateDraft {
  const rate = ctx.defaultRatesCents.development;
  return {
    method: "time",
    currency,
    complexity: null,
    urgent: false,
    urgencyPct: defaults.urgencyPct,
    contingencyPct: defaults.contingencyPct,
    discount: { type: "none", value: "" },
    labour: [{ id: newId(), task: "", category: "development", hours: "", rate: rate === undefined ? "" : centsToAmountString(rate) }],
    deliverables: [],
    expenses: [],
  };
}

const FIELD_WORDS: Record<string, string> = {
  rate: "rate", hours: "hours", task: "task", price: "price", name: "name", estimatedHours: "estimated hours",
  cost: "cost", markupPct: "markup", description: "description", period: "period", value: "value",
};
const LIST_WORDS: Record<string, string> = { labour: "Labour line", deliverables: "Deliverable", expenses: "Expense" };

/** "labour.1.hours" -> "Labour line 2: hours", for lists of problems in the summary panel. */
export function describePath(path: string): string {
  const [list, index, field] = path.split(".");
  if (list && LIST_WORDS[list] && index !== undefined && /^\d+$/.test(index)) {
    return `${LIST_WORDS[list]} ${Number(index) + 1}${field ? `: ${FIELD_WORDS[field] ?? field}` : ""}`;
  }
  const names: Record<string, string> = {
    urgencyPct: "Urgency", contingencyPct: "Contingency", discount: "Discount", "discount.value": "Discount", complexity: "Complexity",
    projectId: "Project", title: "Title",
  };
  return names[path] ?? path;
}
