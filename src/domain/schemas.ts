import { z } from "zod";
import { COMPLEXITIES, LABOUR_CATEGORIES } from "./pricing/schema";
import { CURRENCIES, dec, hasMaxDecimals } from "./money";
import { CODE_PATTERN, validateNumberPattern } from "./numbering";
import { DomainError } from "./errors";
import { isCalendarDate } from "./dates";

/**
 * Shared by forms and server actions: one definition of valid. Money is carried in cents.
 * Forms edit major-unit strings and convert with parseAmountToCents before parsing here.
 */

const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const optionalText = z.preprocess(blank, z.string().trim().max(2000).optional());
const requiredText = (label: string, max = 200) =>
  z.string({ required_error: `${label} is required` }).trim().min(1, `${label} is required`).max(max);
const email = z.preprocess(blank, z.string().trim().email("Enter a valid email address").max(200).optional());
const cents = z.number().int().safe().min(0, "Must not be negative");
const pct = (label: string, max = 100) =>
  z
    .union([z.number(), z.string()])
    .refine((v) => { try { return hasMaxDecimals(v, 2); } catch { return false; } }, `${label} allows at most two decimal places`)
    .refine((v) => { try { const d = dec(v); return d.gte(0) && d.lte(max); } catch { return false; } }, `${label} must be between 0 and ${max}`);
const calendarDate = z.preprocess(blank, z.string().refine(isCalendarDate, "Enter a valid date").optional());
const code = z.preprocess(
  (v) => (typeof v === "string" ? (v.trim() === "" ? undefined : v.trim().toUpperCase()) : v),
  z.string().regex(CODE_PATTERN, "Use 2 to 8 letters or digits").optional(),
);

export const currencySchema = z.enum(CURRENCIES);

export const bankingDetailsSchema = z.object({
  bankName: optionalText,
  accountName: optionalText,
  accountNumber: optionalText,
  branchCode: optionalText,
  swiftCode: optionalText,
  accountType: optionalText,
  instructions: optionalText,
});

export const milestoneTemplateSchema = z.object({
  label: requiredText("Milestone name", 80),
  percent: pct("Percent").refine((v) => dec(v).gt(0), "Must be above 0"),
});

const numberPattern = (label: string) =>
  z.string().trim().superRefine((v, ctx) => {
    try {
      validateNumberPattern(v);
    } catch (e) {
      ctx.addIssue({ code: "custom", message: `${label}: ${e instanceof DomainError ? e.message : "invalid pattern"}` });
    }
  });

export const businessSettingsSchema = z
  .object({
    legalName: requiredText("Legal name"),
    tradingName: optionalText,
    registrationNumber: optionalText,
    address: z.string().trim().max(1000).default(""),
    email,
    phone: optionalText,
    defaultCurrency: currencySchema,
    hoursPerDay: pct("Hours per day", 24).refine((v) => dec(v).gt(0), "Must be above 0"),
    urgencyPct: pct("Urgency"),
    contingencyPct: pct("Contingency"),
    quotationValidityDays: z.number().int().min(1).max(365),
    paymentTermsDays: z.number().int().min(0).max(365),
    upcomingWindowDays: z.number().int().min(1).max(90),
    defaultMilestones: z.array(milestoneTemplateSchema),
    revisionPolicy: z.string().trim().max(4000).default(""),
    termsAndConditions: z.string().trim().max(20000).default(""),
    quotationPattern: numberPattern("Quotation pattern"),
    invoicePattern: numberPattern("Invoice pattern"),
    // VAT (SET6): visible but off. The number and rate stay hidden while the flag is off.
    vatRegistered: z.boolean(),
    vatThresholdCents: cents.nullable(),
    vatWarnSharePct: pct("Warning share"),
  })
  .superRefine((v, ctx) => {
    if (v.defaultMilestones.length > 0) {
      const total = v.defaultMilestones.reduce((s, m) => s + dec(m.percent).toNumber() * 100, 0);
      if (Math.round(total) !== 10000) {
        ctx.addIssue({ code: "custom", path: ["defaultMilestones"], message: "Milestone percentages must total exactly 100" });
      }
    }
  });
export type BusinessSettingsInput = z.input<typeof businessSettingsSchema>;
export type BusinessSettings = z.output<typeof businessSettingsSchema>;

export const currencySettingsSchema = z.object({
  currency: currencySchema,
  minimumHourlyRateCents: cents,
  /** Hourly rate per category in cents. A missing category means "not configured". */
  rates: z.record(z.enum(LABOUR_CATEGORIES), cents.refine((v) => v > 0, "Rate must be above 0")),
  bankingDetails: bankingDetailsSchema,
});
export type CurrencySettingsInput = z.input<typeof currencySettingsSchema>;

const multiplier = z
  .union([z.number(), z.string()])
  .refine(
    (v) => {
      try {
        return hasMaxDecimals(v, 2) && dec(v).gt(0) && dec(v).lte(10);
      } catch {
        return false;
      }
    },
    "Between 0.01 and 10, with two decimals",
  );

/** SET4: seeded at 1.00 so nothing is assumed. */
export const complexityMultipliersSchema = z.object({
  basic: multiplier,
  intermediate: multiplier,
  advanced: multiplier,
  enterprise: multiplier,
});

export const clientSchema = z.object({
  name: requiredText("Name"),
  code,
  contactPerson: optionalText,
  email,
  phone: optionalText,
  address: optionalText,
  companyName: optionalText,
  registrationNumber: optionalText,
  vatNumber: optionalText,
  notes: optionalText,
});
export type ClientInput = z.input<typeof clientSchema>;

export const PROJECT_STATUSES = ["LEAD", "QUOTED", "ACTIVE", "ON_HOLD", "COMPLETED", "CANCELLED"] as const;
export const projectSchema = z.object({
  clientId: z.string().uuid("Choose a client"),
  name: requiredText("Project name"),
  code,
  description: optionalText,
  status: z.enum(PROJECT_STATUSES).default("LEAD"),
  deadline: calendarDate,
});
export type ProjectInput = z.input<typeof projectSchema>;

/** Estimate metadata. The pricing lines themselves are validated by estimateInputSchema. */
export const estimateMetaSchema = z.object({
  projectId: z.string().uuid("Choose a project"),
  title: requiredText("Title"),
  currency: currencySchema,
  complexity: z.enum(COMPLEXITIES).nullable(),
  internalNotes: optionalText,
});
export type EstimateMetaInput = z.input<typeof estimateMetaSchema>;

const longText = (max: number) => z.string().trim().max(max).default("");

/** What can be edited on a draft quotation. Lines and totals come from the estimate snapshot and are not editable. */
export const quotationDraftSchema = z
  .object({
    title: longText(200),
    scope: longText(10000),
    deliverables: longText(10000),
    exclusions: longText(10000),
    timeline: longText(2000),
    revisionPolicy: longText(4000),
    terms: longText(20000),
    /** QUO6: percentages must total exactly 100. Empty means a single "Full payment" milestone; omitted leaves the schedule unchanged. */
    milestones: z.array(milestoneTemplateSchema).max(12).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.milestones && v.milestones.length > 0) {
      const total = v.milestones.reduce((s, m) => s + Math.round(dec(m.percent).toNumber() * 100), 0);
      if (total !== 10000) {
        ctx.addIssue({ code: "custom", path: ["milestones"], message: "Milestone percentages must total exactly 100" });
      }
    }
  });
export type QuotationDraftInput = z.input<typeof quotationDraftSchema>;

export const acceptanceSchema = z.object({ acceptedBy: z.preprocess(blank, z.string().trim().max(200).optional()) });
export const rejectionSchema = z.object({ reason: z.preprocess(blank, z.string().trim().max(1000).optional()) });

export const PAYMENT_METHODS = ["EFT", "CARD", "CASH", "OTHER"] as const;
export const PAYMENT_LABELS = ["DEPOSIT", "MILESTONE", "FINAL", "OTHER"] as const;

/** PAY1. The amount is a major-unit string from the form; the service converts it to cents. */
export const paymentSchema = z.object({
  amount: z.string().trim().min(1, "Enter the amount received"),
  receivedOn: z.string().refine(isCalendarDate, "Enter the date the money was received"),
  method: z.enum(PAYMENT_METHODS),
  /** Descriptive only: it never changes a calculation. */
  label: z.enum(PAYMENT_LABELS).default("OTHER"),
  reference: optionalText,
  notes: optionalText,
});
export type PaymentInput = z.input<typeof paymentSchema>;

/** INV1: a custom invoice states its reason and its own lines. */
export const customInvoiceSchema = z.object({
  reason: requiredText("Reason", 500),
  lines: z
    .array(z.object({ description: requiredText("Description", 300), amount: z.string().trim().min(1, "Enter an amount") }))
    .min(1, "Add at least one line")
    .max(30),
});
export type CustomInvoiceInput = z.input<typeof customInvoiceSchema>;

export const reasonSchema = z.object({ reason: requiredText("A reason", 500) });
export const issueInvoiceSchema = z.object({ zarValue: z.string().trim().optional() });
export type IssueInvoiceInput = z.input<typeof issueInvoiceSchema>;
