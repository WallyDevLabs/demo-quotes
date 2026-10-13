import Link from "next/link";
import { Badge, Banner, Card, LinkButton } from "@/components/ui";
import { FigureGrid, hasActivity } from "@/components/figure-tiles";
import { type CurrencyFigures, type VatMonitor } from "@/domain/dashboard";
import { CURRENCIES, formatMoney } from "@/domain/money";
import { getDashboard } from "@/server/dashboard";
import { requireOwnerId } from "@/server/owner";
import { getOverview } from "@/server/overview";

export const metadata = { title: "Dashboard" };

function Step({ done, title, body, href, cta }: { done: boolean; title: string; body: string; href: string; cta: string }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className={`mt-0.5 flex h-5 w-5 items-center justify-center rounded-full border text-[11px] font-bold ${done ? "border-profit bg-profit-soft text-profit-ink" : "border-line text-ink-muted"}`}
        >
          {done ? "✓" : ""}
        </span>
        <div>
          <div className="text-sm font-semibold">
            {title} {done && <Badge tone="profit">Done</Badge>}
          </div>
          <p className="text-xs text-ink-muted">{body}</p>
        </div>
      </div>
      {!done && <LinkButton href={href} variant="primary">{cta}</LinkButton>}
    </li>
  );
}

function CurrencySection({ f, windowDays }: { f: CurrencyFigures; windowDays: number }) {
  const fmt = (c: number) => formatMoney(c, f.currency);
  return (
    <section aria-label={`${f.currency} figures`} className="space-y-3">
      <h2 className="text-lg font-semibold tracking-tight">{f.currency === "ZAR" ? "South African rand (ZAR)" : "US dollars (USD)"}</h2>
      <FigureGrid f={f} />
      <Card>
        <h3 className="text-base font-semibold">Upcoming payment deadlines</h3>
        <p className="text-xs text-ink-muted">Issued invoices with a balance, due in the next {windowDays} days (set in Settings).</p>
        {f.upcoming.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">Nothing falls due in this window.</p>
        ) : (
          <ul className="mt-2 divide-y divide-line">
            {f.upcoming.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <Link href={`/invoices/${u.id}`} className="font-semibold hover:underline">
                  <span className="money">{u.number}</span> <span className="font-normal text-ink-muted">· {u.clientName}</span>
                </Link>
                <span className="text-sm">
                  <span className="money">{fmt(u.balanceCents)}</span>{" "}
                  <span className="text-ink-muted">due {u.dueDate} ({u.daysUntilDue === 0 ? "today" : `in ${u.daysUntilDue} day${u.daysUntilDue === 1 ? "" : "s"}`})</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}

function VatCard({ m }: { m: VatMonitor }) {
  const zar = (c: number) => formatMoney(c, "ZAR");
  const pct = m.sharePct === null ? 0 : Math.min(100, Number(m.sharePct));
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">VAT registration threshold monitor</h2>
        <Badge tone={m.level === "over" ? "cost" : m.level === "warn" ? "caution" : m.level === "ok" ? "profit" : "neutral"}>
          {m.level === "over" ? "Over the threshold" : m.level === "warn" ? "Approaching the threshold" : m.level === "ok" ? "Below the warning level" : "Threshold not set"}
        </Badge>
      </div>
      <p className="mt-1 text-xs text-ink-muted">
        Invoiced total for the trailing twelve months ({m.windowStart} to {m.windowEnd}) against the threshold you entered. USD invoices count at the rand value you entered when issuing them.
      </p>
      {m.thresholdCents === null ? (
        <p className="mt-3 text-sm">
          Enter the registration threshold, once you have verified it with SARS, in <Link className="underline" href="/settings">Settings, VAT</Link>. Nothing is assumed.
        </p>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2">
            <span className="money text-xl font-semibold">{zar(m.invoicedZarCents)}</span>
            <span className="text-sm text-ink-muted">
              of <span className="money">{zar(m.thresholdCents)}</span> ({m.sharePct}%, warning at {m.warnSharePct}%)
            </span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-recessed" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Share of the VAT threshold">
            <div className={`h-full ${m.level === "over" ? "bg-cost" : m.level === "warn" ? "bg-caution" : "bg-profit"}`} style={{ width: `${pct}%` }} />
          </div>
        </>
      )}
      {(m.level === "warn" || m.level === "over") && (
        <div className="mt-3">
          <Banner tone={m.level === "over" ? "cost" : "caution"}>
            {m.level === "over"
              ? "You are over the threshold you entered. Speak to SARS or an accountant about registering. VAT documents are not built yet (phase two)."
              : "You are close to the threshold. Registration can become compulsory before you reach it, because the legal test also looks forward over the next twelve months."}
          </Banner>
        </div>
      )}
      {m.usdInvoicesWithoutRand > 0 && (
        <p className="mt-3 text-xs text-caution-ink">
          {m.usdInvoicesWithoutRand} USD invoice{m.usdInvoicesWithoutRand === 1 ? " has" : "s have"} no rand value entered, so {m.usdInvoicesWithoutRand === 1 ? "it is" : "they are"} not counted here.
        </p>
      )}
      <p className="mt-3 text-xs text-ink-muted">An early warning only. Verify the threshold and the period with SARS or an accountant.</p>
    </Card>
  );
}

export default async function Dashboard() {
  const ownerId = await requireOwnerId();
  const [o, dash] = await Promise.all([getOverview(ownerId), getDashboard(ownerId)]);
  const ready = o.businessReady && o.anyRatesReady;
  // Always show rand; show dollars once there is any USD activity.
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>

      {!ready && (
        <Card>
          <h2 className="text-base font-semibold">Finish setting up before your first estimate</h2>
          <p className="mt-0.5 text-xs text-ink-muted">No price in this app is an unreviewed default: you enter your own rates first.</p>
          <ul className="mt-2 divide-y divide-line">
            <Step done={o.businessReady} title="Business details" body="Your legal name appears on every quotation and invoice." href="/settings" cta="Add details" />
            <Step done={o.anyRatesReady} title="Hourly rates" body="Set a rate per category for ZAR and, if you need it, USD." href="/settings#rates" cta="Set rates" />
            <Step done={o.counts.clients > 0} title="First client" body="Who the work is for." href="/clients/new" cta="Add client" />
            <Step done={o.counts.projects > 0} title="First project" body="Estimates belong to a project." href="/projects/new" cta="Add project" />
          </ul>
        </Card>
      )}

      {CURRENCIES.filter((c) => c === "ZAR" || hasActivity(dash.byCurrency[c])).map((c) => (
        <CurrencySection key={c} f={dash.byCurrency[c]} windowDays={dash.upcomingWindowDays} />
      ))}
      <p className="text-xs text-ink-muted">Each currency is reported on its own and never added to another. Figures are as at {dash.today}.</p>

      <VatCard m={dash.vat} />
    </div>
  );
}
