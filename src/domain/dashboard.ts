import { addDays, compareDates, trailingYearStart, type CalendarDate } from "./dates";
import { CURRENCIES, D, type Cents, type Currency } from "./money";
import { deriveQuotationStatus, type StoredInvoiceStatus, type StoredQuotationStatus } from "./status";

/**
 * Dashboard figures (PRD "Dashboard"). Each figure has exactly one definition, shown in the
 * interface, so invoiced revenue is never confused with money received. Everything is computed
 * per currency and never added across currencies: there is no conversion.
 */

export interface DashQuotation {
  currency: Currency;
  totalCents: Cents;
  stored: StoredQuotationStatus;
  expiryDate: CalendarDate | null;
}

export interface DashInvoice {
  id: string;
  number: string | null;
  currency: Currency;
  stored: StoredInvoiceStatus;
  totalCents: Cents;
  /** Payments minus reversals. */
  paidCents: Cents;
  issueDate: CalendarDate | null;
  dueDate: CalendarDate | null;
  /** USD invoices only: the rand value at issue, entered by the owner. */
  zarValueAtIssueCents: Cents | null;
  clientName: string;
}

export interface UpcomingItem {
  id: string;
  number: string | null;
  clientName: string;
  dueDate: CalendarDate;
  balanceCents: Cents;
  daysUntilDue: number;
}

export interface CurrencyFigures {
  currency: Currency;
  /** Sum of totals of quotations that are sent and not expired. */
  quotedCents: Cents;
  /** Sum of totals of accepted quotations. */
  confirmedCents: Cents;
  /** Sum of totals of issued invoices, excluding cancelled ones. */
  invoicedCents: Cents;
  /** Sum of payments, excluding reversed ones. */
  receivedCents: Cents;
  /** Invoiced minus received, on issued invoices. */
  outstandingCents: Cents;
  /** Outstanding amount on invoices whose due date has passed. */
  overdueCents: Cents;
  overdueCount: number;
  /** Issued invoices with a balance and a due date inside the window. */
  upcoming: UpcomingItem[];
}

export type VatLevel = "unset" | "ok" | "warn" | "over";

export interface VatMonitor {
  thresholdCents: Cents | null;
  warnSharePct: string;
  windowStart: CalendarDate;
  windowEnd: CalendarDate;
  /** Invoiced total for the trailing twelve months, in rand. */
  invoicedZarCents: Cents;
  /** USD invoices in the window with no rand value entered: not counted, but you should know. */
  usdInvoicesWithoutRand: number;
  /** Percent of the threshold, two decimals; null when no threshold is set. */
  sharePct: string | null;
  level: VatLevel;
}

export interface DashboardInput {
  quotations: DashQuotation[];
  invoices: DashInvoice[];
  today: CalendarDate;
  /** Default 14. */
  upcomingWindowDays: number;
  vat: { thresholdCents: Cents | null; warnSharePct: string | number };
}

export interface Dashboard {
  today: CalendarDate;
  upcomingWindowDays: number;
  byCurrency: Record<Currency, CurrencyFigures>;
  vat: VatMonitor;
}

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

function daysBetween(a: CalendarDate, b: CalendarDate): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export function figuresFor(currency: Currency, i: DashboardInput): CurrencyFigures {
  const quotes = i.quotations.filter((q) => q.currency === currency);
  const issued = i.invoices.filter((x) => x.currency === currency && x.stored === "issued");
  const windowEnd = addDays(i.today, i.upcomingWindowDays);

  const withBalance = issued.map((x) => ({ x, balance: x.totalCents - x.paidCents }));
  const overdue = withBalance.filter(({ x, balance }) => balance > 0 && x.dueDate !== null && compareDates(x.dueDate, i.today) < 0);

  const upcoming = withBalance
    .filter(({ x, balance }) => balance > 0 && x.dueDate !== null && compareDates(x.dueDate, i.today) >= 0 && compareDates(x.dueDate, windowEnd) <= 0)
    .map(({ x, balance }) => ({
      id: x.id,
      number: x.number,
      clientName: x.clientName,
      dueDate: x.dueDate!,
      balanceCents: balance,
      daysUntilDue: daysBetween(i.today, x.dueDate!),
    }))
    .sort((a, b) => compareDates(a.dueDate, b.dueDate) || (a.number ?? "").localeCompare(b.number ?? ""));

  return {
    currency,
    // Expiry is derived: a sent quotation past its expiry date is not "quoted" any more.
    quotedCents: sum(
      quotes
        .filter((q) => q.expiryDate !== null && deriveQuotationStatus(q.stored, q.expiryDate, i.today) === "sent")
        .map((q) => q.totalCents),
    ),
    confirmedCents: sum(quotes.filter((q) => q.stored === "accepted").map((q) => q.totalCents)),
    invoicedCents: sum(issued.map((x) => x.totalCents)),
    receivedCents: sum(issued.map((x) => x.paidCents)),
    outstandingCents: sum(withBalance.map((w) => w.balance)),
    overdueCents: sum(overdue.map((w) => w.balance)),
    overdueCount: overdue.length,
    upcoming,
  };
}

/**
 * The early warning for VAT registration: the invoiced total for the trailing twelve months against the
 * threshold you entered (and verified with SARS), warning at a configurable share. The legal test also
 * looks forward over the next twelve months, so this is a warning only.
 */
export function vatMonitor(i: DashboardInput): VatMonitor {
  const windowStart = trailingYearStart(i.today);
  const inWindow = i.invoices.filter(
    (x) => x.stored === "issued" && x.issueDate !== null && compareDates(x.issueDate, windowStart) >= 0 && compareDates(x.issueDate, i.today) <= 0,
  );
  const zar = inWindow.filter((x) => x.currency === "ZAR").reduce((s, x) => s + x.totalCents, 0);
  const usd = inWindow.filter((x) => x.currency === "USD");
  const usdZar = usd.reduce((s, x) => s + (x.zarValueAtIssueCents ?? 0), 0);
  const invoicedZarCents = zar + usdZar;
  const warn = new D(i.vat.warnSharePct);
  const t = i.vat.thresholdCents;

  let level: VatLevel = "unset";
  let sharePct: string | null = null;
  if (t !== null && t > 0) {
    sharePct = new D(invoicedZarCents).mul(100).div(t).toDecimalPlaces(2).toFixed(2);
    if (invoicedZarCents >= t) level = "over";
    else if (new D(invoicedZarCents).mul(100).gte(new D(t).mul(warn))) level = "warn";
    else level = "ok";
  }
  return {
    thresholdCents: t,
    warnSharePct: warn.toFixed(2),
    windowStart,
    windowEnd: i.today,
    invoicedZarCents,
    usdInvoicesWithoutRand: usd.filter((x) => x.zarValueAtIssueCents === null).length,
    sharePct,
    level,
  };
}

/** The one definition of each figure, shown in the interface next to the number. */
export const FIGURE_DEFINITIONS = {
  quoted: "Sum of the totals of quotations that are sent and not expired.",
  confirmed: "Sum of the totals of accepted quotations.",
  invoiced: "Sum of the totals of issued invoices, excluding cancelled ones. This is billed, not paid.",
  received: "Sum of payments recorded, excluding reversed ones. This is money actually received.",
  outstanding: "Invoiced minus received, on issued invoices.",
  overdue: "The outstanding amount on invoices whose due date has passed.",
} as const;

export function computeDashboard(i: DashboardInput): Dashboard {
  return {
    today: i.today,
    upcomingWindowDays: i.upcomingWindowDays,
    byCurrency: Object.fromEntries(CURRENCIES.map((c) => [c, figuresFor(c, i)])) as Record<Currency, CurrencyFigures>,
    vat: vatMonitor(i),
  };
}
