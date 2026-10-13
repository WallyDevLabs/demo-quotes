import { describe, expect, it } from "vitest";
import { evaluateDraft, type EstimateDraft, type PricingContext } from "@/domain/pricing/draft";
import {
  buildPaymentSchedule,
  buildQuotationContent,
  buildQuotationDocument,
  documentText,
  assertReconciles,
  type QuotationDocInput,
} from "@/domain/quotation";
import { DomainError } from "@/domain/errors";

const ctx: PricingContext = {
  multipliers: { basic: "1.00", intermediate: "1.20", advanced: "1.45", enterprise: "1.80" },
  minimumHourlyRateCents: 55_000,
  defaultRatesCents: { development: 60_000, design: 50_000 },
};

const timeDraft: EstimateDraft = {
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
  expenses: [
    { id: "e", description: "Hosting", cost: "1200.00", markupPct: "10", recurring: false, period: "monthly" },
    { id: "r", description: "Maintenance", cost: "1000.00", markupPct: "0", recurring: true, period: "monthly" },
  ],
};

const evalOk = (d: EstimateDraft) => {
  const r = evaluateDraft(d, ctx);
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.result;
};

describe("quotation content (QUO1 whitelist)", () => {
  const result = evalOk(timeDraft);
  const c = buildQuotationContent(timeDraft, result, "ZAR");

  it("itemises labour, urgency, contingency and expenses as separate lines", () => {
    expect(c.lines.map((l) => [l.kind, l.description])).toEqual([
      ["LABOUR", "Development"],
      ["LABOUR", "Design"],
      ["URGENCY", "Urgent delivery surcharge"],
      ["CONTINGENCY", "Contingency"],
      ["EXPENSE", "Hosting"],
      ["RECURRING", "Maintenance"],
    ]);
    expect(c.lines[0]!.detail).toBe("40 h x R600.00");
  });

  it("lines add up to the totals to the cent and match the engine", () => {
    expect(c.subtotalCents).toBe(3_902_000);
    expect(c.discountCents).toBe(195_100);
    expect(c.totalCents).toBe(3_706_900);
    const billed = c.lines.filter((l) => l.kind !== "RECURRING").reduce((s, l) => s + l.amountCents, 0);
    expect(billed).toBe(c.subtotalCents);
  });

  it("shows the billed expense only, never cost or markup", () => {
    expect(c.lines.find((l) => l.kind === "EXPENSE")!.amountCents).toBe(132_000);
  });

  it("keeps recurring lines out of the totals", () => {
    const recurring = c.lines.find((l) => l.kind === "RECURRING")!;
    expect(recurring.amountCents).toBe(100_000);
    expect(recurring.detail).toBe("per month");
    expect(c.totalCents).toBe(3_706_900);
  });

  it("never carries internal data, even by name", () => {
    const text = JSON.stringify(c);
    for (const word of ["cost", "markup", "effective", "internal", "estimatedHours", "minimum", "notes", "1200", "120000"]) {
      expect(text.toLowerCase()).not.toContain(word.toLowerCase());
    }
    expect(Object.keys(c).sort()).toEqual(["discountCents", "lines", "subtotalCents", "totalCents"]);
    for (const l of c.lines) expect(Object.keys(l).sort()).toEqual(["amountCents", "description", "detail", "kind"]);
  });

  it("does not copy extra fields added to the estimate later", () => {
    const polluted = { ...result, secretMargin: 12345, internal: { ...result.internal, note: "hidden" } } as typeof result;
    const text = JSON.stringify(buildQuotationContent(timeDraft, polluted, "ZAR"));
    expect(text).not.toContain("secretMargin");
    expect(text).not.toContain("hidden");
  });

  it("fixed price shows deliverables after complexity, with no hours", () => {
    const fixed: EstimateDraft = {
      ...timeDraft,
      method: "fixed",
      complexity: "advanced",
      urgent: false,
      discount: { type: "none", value: "" },
      expenses: [],
      deliverables: [{ id: "d", name: "Web app", price: "10000", estimatedHours: "20" }],
    };
    const fc = buildQuotationContent(fixed, evalOk(fixed), "ZAR");
    expect(fc.lines[0]).toEqual({ kind: "DELIVERABLE", description: "Web app", detail: "", amountCents: 1_450_000 });
    expect(JSON.stringify(fc)).not.toMatch(/estimatedHours|1\.45/);
  });

  it("refuses lines that do not reconcile", () => {
    expect(() => assertReconciles({ ...c, totalCents: c.totalCents + 1 })).toThrow(DomainError);
  });
});

describe("payment schedule (QUO6)", () => {
  it("defaults to full payment", () => {
    expect(buildPaymentSchedule(100_000, [])).toEqual([{ label: "Full payment", percent: "100.00", amountCents: 100_000 }]);
  });
  it("sums to the total, including awkward totals", () => {
    const ms = [{ label: "Deposit", percent: "33.33" }, { label: "Build", percent: "33.33" }, { label: "Final", percent: "33.34" }];
    for (const total of [1, 100, 10_001, 3_706_900]) {
      expect(buildPaymentSchedule(total, ms).reduce((s, m) => s + m.amountCents, 0)).toBe(total);
    }
  });
  it("rejects percentages that do not total 100", () => {
    expect(() => buildPaymentSchedule(100, [{ label: "A", percent: "60" }, { label: "B", percent: "30" }])).toThrow(DomainError);
  });
});

describe("quotation document (VAT off)", () => {
  const content = buildQuotationContent(timeDraft, evalOk(timeDraft), "ZAR");
  const input: QuotationDocInput = {
    number: "QUO20260001",
    issueDate: "2026-10-13",
    expiryDate: "2026-11-12",
    currency: "ZAR",
    business: { legalName: "Katlego Barayi", tradingName: null, registrationNumber: null, address: "1 Main Rd, Pretoria", email: "k@example.com", phone: "", logoFileId: null },
    client: { name: "Thabo", companyName: "Acme (Pty) Ltd", contactPerson: "Thabo", email: "t@acme.test", phone: null, address: null, registrationNumber: null },
    projectName: "Dispatch app",
    title: "Phase 1",
    scope: "Build the app.",
    deliverables: "Web app",
    exclusions: "Hosting fees",
    timeline: "8 weeks",
    revisionPolicy: "Two rounds",
    terms: "Net 14",
    content,
    schedule: buildPaymentSchedule(content.totalCents, [{ label: "Deposit", percent: "50" }, { label: "Final", percent: "50" }]),
  };

  it("is titled Quotation and carries every required section", () => {
    const d = buildQuotationDocument(input);
    expect(d.title).toBe("Quotation");
    expect(d.number).toBe("QUO20260001");
    expect(d.totals.total).toBe("R37 069.00");
    expect(d.totals.discount).toBe("R1 951.00");
    expect(d.schedule.map((s) => s.amount)).toEqual(["R18 534.50", "R18 534.50"]);
    expect(d.recurring[0]!.amount).toBe("R1 000.00");
    expect(d.acceptance).toMatch(/sign/);
  });

  it("never mentions VAT or a tax invoice, in any text", () => {
    const text = documentText(buildQuotationDocument(input));
    expect(text).not.toMatch(/vat/i);
    expect(text).not.toMatch(/tax invoice/i);
    expect(text).not.toMatch(/tax/i);
  });

  it("marks a draft clearly", () => {
    const d = buildQuotationDocument({ ...input, number: null, issueDate: null, expiryDate: null });
    expect(d.isDraft).toBe(true);
    expect(d.number).toMatch(/Draft/);
  });

  it("formats USD without converting", () => {
    const usd = buildQuotationDocument({ ...input, currency: "USD" });
    expect(usd.totals.total).toBe("US$37 069.00");
  });
});

import { reconcileQuotation } from "@/domain/quotation";

describe("reconcileQuotation (the hand check)", () => {
  const content = buildQuotationContent(timeDraft, evalOk(timeDraft), "ZAR");
  const schedule = buildPaymentSchedule(content.totalCents, [{ label: "Deposit", percent: "33.33" }, { label: "Build", percent: "33.33" }, { label: "Final", percent: "33.34" }]);
  const stored = { ...content, milestones: schedule };

  it("passes every check for a correctly built quotation", () => {
    const checks = reconcileQuotation(stored);
    expect(checks).toHaveLength(4);
    expect(checks.every((c) => c.ok)).toBe(true);
  });
  it("fails the right check when a stored figure is off by one cent", () => {
    expect(reconcileQuotation({ ...stored, totalCents: stored.totalCents + 1 }).filter((c) => !c.ok).map((c) => c.label)).toEqual([
      "Subtotal minus discount equals the total",
      "Milestone amounts add up to the total",
    ]);
    expect(reconcileQuotation({ ...stored, subtotalCents: stored.subtotalCents + 1 })[0]!.ok).toBe(false);
    const badMs = stored.milestones.map((m, i) => (i === 0 ? { ...m, amountCents: m.amountCents + 1 } : m));
    expect(reconcileQuotation({ ...stored, milestones: badMs })[2]!.ok).toBe(false);
    expect(reconcileQuotation({ ...stored, milestones: stored.milestones.map((m, i) => (i === 0 ? { ...m, percent: "30.00" } : m)) })[3]!.ok).toBe(false);
  });
  it("leaves recurring lines out of the subtotal", () => {
    expect(content.lines.some((l) => l.kind === "RECURRING")).toBe(true);
    expect(reconcileQuotation(stored)[0]).toMatchObject({ ok: true, expectedCents: content.subtotalCents });
  });
});
