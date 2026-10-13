import { z } from "zod";
import { dec, hasMaxDecimals } from "../money";

/**
 * One definition of "valid" (EST9). Forms and server actions both parse with these schemas;
 * the engine parses again, so an invalid estimate can never be priced.
 */

export const LABOUR_CATEGORIES = ["development", "design", "testing", "consulting", "project_management"] as const;
export type LabourCategory = (typeof LABOUR_CATEGORIES)[number];

export const COMPLEXITIES = ["basic", "intermediate", "advanced", "enterprise"] as const;
export type Complexity = (typeof COMPLEXITIES)[number];

interface DecimalRule {
  min: number;
  max?: number;
  /** When true the value must be strictly greater than `min`. */
  exclusiveMin?: boolean;
}

/** A decimal with at most two places, accepted as a number or a string (form input). */
function decimal(label: string, rule: DecimalRule) {
  return z.union([z.number(), z.string()]).superRefine((v, ctx) => {
    let d;
    try {
      d = dec(v);
    } catch {
      ctx.addIssue({ code: "custom", message: `${label} must be a number` });
      return;
    }
    if (!hasMaxDecimals(v, 2)) ctx.addIssue({ code: "custom", message: `${label} allows at most two decimal places` });
    if (rule.exclusiveMin ? d.lte(rule.min) : d.lt(rule.min)) {
      ctx.addIssue({
        code: "custom",
        message: rule.exclusiveMin ? `${label} must be above ${rule.min}` : `${label} must be at least ${rule.min}`,
      });
    }
    if (rule.max !== undefined && d.gt(rule.max)) ctx.addIssue({ code: "custom", message: `${label} must be at most ${rule.max}` });
  });
}

const hours = (label: string) => decimal(label, { min: 0, exclusiveMin: true });
const percent = (label: string) => decimal(label, { min: 0, max: 100 });
const cents = (label: string, positive = false) =>
  z
    .number({ invalid_type_error: `${label} must be an amount in cents` })
    .int(`${label} must be whole cents`)
    .safe(`${label} is too large`)
    [positive ? "positive" : "nonnegative"](positive ? `${label} must be above zero` : `${label} must not be negative`);

const labourLine = z.object({
  id: z.string().min(1),
  task: z.string().min(1, "Task is required"),
  category: z.enum(LABOUR_CATEGORIES),
  hours: hours("Hours"),
  /** Cents per hour. Defaults come from settings; the UI flags any override (EST3). */
  rateCents: cents("Rate", true),
  rateOverridden: z.boolean().optional(),
});

const deliverableLine = z.object({
  id: z.string().min(1),
  name: z.string().min(1, "Deliverable is required"),
  priceCents: cents("Price", true),
  /** Internal only. Never shown on a quotation. */
  estimatedHours: hours("Estimated hours"),
});

const expenseLine = z
  .object({
    id: z.string().min(1),
    description: z.string().min(1, "Description is required"),
    costCents: cents("Cost"),
    markupPct: percent("Markup"),
    recurring: z.boolean(),
    /** Required for recurring lines; the amount is billed per period. */
    period: z.enum(["monthly", "annual"]).optional(),
  })
  .refine((l) => !l.recurring || l.period !== undefined, {
    message: "Recurring expenses need a period",
    path: ["period"],
  });

const discount = z.discriminatedUnion("type", [
  z.object({ type: z.literal("percent"), value: percent("Discount") }),
  z.object({ type: z.literal("fixed"), cents: cents("Discount") }),
]);

const shared = {
  expenses: z.array(expenseLine).default([]),
  urgent: z.boolean().default(false),
  urgencyPct: percent("Urgency").default(0),
  contingencyPct: percent("Contingency").default(0),
  discount: discount.nullish(),
  /** Minimum effective hourly rate from settings, in cents. 0 disables the warning. */
  minimumHourlyRateCents: cents("Minimum rate").default(0),
};

export const estimateInputSchema = z.discriminatedUnion("method", [
  z.object({
    method: z.literal("time"),
    labour: z.array(labourLine),
    ...shared,
  }),
  z.object({
    method: z.literal("fixed"),
    deliverables: z.array(deliverableLine),
    complexity: z.enum(COMPLEXITIES),
    /** Multiplier for the chosen complexity, from settings (SET4). Seeded at 1.00. */
    complexityMultiplier: decimal("Complexity multiplier", { min: 0, exclusiveMin: true }),
    ...shared,
  }),
]);

export type EstimateInput = z.input<typeof estimateInputSchema>;
export type ParsedEstimateInput = z.output<typeof estimateInputSchema>;
export type LabourLine = z.input<typeof labourLine>;
export type DeliverableLine = z.input<typeof deliverableLine>;
export type ExpenseLine = z.input<typeof expenseLine>;
