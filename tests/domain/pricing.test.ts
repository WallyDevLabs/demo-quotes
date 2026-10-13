import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { calculateEstimate, PricingValidationError } from "@/domain/pricing/engine";
import type { EstimateInput, LabourLine } from "@/domain/pricing/schema";

const dev: LabourLine = { id: "l1", task: "Development", category: "development", hours: 40, rateCents: 60_000 };
const design: LabourLine = { id: "l2", task: "Design", category: "design", hours: 10, rateCents: 50_000 };
const hosting = { id: "e1", description: "Hosting", costCents: 120_000, markupPct: 10, recurring: false };

/** The PRD v2 worked example: the first automated fixture. */
const workedExample: EstimateInput = {
  method: "time",
  labour: [dev, design],
  urgent: true,
  urgencyPct: 20,
  contingencyPct: 10,
  expenses: [hosting],
  discount: { type: "percent", value: 5 },
  minimumHourlyRateCents: 0,
};

describe("Method A: time based (PRD worked example)", () => {
  const r = calculateEstimate(workedExample);

  it("returns exactly R37,069.00", () => {
    expect(r.breakdown).toEqual({
      baseCents: 2_900_000,
      complexityAdjustmentCents: 0,
      urgencyCents: 580_000,
      contingencyCents: 290_000,
      expensesBilledCents: 132_000,
      subtotalCents: 3_902_000,
      discountCents: 195_100,
      totalCents: 3_706_900,
    });
  });

  it("reports an effective hourly rate of R714.98", () => {
    expect(r.internal.effectiveHourlyRateCents).toBe(71_498);
    expect(r.internal.estimatedHours).toBe("50");
  });

  it("keeps cost, markup and contingency internal", () => {
    expect(r.internal.expenseCostCents).toBe(120_000);
    expect(r.internal.markupEarnedCents).toBe(12_000);
    expect(r.internal.contingencyCents).toBe(290_000);
  });

  it("charges contingency and urgency on labour only, never on expenses or each other", () => {
    const noExpense = calculateEstimate({ ...workedExample, expenses: [] });
    expect(noExpense.breakdown.urgencyCents).toBe(r.breakdown.urgencyCents);
    expect(noExpense.breakdown.contingencyCents).toBe(r.breakdown.contingencyCents);
  });

  it("does not charge urgency unless the urgent flag is on", () => {
    expect(calculateEstimate({ ...workedExample, urgent: false }).breakdown.urgencyCents).toBe(0);
  });

  it("applies no complexity in time based mode", () => {
    expect(r.breakdown.complexityAdjustmentCents).toBe(0);
    expect(r.breakdown.baseCents).toBe(2_900_000);
  });

  it("explains every figure with a formula and its inputs", () => {
    const keys = r.explanations.map((e) => e.key);
    expect(keys).toEqual(["labour", "urgency", "contingency", "expenses", "subtotal", "discount", "total", "effectiveRate"]);
    expect(r.explanations.find((e) => e.key === "total")!.amountCents).toBe(3_706_900);
    for (const e of r.explanations) expect(e.formula.length).toBeGreaterThan(0);
  });
});

describe("rounding", () => {
  it("rounds each labour line half up once", () => {
    const r = calculateEstimate({
      method: "time",
      labour: [{ id: "a", task: "x", category: "development", hours: "0.5", rateCents: 33_333 }],
    });
    expect(r.breakdown.baseCents).toBe(16_667); // 16666.5
  });

  it("has no floating point drift (0.1 h + 0.2 h)", () => {
    const r = calculateEstimate({
      method: "time",
      labour: [
        { id: "a", task: "a", category: "design", hours: 0.1, rateCents: 100_000 },
        { id: "b", task: "b", category: "design", hours: 0.2, rateCents: 100_000 },
      ],
    });
    expect(r.breakdown.baseCents).toBe(30_000);
  });

  it("rounds each percentage step once and sums the rounded parts", () => {
    const r = calculateEstimate({
      method: "time",
      labour: [{ id: "a", task: "x", category: "testing", hours: 1, rateCents: 10_001 }],
      urgent: true,
      urgencyPct: 15,
      contingencyPct: 15,
    });
    // 10001 x 15% = 1500.15 -> 1500 each
    expect(r.breakdown.urgencyCents).toBe(1500);
    expect(r.breakdown.contingencyCents).toBe(1500);
    expect(r.breakdown.totalCents).toBe(10_001 + 1500 + 1500);
  });

  it("rounds a line total of exactly half a cent upwards", () => {
    const r = calculateEstimate({
      method: "time",
      labour: [{ id: "a", task: "x", category: "testing", hours: "0.01", rateCents: 50 }],
    });
    expect(r.breakdown.baseCents).toBe(1); // 0.5 -> 1
  });
});

describe("discount", () => {
  it("accepts a fixed discount equal to the subtotal (total of zero, never negative)", () => {
    const r = calculateEstimate({ ...workedExample, discount: { type: "fixed", cents: 3_902_000 } });
    expect(r.breakdown.totalCents).toBe(0);
  });
  it("rejects a fixed discount larger than the subtotal", () => {
    expect(() => calculateEstimate({ ...workedExample, discount: { type: "fixed", cents: 3_902_001 } })).toThrow(
      PricingValidationError,
    );
  });
  it("rejects a percentage above 100", () => {
    expect(() => calculateEstimate({ ...workedExample, discount: { type: "percent", value: 100.01 } })).toThrow(
      PricingValidationError,
    );
  });
  it("is applied once, to the subtotal", () => {
    const r = calculateEstimate({ ...workedExample, discount: { type: "percent", value: 10 } });
    expect(r.breakdown.discountCents).toBe(390_200);
  });
});

describe("Method B: fixed price", () => {
  const fixed: EstimateInput = {
    method: "fixed",
    complexity: "advanced",
    complexityMultiplier: "1.45",
    deliverables: [
      { id: "d1", name: "Web app", priceCents: 1_000_000, estimatedHours: 20 },
      { id: "d2", name: "Landing page", priceCents: 500_000, estimatedHours: 10 },
    ],
    contingencyPct: 10,
    minimumHourlyRateCents: 80_000,
  };

  it("multiplies deliverable prices by the complexity multiplier", () => {
    const r = calculateEstimate(fixed);
    expect(r.lines.map((l) => l.adjustedCents)).toEqual([1_450_000, 725_000]);
    expect(r.breakdown.baseCents).toBe(2_175_000);
    expect(r.breakdown.complexityAdjustmentCents).toBe(675_000);
  });

  it("applies contingency to the adjusted deliverable total", () => {
    const r = calculateEstimate(fixed);
    expect(r.breakdown.contingencyCents).toBe(217_500);
    expect(r.breakdown.totalCents).toBe(2_392_500);
  });

  it("computes the effective hourly rate and warns below the minimum", () => {
    const r = calculateEstimate(fixed);
    expect(r.internal.estimatedHours).toBe("30");
    expect(r.internal.effectiveHourlyRateCents).toBe(79_750);
    expect(r.internal.belowMinimumRate).toBe(true);
    expect(calculateEstimate({ ...fixed, minimumHourlyRateCents: 79_750 }).internal.belowMinimumRate).toBe(false);
  });

  it("excludes billed pass-through expenses from the effective rate", () => {
    const r = calculateEstimate({ ...fixed, expenses: [hosting] });
    expect(r.internal.effectiveHourlyRateCents).toBe(79_750);
    expect(r.breakdown.totalCents).toBe(2_392_500 + 132_000);
  });

  it("rounds each adjusted deliverable once", () => {
    const r = calculateEstimate({
      method: "fixed",
      complexity: "basic",
      complexityMultiplier: 1.5,
      deliverables: [{ id: "a", name: "x", priceCents: 3333, estimatedHours: 1 }],
    });
    expect(r.breakdown.baseCents).toBe(5000); // 4999.5
  });

  it("changes nothing when the multiplier is the seeded 1.00", () => {
    const r = calculateEstimate({ ...fixed, complexityMultiplier: "1.00" });
    expect(r.breakdown.baseCents).toBe(1_500_000);
  });
});

describe("recurring costs", () => {
  it("are listed separately and excluded from the project total", () => {
    const withRecurring = calculateEstimate({
      ...workedExample,
      expenses: [
        hosting,
        { id: "r1", description: "Maintenance", costCents: 100_000, markupPct: 0, recurring: true, period: "monthly" },
        { id: "r2", description: "Domain", costCents: 25_000, markupPct: 20, recurring: true, period: "annual" },
      ],
    });
    expect(withRecurring.breakdown.totalCents).toBe(3_706_900);
    expect(withRecurring.recurring).toEqual({ monthlyCents: 100_000, annualCents: 30_000 });
    expect(withRecurring.recurringLines).toHaveLength(2);
  });
  it("need a period", () => {
    expect(() =>
      calculateEstimate({
        ...workedExample,
        expenses: [{ id: "r", description: "x", costCents: 1, markupPct: 0, recurring: true }],
      }),
    ).toThrow(/period/);
  });
});

describe("validation (EST9)", () => {
  const bad = (labour: Partial<LabourLine>) =>
    () => calculateEstimate({ method: "time", labour: [{ ...dev, ...labour }] });

  it("rejects zero or negative hours", () => {
    expect(bad({ hours: 0 })).toThrow(PricingValidationError);
    expect(bad({ hours: -1 })).toThrow(PricingValidationError);
  });
  it("rejects a zero rate", () => expect(bad({ rateCents: 0 })).toThrow(PricingValidationError));
  it("rejects fractional cents and more than two decimal places on hours", () => {
    expect(bad({ rateCents: 100.5 })).toThrow(PricingValidationError);
    expect(bad({ hours: "1.234" })).toThrow(/two decimal/);
  });
  it("rejects percentages outside 0 to 100", () => {
    expect(() => calculateEstimate({ ...workedExample, contingencyPct: -1 })).toThrow(PricingValidationError);
    expect(() => calculateEstimate({ ...workedExample, urgencyPct: 101 })).toThrow(PricingValidationError);
  });
  it("rejects an unknown category", () => {
    expect(bad({ category: "magic" as never })).toThrow(PricingValidationError);
  });
  it("accepts string input from forms", () => {
    const r = calculateEstimate({ method: "time", labour: [{ ...dev, hours: "40.00" }] });
    expect(r.breakdown.baseCents).toBe(2_400_000);
  });
  it("has a null effective rate and no warning when there are no hours", () => {
    const r = calculateEstimate({ method: "time", labour: [], minimumHourlyRateCents: 50_000 });
    expect(r.internal.effectiveHourlyRateCents).toBeNull();
    expect(r.internal.belowMinimumRate).toBe(false);
    expect(r.breakdown.totalCents).toBe(0);
  });
  it("is deterministic", () => {
    expect(calculateEstimate(workedExample)).toEqual(calculateEstimate(workedExample));
  });
});

describe("property tests", () => {
  const labourArb = fc.record({
    hundredths: fc.integer({ min: 1, max: 20_000 }),
    rateCents: fc.integer({ min: 1, max: 5_000_000 }),
  });
  const toLines = (xs: { hundredths: number; rateCents: number }[]): LabourLine[] =>
    xs.map((x, i) => ({
      id: `l${i}`,
      task: `t${i}`,
      category: "development",
      hours: (x.hundredths / 100).toFixed(2),
      rateCents: x.rateCents,
    }));
  const adjustments = fc.record({
    urgent: fc.boolean(),
    urgencyPct: fc.integer({ min: 0, max: 10_000 }).map((n) => (n / 100).toFixed(2)),
    contingencyPct: fc.integer({ min: 0, max: 10_000 }).map((n) => (n / 100).toFixed(2)),
  });

  it("reordering lines never changes the total", () => {
    fc.assert(
      fc.property(fc.array(labourArb, { minLength: 1, maxLength: 12 }), adjustments, (xs, adj) => {
        const lines = toLines(xs);
        const reversed = [...lines].reverse();
        const a = calculateEstimate({ method: "time", labour: lines, ...adj });
        const b = calculateEstimate({ method: "time", labour: reversed, ...adj });
        expect(b.breakdown).toEqual(a.breakdown);
      }),
    );
  });

  it("duplicating a line adds exactly that line's amount", () => {
    fc.assert(
      fc.property(fc.array(labourArb, { minLength: 1, maxLength: 10 }), (xs) => {
        const lines = toLines(xs);
        const before = calculateEstimate({ method: "time", labour: lines });
        const dup = { ...lines[0]!, id: "dup" };
        const after = calculateEstimate({ method: "time", labour: [...lines, dup] });
        const lineAmount = before.lines[0]!.amountCents;
        expect(after.breakdown.baseCents - before.breakdown.baseCents).toBe(lineAmount);
        expect(after.breakdown.totalCents - before.breakdown.totalCents).toBe(lineAmount);
      }),
    );
  });

  it("a total is never negative and the parts always sum to it", () => {
    fc.assert(
      fc.property(
        fc.array(labourArb, { maxLength: 10 }),
        adjustments,
        fc.integer({ min: 0, max: 10_000 }).map((n) => (n / 100).toFixed(2)),
        (xs, adj, discountPct) => {
          const r = calculateEstimate({
            method: "time",
            labour: toLines(xs),
            discount: { type: "percent", value: discountPct },
            ...adj,
          });
          const b = r.breakdown;
          expect(b.totalCents).toBeGreaterThanOrEqual(0);
          expect(b.subtotalCents).toBe(b.baseCents + b.urgencyCents + b.contingencyCents + b.expensesBilledCents);
          expect(b.totalCents).toBe(b.subtotalCents - b.discountCents);
          expect(b.baseCents).toBe(r.lines.reduce((s, l) => s + l.amountCents, 0));
        },
      ),
    );
  });
});
