import { todayInJohannesburg } from "@/domain/dates";
import { computeDashboard, type Dashboard, type DashInvoice, type DashQuotation } from "@/domain/dashboard";
import { paidCents } from "@/domain/invoicing";
import type { StoredQuotationStatus } from "@/domain/status";
import { dateFromDb, dstr, num, numOrNull } from "./convert";
import { db } from "./db";
import { entriesOf } from "./invoices";

/**
 * Loads only what the figures need (sent and accepted quotations, issued invoices with their payments)
 * and hands it to the pure domain function, so the dashboard, the tests and the definitions agree.
 */
export interface DashboardScope {
  clientId?: string;
  projectId?: string;
}

/**
 * The same figures, optionally for one client or one project. A client's balance and a project's agreed
 * price (the sum of its accepted quotations, PRJ2) are these definitions applied to that scope.
 */
export async function getDashboard(ownerId: string, now = new Date(), scope: DashboardScope = {}): Promise<Dashboard> {
  const [settings, quotes, invoices] = await Promise.all([
    db.businessSettings.findUnique({ where: { ownerId } }),
    db.quotation.findMany({
      where: { ownerId, status: { in: ["SENT", "ACCEPTED"] }, ...scope },
      select: { currency: true, totalCents: true, status: true, expiryDate: true },
    }),
    db.invoice.findMany({
      where: { ownerId, status: "ISSUED", ...scope },
      include: { payments: true, client: { select: { name: true } } },
    }),
  ]);

  const quotations: DashQuotation[] = quotes.map((x) => ({
    currency: x.currency,
    totalCents: num(x.totalCents),
    stored: x.status.toLowerCase() as StoredQuotationStatus,
    expiryDate: dateFromDb(x.expiryDate),
  }));
  const inv: DashInvoice[] = invoices.map((i) => ({
    id: i.id,
    number: i.number,
    currency: i.currency,
    stored: "issued",
    totalCents: num(i.totalCents),
    paidCents: paidCents(entriesOf(i.payments)),
    issueDate: dateFromDb(i.issueDate),
    dueDate: dateFromDb(i.dueDate),
    zarValueAtIssueCents: numOrNull(i.zarValueAtIssueCents),
    clientName: i.client.name,
  }));

  return computeDashboard({
    quotations,
    invoices: inv,
    today: todayInJohannesburg(now),
    upcomingWindowDays: settings?.upcomingWindowDays ?? 14,
    vat: { thresholdCents: numOrNull(settings?.vatThresholdCents ?? null), warnSharePct: settings ? dstr(settings.vatWarnSharePct) : "80" },
  });
}
