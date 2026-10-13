import { describe, expect, it } from "vitest";
import { centsToAmountString, formatMoney, parseAmountToCents } from "@/domain/money";
import { evaluateDraft, isOverride, linesDroppedBySwitch, type EstimateDraft, type PricingContext } from "@/domain/pricing/draft";
import { formatDocumentNumber, normaliseCode } from "@/domain/numbering";
import { businessSettingsSchema, clientSchema, projectSchema } from "@/domain/schemas";
import { businessFormToInput, currencyFormToInput, emptyCurrencyForm } from "@/domain/settings-forms";
import { DomainError } from "@/domain/errors";

const ctx: PricingContext = {
  multipliers: { basic: "1.00", intermediate: "1.20", advanced: "1.45", enterprise: "1.80" },
  minimumHourlyRateCents: 55_000,
  defaultRatesCents: { development: 60_000, design: 50_000 },
};

const draft = (over: Partial<EstimateDraft> = {}): EstimateDraft => ({
  method: "time",
  currency: "ZAR",
  complexity: null,
  urgent: true,
  urgencyPct: "20",
  contingencyPct: "10",
  discount: { type: "percent", value: "5" },
  labour: [
    { id: "a", task: "Development", category: "development", hours: "40", rate: "600.00" },
    { id: "b", task: "Design", category: "design", hours: "10", rate: "500.00" },
  ],
  deliverables: [],
  expenses: [{ id: "e", description: "Hosting", cost: "1200.00", markupPct: "10", recurring: false, period: "monthly" }],
  ...over,
});

describe("amount parsing", () => {
  it("parses major units to cents", () => {
    expect(parseAmountToCents("600")).toBe(60_000);
    expect(parseAmountToCents("1 234.50")).toBe(123_450);
    expect(parseAmountToCents("1234,5")).toBe(123_450);
    expect(parseAmountToCents("0.1") + parseAmountToCents("0.2")).toBe(30);
  });
  it("rejects junk and a third decimal", () => {
    expect(() => parseAmountToCents("abc")).toThrow();
    expect(() => parseAmountToCents("")).toThrow();
    expect(() => parseAmountToCents("1.005")).toThrow(/two decimal/);
  });
  it("round trips", () => {
    for (const c of [0, 5, 100, 123_456_789]) expect(parseAmountToCents(centsToAmountString(c))).toBe(c);
  });
  it("formats each currency without converting", () => {
    expect(formatMoney(3_706_900, "ZAR")).toBe("R37 069.00");
    expect(formatMoney(3_706_900, "USD")).toBe("US$37 069.00");
  });
});

describe("estimate draft (the model the form and server share)", () => {
  it("prices the PRD worked example from strings", () => {
    const r = evaluateDraft(draft(), ctx);
    expect(r.ok && r.result.breakdown.totalCents).toBe(3_706_900);
  });

  it("uses the settings multiplier for fixed price, never one from the draft", () => {
    const r = evaluateDraft(
      draft({
        method: "fixed",
        complexity: "advanced",
        urgent: false,
        discount: { type: "none", value: "" },
        expenses: [],
        deliverables: [{ id: "d", name: "Site", price: "10000", estimatedHours: "20" }],
      }),
      ctx,
    );
    expect(r.ok && r.result.breakdown.baseCents).toBe(1_450_000);
  });

  it("requires a complexity for fixed price", () => {
    const r = evaluateDraft(draft({ method: "fixed", complexity: null, deliverables: [{ id: "d", name: "Site", price: "100", estimatedHours: "1" }] }), ctx);
    expect(!r.ok && r.issues.some((i) => i.path === "complexity")).toBe(true);
  });

  it("returns field level issues on the form's own field names", () => {
    const d = draft();
    d.labour[0]!.rate = "x";
    d.labour[1]!.hours = "0";
    d.expenses[0]!.cost = "-5";
    d.discount = { type: "fixed", value: "999999" };
    const r = evaluateDraft(d, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const paths = r.issues.map((i) => i.path);
      expect(paths).toEqual(expect.arrayContaining(["labour.0.rate", "labour.1.hours", "expenses.0.cost"]));
    }
  });

  it("names the discount field when it exceeds the subtotal", () => {
    const r = evaluateDraft(draft({ discount: { type: "fixed", value: "999999" } }), ctx);
    expect(!r.ok && r.issues.map((i) => i.path)).toContain("discount.value");
  });

  it("flags rate overrides against the configured default (EST3)", () => {
    expect(isOverride({ category: "development", rate: "600.00" }, ctx)).toBe(false);
    expect(isOverride({ category: "development", rate: "650" }, ctx)).toBe(true);
    expect(isOverride({ category: "testing", rate: "400" }, ctx)).toBe(true); // no default configured
  });

  it("names the lines lost when switching method (EST2)", () => {
    expect(linesDroppedBySwitch(draft(), "fixed")).toEqual(["Development", "Design"]);
    expect(linesDroppedBySwitch(draft(), "time")).toEqual([]);
  });

  it("warns below the minimum hourly rate and not above it", () => {
    const low = evaluateDraft(draft({ urgent: false, contingencyPct: "0", discount: { type: "none", value: "" }, expenses: [] }), { ...ctx, minimumHourlyRateCents: 70_000 });
    expect(low.ok && low.result.internal.belowMinimumRate).toBe(true); // R580/h blended
    const ok = evaluateDraft(draft({ urgent: false, contingencyPct: "0", discount: { type: "none", value: "" }, expenses: [] }), ctx);
    expect(ok.ok && ok.result.internal.belowMinimumRate).toBe(false);
  });
});

describe("numbering tokens", () => {
  it("supports {PRJ} and {CLIENT} on one gap free sequence", () => {
    expect(formatDocumentNumber("INV-{PRJ}-{SEQ:3}", 7, 2026, { project: "acme" })).toBe("INV-ACME-007");
    expect(formatDocumentNumber("{CLIENT}/{YYYY}/{SEQ:4}", 12, 2026, { client: "bt" })).toBe("BT/2026/0012");
  });
  it("refuses to number without a code the pattern needs", () => {
    expect(() => formatDocumentNumber("INV-{PRJ}-{SEQ}", 1, 2026)).toThrow(DomainError);
    expect(() => formatDocumentNumber("INV-{CLIENT}-{SEQ}", 1, 2026, { project: "x1" })).toThrow(DomainError);
  });
  it("normalises codes", () => {
    expect(normaliseCode(" ac-1 ")).toBe("AC-1");
  });
});

describe("shared schemas", () => {
  it("clients need a name, accept optional fields, and normalise the code", () => {
    expect(clientSchema.safeParse({ name: "" }).success).toBe(false);
    const v = clientSchema.parse({ name: "Acme", code: " ac1 ", email: "", phone: "" });
    expect(v.code).toBe("AC1");
    expect(v.email).toBeUndefined();
    expect(clientSchema.safeParse({ name: "A", email: "nope" }).success).toBe(false);
    expect(clientSchema.safeParse({ name: "A", code: "!" }).success).toBe(false);
  });
  it("projects need a client and a real deadline", () => {
    const id = "6f0f5a58-2f6e-4f0e-8d3e-6c7b2f1d9a11";
    expect(projectSchema.safeParse({ clientId: "x", name: "P" }).success).toBe(false);
    expect(projectSchema.safeParse({ clientId: id, name: "P", deadline: "2026-02-30" }).success).toBe(false);
    expect(projectSchema.parse({ clientId: id, name: "P", deadline: "2026-12-31" }).status).toBe("LEAD");
  });

  const goodBusiness = {
    legalName: "Katlego Barayi",
    tradingName: "",
    registrationNumber: "",
    address: "",
    email: "",
    phone: "",
    defaultCurrency: "ZAR" as const,
    hoursPerDay: "8",
    urgencyPct: "20",
    contingencyPct: "10",
    quotationValidityDays: "30",
    paymentTermsDays: "14",
    upcomingWindowDays: "14",
    defaultMilestones: [
      { label: "Deposit", percent: "50" },
      { label: "Final", percent: "50" },
    ],
    revisionPolicy: "",
    termsAndConditions: "",
    quotationPattern: "QUO{YYYY}{SEQ:4}",
    invoicePattern: "INV{YYYY}{SEQ:4}",
    vatRegistered: false,
    vatThreshold: "",
    vatWarnSharePct: "80",
  };

  it("accepts good business settings from form strings", () => {
    const { input, issues } = businessFormToInput(goodBusiness);
    expect(issues).toEqual([]);
    expect(businessSettingsSchema.safeParse(input).success).toBe(true);
  });
  it("rejects milestones that do not total 100 and bad patterns", () => {
    const bad = businessFormToInput({ ...goodBusiness, defaultMilestones: [{ label: "A", percent: "60" }, { label: "B", percent: "30" }], quotationPattern: "QUO{YYYY}" });
    const r = businessSettingsSchema.safeParse(bad.input);
    expect(r.success).toBe(false);
    if (!r.success) {
      const msgs = r.error.issues.map((i) => i.message).join("|");
      expect(msgs).toMatch(/total exactly 100/);
      expect(msgs).toMatch(/exactly one/);
    }
  });
  it("reports a non numeric day count as a field issue", () => {
    expect(businessFormToInput({ ...goodBusiness, paymentTermsDays: "x" }).issues[0]?.path).toBe("paymentTermsDays");
  });
  it("converts currency forms and blanks mean not configured", () => {
    const f = emptyCurrencyForm("USD");
    f.rates.development = "45";
    const { input, issues } = currencyFormToInput(f);
    expect(issues).toEqual([]);
    expect(input.rates).toEqual({ development: 4500 });
  });
});
