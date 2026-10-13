import { FIGURE_DEFINITIONS, type CurrencyFigures, type Dashboard } from "@/domain/dashboard";
import { CURRENCIES, formatMoney } from "@/domain/money";

export function Figure({ label, value, definition, tone }: { label: string; value: string; definition: string; tone?: "profit" | "cost" | "caution" }) {
  const color = tone === "profit" ? "text-profit-ink" : tone === "cost" ? "text-cost-ink" : tone === "caution" ? "text-caution-ink" : "";
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <div className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">{label}</div>
      <div className={`money mt-1 text-2xl font-semibold ${color}`}>{value}</div>
      <p className="mt-1 text-xs text-ink-muted">{definition}</p>
    </div>
  );
}

/** The six figures for one currency, each with its single definition. */
export function FigureGrid({ f }: { f: CurrencyFigures }) {
  const fmt = (c: number) => formatMoney(c, f.currency);
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Figure label="Quoted" value={fmt(f.quotedCents)} definition={FIGURE_DEFINITIONS.quoted} />
      <Figure label="Confirmed" value={fmt(f.confirmedCents)} definition={FIGURE_DEFINITIONS.confirmed} />
      <Figure label="Invoiced" value={fmt(f.invoicedCents)} definition={FIGURE_DEFINITIONS.invoiced} />
      <Figure label="Received" value={fmt(f.receivedCents)} definition={FIGURE_DEFINITIONS.received} tone="profit" />
      <Figure label="Outstanding" value={fmt(f.outstandingCents)} definition={FIGURE_DEFINITIONS.outstanding} />
      <Figure
        label={`Overdue${f.overdueCount ? ` (${f.overdueCount})` : ""}`}
        value={fmt(f.overdueCents)}
        definition={FIGURE_DEFINITIONS.overdue}
        tone={f.overdueCents > 0 ? "cost" : undefined}
      />
    </div>
  );
}

export const hasActivity = (f: CurrencyFigures) =>
  f.quotedCents + f.confirmedCents + f.invoicedCents + f.receivedCents + f.outstandingCents > 0;

/** Figures for one client or project: only the currencies with any activity, each on its own. */
export function ScopedFigures({ dash, empty }: { dash: Dashboard; empty: string }) {
  const active = CURRENCIES.filter((c) => hasActivity(dash.byCurrency[c]));
  if (active.length === 0) return <p className="text-sm text-ink-muted">{empty}</p>;
  return (
    <div className="space-y-4">
      {active.map((c) => (
        <section key={c} aria-label={`${c} figures`} className="space-y-2">
          <h3 className="text-sm font-semibold">{c === "ZAR" ? "South African rand (ZAR)" : "US dollars (USD)"}</h3>
          <FigureGrid f={dash.byCurrency[c]} />
        </section>
      ))}
    </div>
  );
}
