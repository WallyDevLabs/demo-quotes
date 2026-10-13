import { randomUUID } from "node:crypto";
import type { EstimateDraft } from "@/domain/pricing/draft";
import { emptyCurrencyForm } from "@/domain/settings-forms";
import { createClient, createProject } from "@/server/clients";
import { db } from "@/server/db";
import { saveEstimate, setEstimateReady } from "@/server/estimates";
import { getSettings, saveCurrencySettings } from "@/server/settings";

export async function newOwner() {
  const u = await db.user.create({ data: { email: `${randomUUID()}@test.invalid`, passwordHash: "x" } });
  return u.id;
}

export async function configureRates(ownerId: string) {
  const f = emptyCurrencyForm("ZAR");
  f.minimumHourlyRate = "550";
  f.rates.development = "600";
  f.rates.design = "500";
  await saveCurrencySettings(ownerId, f);
}

/** The PRD v2 worked example, plus a recurring line. Totals R37,069.00. */
export const workedExample = (): EstimateDraft => ({
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
  expenses: [
    { id: randomUUID(), description: "Hosting", cost: "1200.00", markupPct: "10", recurring: false, period: "monthly" },
    { id: randomUUID(), description: "Maintenance", cost: "1000.00", markupPct: "0", recurring: true, period: "monthly" },
  ],
});

/** A fully set up owner: business name, rates, client, project and a READY worked-example estimate. */
export async function setupReadyEstimate(opts: { business?: boolean; projectCode?: string | null } = {}) {
  const ownerId = await newOwner();
  await getSettings(ownerId);
  if (opts.business !== false) {
    await db.businessSettings.update({
      where: { ownerId },
      data: { legalName: "Katlego Barayi", address: "1 Main Rd, Pretoria", email: "k@example.com", quotationValidityDays: 30 },
    });
  }
  await configureRates(ownerId);
  const clientId = await createClient(ownerId, { name: "Thabo Mokoena", companyName: "Acme (Pty) Ltd", code: "ACME" });
  const projectId = await createProject(ownerId, {
    clientId,
    name: "Dispatch app",
    ...(opts.projectCode === null ? {} : { code: opts.projectCode ?? "DISP" }),
    description: "Build a dispatch web app.",
  });
  const saved = await saveEstimate(ownerId, null, {
    meta: { projectId, title: "Phase 1", currency: "ZAR", complexity: null },
    draft: workedExample(),
  });
  await setEstimateReady(ownerId, saved.id, true);
  return { ownerId, clientId, projectId, estimateId: saved.id };
}

export const fakePdf = async () => new TextEncoder().encode("%PDF-1.4 fake");

import { acceptQuotation, createQuotationFromEstimate, sendQuotation, updateDraftQuotation } from "@/server/quotations";
import { getQuotationInvoicing } from "@/server/invoices";

export async function configureBanking(ownerId: string, currency: "ZAR" | "USD" = "ZAR") {
  await db.currencySettings.update({
    where: { ownerId_currency: { ownerId, currency } },
    data: {
      bankingDetails: {
        bankName: "First National Bank",
        accountName: "Katlego Barayi",
        accountNumber: "62000000000",
        branchCode: "250655",
        accountType: "Cheque",
        instructions: "Please use the invoice number as your reference.",
      },
    },
  });
}

/**
 * An owner with an ACCEPTED quotation of R37,069.00 split 50/50 into R18,534.50 milestones, banking
 * details set, and the clock fixed to 13 October 2026.
 */
export async function setupAcceptedQuotation(opts: { milestones?: { label: string; percent: string }[]; acceptNow?: boolean } = {}) {
  const s = await setupReadyEstimate();
  await configureBanking(s.ownerId);
  const quotationId = await createQuotationFromEstimate(s.ownerId, s.estimateId);
  await updateDraftQuotation(s.ownerId, quotationId, {
    milestones: opts.milestones ?? [{ label: "Deposit", percent: "50" }, { label: "On delivery", percent: "50" }],
  });
  await sendQuotation(s.ownerId, quotationId, { now: new Date("2026-10-13T10:00:00Z"), renderPdf: fakePdf });
  if (opts.acceptNow !== false) await acceptQuotation(s.ownerId, quotationId, { acceptedBy: "Thabo" }, new Date("2026-10-14T10:00:00Z"));
  const inv = (await getQuotationInvoicing(s.ownerId, quotationId))!;
  return { ...s, quotationId, total: inv.totalCents, milestoneIds: inv.milestones.map((m) => m.id), milestones: inv.milestones };
}
