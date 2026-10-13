import { CURRENCIES, type Currency } from "@/domain/money";
import { db } from "./db";
import { getPricingSettings, getSettings } from "./settings";

export interface Overview {
  businessReady: boolean;
  ratesReady: Record<Currency, boolean>;
  anyRatesReady: boolean;
  counts: { clients: number; projects: number; estimates: number; quotations: number; invoices: number };
}

/** First-run state (EST10): the dashboard and "new estimate" use this to send the owner to settings. */
export async function getOverview(ownerId: string): Promise<Overview> {
  const [settings, clients, projects, estimates, quotations, invoices, ...pricing] = await Promise.all([
    getSettings(ownerId),
    db.client.count({ where: { ownerId, archivedAt: null } }),
    db.project.count({ where: { ownerId } }),
    db.estimate.count({ where: { ownerId } }),
    db.quotation.count({ where: { ownerId } }),
    db.invoice.count({ where: { ownerId } }),
    ...CURRENCIES.map((c) => getPricingSettings(ownerId, c)),
  ]);
  const ratesReady = Object.fromEntries(CURRENCIES.map((c, i) => [c, pricing[i]!.ratesConfigured])) as Record<Currency, boolean>;
  return {
    businessReady: settings.business.legalName.trim() !== "",
    ratesReady,
    anyRatesReady: Object.values(ratesReady).some(Boolean),
    counts: { clients, projects, estimates, quotations, invoices },
  };
}
