import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { evaluateDraft, type EstimateDraft } from "@/domain/pricing/draft";
import { emptyCurrencyForm } from "@/domain/settings-forms";
import { db } from "@/server/db";
import { createClient, createProject, listClients, setClientArchived } from "@/server/clients";
import { duplicateEstimate, getEstimate, listEstimates, saveEstimate, setEstimateReady, toContext } from "@/server/estimates";
import { ServiceError } from "@/server/errors";
import { getPricingSettings, getSettings, saveCurrencySettings, saveMultipliers, setNextNumber } from "@/server/settings";

async function newOwner() {
  const u = await db.user.create({ data: { email: `${randomUUID()}@test.invalid`, passwordHash: "x" } });
  return u.id;
}

async function configureRates(ownerId: string) {
  const f = emptyCurrencyForm("ZAR");
  f.minimumHourlyRate = "550";
  f.rates.development = "600";
  f.rates.design = "500";
  await saveCurrencySettings(ownerId, f);
}

const workedExample = (): EstimateDraft => ({
  method: "time",
  currency: "ZAR",
  complexity: null,
  urgent: true,
  urgencyPct: "20",
  contingencyPct: "10",
  discount: { type: "percent", value: "5" },
  labour: [
    { id: randomUUID(), task: "Development", category: "development", hours: "40", rate: "600.00" },
    { id: randomUUID(), task: "Design", category: "design", hours: "10", rate: "500.00" },
  ],
  deliverables: [],
  expenses: [{ id: randomUUID(), description: "Hosting", cost: "1200.00", markupPct: "10", recurring: false, period: "monthly" }],
});

async function setup() {
  const ownerId = await newOwner();
  const clientId = await createClient(ownerId, { name: "Acme (Pty) Ltd", code: "acme" });
  const projectId = await createProject(ownerId, { clientId, name: "Website", code: "web1" });
  return { ownerId, clientId, projectId };
}

beforeAll(async () => {
  await db.$queryRaw`SELECT 1`;
});

describe("settings", () => {
  it("seeds complexity multipliers at 1.00 and counters at 1", async () => {
    const o = await newOwner();
    const s = await getSettings(o);
    expect(s.multipliers).toEqual({ basic: "1.00", intermediate: "1.00", advanced: "1.00", enterprise: "1.00" });
    expect(s.counters).toEqual({ quotation: 1, invoice: 1 });
    expect(s.business.vatRegistered).toBe(false);
  });

  it("ten simultaneous first loads for a brand-new owner do not collide (regression)", async () => {
    const o = await newOwner();
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => getSettings(o)));
    expect(results.filter((r) => r.status === "rejected")).toEqual([]);
    expect(await db.businessSettings.count({ where: { ownerId: o } })).toBe(1);
    expect(await db.complexityMultiplier.count({ where: { ownerId: o } })).toBe(4);
    expect(await db.numberCounter.count({ where: { ownerId: o } })).toBe(2);
  });

  it("reports rates as unconfigured until set (EST10), per currency", async () => {
    const o = await newOwner();
    expect((await getPricingSettings(o, "ZAR")).ratesConfigured).toBe(false);
    await configureRates(o);
    const zar = await getPricingSettings(o, "ZAR");
    expect(zar.ratesConfigured).toBe(true);
    expect(zar.defaultRatesCents).toEqual({ development: 60_000, design: 50_000 });
    expect(zar.minimumHourlyRateCents).toBe(55_000);
    expect((await getPricingSettings(o, "USD")).ratesConfigured).toBe(false);
  });

  it("never lowers a counter, and audits a raise", async () => {
    const o = await newOwner();
    await getSettings(o);
    await setNextNumber(o, "INVOICE", 50);
    await expect(setNextNumber(o, "INVOICE", 49)).rejects.toMatchObject({ code: "COUNTER_LOWERED" });
    expect((await getSettings(o)).counters.invoice).toBe(50);
    const logs = await db.auditLog.findMany({ where: { ownerId: o, entity: "counter" } });
    expect(logs).toHaveLength(1);
  });

  it("audits setting changes with field names only", async () => {
    const o = await newOwner();
    await configureRates(o);
    await saveMultipliers(o, { basic: "1.00", intermediate: "1.20", advanced: "1.45", enterprise: "1.80" });
    const logs = await db.auditLog.findMany({ where: { ownerId: o, action: "multipliers.update" } });
    expect(logs).toHaveLength(1);
    expect(logs[0]!.detail).toEqual({ levels: ["intermediate", "advanced", "enterprise"] });
  });

  it("rejects invalid settings with field issues", async () => {
    const o = await newOwner();
    const f = emptyCurrencyForm("ZAR");
    f.rates.development = "12.345";
    await expect(saveCurrencySettings(o, f)).rejects.toBeInstanceOf(ServiceError);
  });
});

describe("clients and projects", () => {
  it("scopes everything by owner", async () => {
    const a = await setup();
    const b = await newOwner();
    expect(await listClients(b)).toHaveLength(0);
    await expect(createProject(b, { clientId: a.clientId, name: "Steal" })).rejects.toBeInstanceOf(ServiceError);
  });

  it("normalises codes and keeps them unique per owner", async () => {
    const a = await setup();
    const clients = await listClients(a.ownerId);
    expect(clients[0]!.code).toBe("ACME");
    await expect(createClient(a.ownerId, { name: "Other", code: "ACME" })).rejects.toMatchObject({
      issues: [{ path: "code" }],
    });
  });

  it("archives instead of deleting", async () => {
    const a = await setup();
    await setClientArchived(a.ownerId, a.clientId, true);
    expect(await listClients(a.ownerId)).toHaveLength(0);
    expect(await listClients(a.ownerId, true)).toHaveLength(1);
  });
});

describe("estimates", () => {
  it("refuses to save until rates are configured (EST10)", async () => {
    const { ownerId, projectId } = await setup();
    await expect(
      saveEstimate(ownerId, null, { meta: { projectId, title: "T", currency: "ZAR", complexity: null }, draft: workedExample() }),
    ).rejects.toThrow(/hourly rates/);
  });

  it("saves and reloads the PRD worked example to R37,069.00", async () => {
    const { ownerId, projectId } = await setup();
    await configureRates(ownerId);
    const saved = await saveEstimate(ownerId, null, {
      meta: { projectId, title: "Worked example", currency: "ZAR", complexity: null },
      draft: workedExample(),
    });
    expect(saved.result.breakdown.totalCents).toBe(3_706_900);

    const dto = (await getEstimate(ownerId, saved.id))!;
    const settings = await getPricingSettings(ownerId, "ZAR");
    const again = evaluateDraft(dto.draft, toContext(settings));
    expect(again.ok && again.result.breakdown.totalCents).toBe(3_706_900);

    const list = await listEstimates(ownerId);
    expect(list[0]!.totalCents).toBe(3_706_900);
  });

  it("flags a rate override (EST3)", async () => {
    const { ownerId, projectId } = await setup();
    await configureRates(ownerId);
    const draft = workedExample();
    draft.labour[0]!.rate = "650.00";
    const saved = await saveEstimate(ownerId, null, { meta: { projectId, title: "Override", currency: "ZAR", complexity: null }, draft });
    const rows = await db.estimateLine.findMany({ where: { estimateId: saved.id, kind: "LABOUR" }, orderBy: { position: "asc" } });
    expect(rows.map((r) => r.rateOverridden)).toEqual([true, false]);
  });

  it("rejects invalid lines with field level issues from the same rules as the form", async () => {
    const { ownerId, projectId } = await setup();
    await configureRates(ownerId);
    const draft = workedExample();
    draft.labour[0]!.hours = "0";
    draft.labour[1]!.rate = "abc";
    const err = await saveEstimate(ownerId, null, { meta: { projectId, title: "Bad", currency: "ZAR", complexity: null }, draft }).catch((e) => e);
    expect(err).toBeInstanceOf(ServiceError);
    const paths = (err as ServiceError).issues.map((i) => i.path);
    expect(paths).toContain("labour.1.rate");
  });

  it("stores only the lines of the active method (EST2) and applies the multiplier on the server", async () => {
    const { ownerId, projectId } = await setup();
    await configureRates(ownerId);
    await saveMultipliers(ownerId, { basic: "1.00", intermediate: "1.20", advanced: "1.45", enterprise: "1.80" });
    const draft: EstimateDraft = {
      ...workedExample(),
      method: "fixed",
      complexity: "advanced",
      urgent: false,
      contingencyPct: "10",
      discount: { type: "none", value: "" },
      expenses: [],
      deliverables: [
        { id: randomUUID(), name: "Web app", price: "10000.00", estimatedHours: "20" },
        { id: randomUUID(), name: "Landing page", price: "5000.00", estimatedHours: "10" },
      ],
    };
    const saved = await saveEstimate(ownerId, null, { meta: { projectId, title: "Fixed", currency: "ZAR", complexity: "advanced" }, draft });
    expect(saved.result.breakdown.totalCents).toBe(2_392_500); // 15 000 x 1.45 = 21 750 + 10%
    expect(await db.estimateLine.count({ where: { estimateId: saved.id, kind: "LABOUR" } })).toBe(0);
    expect(saved.result.internal.effectiveHourlyRateCents).toBe(79_750);
    expect(saved.result.internal.belowMinimumRate).toBe(false); // R797.50 is above the R550 minimum
  });

  it("duplicates into a new draft with its own lines (EST1)", async () => {
    const { ownerId, projectId } = await setup();
    await configureRates(ownerId);
    const saved = await saveEstimate(ownerId, null, { meta: { projectId, title: "Original", currency: "ZAR", complexity: null }, draft: workedExample() });
    const copyId = await duplicateEstimate(ownerId, saved.id);
    expect(copyId).not.toBe(saved.id);
    const a = await db.estimateLine.findMany({ where: { estimateId: saved.id } });
    const b = await db.estimateLine.findMany({ where: { estimateId: copyId } });
    expect(b).toHaveLength(a.length);
    expect(new Set([...a, ...b].map((l) => l.id)).size).toBe(a.length + b.length);
  });

  it("scopes estimates by owner", async () => {
    const a = await setup();
    await configureRates(a.ownerId);
    const saved = await saveEstimate(a.ownerId, null, { meta: { projectId: a.projectId, title: "Mine", currency: "ZAR", complexity: null }, draft: workedExample() });
    const other = await newOwner();
    expect(await getEstimate(other, saved.id)).toBeNull();
    await expect(setEstimateReady(other, saved.id, true)).rejects.toBeInstanceOf(ServiceError);
  });

  it("marks an estimate ready only when it prices cleanly", async () => {
    const { ownerId, projectId } = await setup();
    await configureRates(ownerId);
    const saved = await saveEstimate(ownerId, null, { meta: { projectId, title: "Ready", currency: "ZAR", complexity: null }, draft: workedExample() });
    await setEstimateReady(ownerId, saved.id, true);
    expect((await getEstimate(ownerId, saved.id))!.status).toBe("READY");
    const logs = await db.auditLog.count({ where: { ownerId, entity: "estimate", action: "status.ready" } });
    expect(logs).toBe(1);
  });
});
