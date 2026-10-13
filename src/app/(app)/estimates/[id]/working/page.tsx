import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Badge, Banner, Card, LinkButton } from "@/components/ui";
import { formatMoney, parseAmountToCents } from "@/domain/money";
import { evaluateDraft } from "@/domain/pricing/draft";
import { getEstimate, toContext } from "@/server/estimates";
import { requireOwnerId } from "@/server/owner";
import { getPricingSettings } from "@/server/settings";

export const metadata = { title: "Estimate working" };

/**
 * Every input, then every step of the calculation in order, with its formula and the figures it used.
 * For checking a price by hand: work through the steps yourself and compare each amount. The numbers
 * come from the same engine that prices the estimate, so a mismatch is a bug worth reporting.
 */
export default async function EstimateWorkingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const ownerId = await requireOwnerId();
  const e = await getEstimate(ownerId, id);
  if (!e) notFound();
  const settings = await getPricingSettings(ownerId, e.draft.currency);
  const result = evaluateDraft(e.draft, toContext(settings));
  const d = e.draft;
  const fmt = (c: number) => formatMoney(c, d.currency);
  const money = (s: string) => {
    try {
      return fmt(parseAmountToCents(s));
    } catch {
      return s;
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Working: {e.title}</h1>
          <p className="text-sm text-ink-muted">
            {e.projectName} · {e.clientName} · {d.currency} · {d.method === "time" ? "Time based" : "Fixed price"}
          </p>
        </div>
        <LinkButton href={`/estimates/${id}`}>Back to the estimate</LinkButton>
      </div>

      <Banner tone="primary">
        To check this price by hand: take the inputs below, follow the steps in order using the stated formula, round each line and each percentage step half up to the cent, and compare with the amount shown. Everything is in {d.currency}.
      </Banner>

      <Card>
        <h2 className="text-base font-semibold">Inputs</h2>
        <dl className="mt-2 grid grid-cols-[1fr_auto] gap-y-1 text-sm">
          {d.method === "fixed" && (
            <>
              <dt>Complexity</dt>
              <dd className="money">{d.complexity ?? "not chosen"} (multiplier {d.complexity ? settings.multipliers[d.complexity] : "-"})</dd>
            </>
          )}
          <dt>Urgent delivery</dt>
          <dd className="money">{d.urgent ? `Yes, ${d.urgencyPct}%` : "No"}</dd>
          <dt>Contingency</dt>
          <dd className="money">{d.contingencyPct}%</dd>
          <dt>Discount</dt>
          <dd className="money">{d.discount.type === "none" ? "None" : d.discount.type === "percent" ? `${d.discount.value}% of the subtotal` : `${money(d.discount.value)} off the subtotal`}</dd>
          <dt>Minimum effective hourly rate</dt>
          <dd className="money">{settings.minimumHourlyRateCents ? fmt(settings.minimumHourlyRateCents) : "not set"}</dd>
        </dl>

        {d.method === "time" ? (
          <table className="mt-4 w-full text-left text-sm">
            <caption className="mb-1 text-left text-[11px] font-bold uppercase tracking-wider text-ink-muted">Labour</caption>
            <thead><tr className="text-[11px] uppercase tracking-wider text-ink-muted"><th className="py-1">Task</th><th>Category</th><th className="text-right">Hours</th><th className="text-right">Rate / h</th><th className="text-right">Line amount</th></tr></thead>
            <tbody>
              {d.labour.map((l) => (
                <tr key={l.id} className="border-t border-line">
                  <td className="py-1">{l.task}</td><td>{l.category}</td>
                  <td className="money text-right">{l.hours}</td><td className="money text-right">{money(l.rate)}</td>
                  <td className="money text-right">{result.ok ? fmt(result.result.lines.find((x) => x.id === l.id)!.amountCents) : "n/a"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="mt-4 w-full text-left text-sm">
            <caption className="mb-1 text-left text-[11px] font-bold uppercase tracking-wider text-ink-muted">Deliverables</caption>
            <thead><tr className="text-[11px] uppercase tracking-wider text-ink-muted"><th className="py-1">Deliverable</th><th className="text-right">Price entered</th><th className="text-right">Est. hours (internal)</th><th className="text-right">After complexity</th></tr></thead>
            <tbody>
              {d.deliverables.map((x) => (
                <tr key={x.id} className="border-t border-line">
                  <td className="py-1">{x.name}</td>
                  <td className="money text-right">{money(x.price)}</td><td className="money text-right">{x.estimatedHours}</td>
                  <td className="money text-right">{result.ok ? fmt(result.result.lines.find((l) => l.id === x.id)!.adjustedCents ?? 0) : "n/a"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {d.expenses.length > 0 && (
          <table className="mt-4 w-full text-left text-sm">
            <caption className="mb-1 text-left text-[11px] font-bold uppercase tracking-wider text-ink-muted">Expenses (cost and markup stay internal)</caption>
            <thead><tr className="text-[11px] uppercase tracking-wider text-ink-muted"><th className="py-1">Description</th><th className="text-right">Cost</th><th className="text-right">Markup</th><th>Kind</th><th className="text-right">Billed</th></tr></thead>
            <tbody>
              {d.expenses.map((x) => {
                const billed = result.ok ? [...result.result.expenseLines, ...result.result.recurringLines].find((l) => l.id === x.id)?.billedCents : undefined;
                return (
                  <tr key={x.id} className="border-t border-line">
                    <td className="py-1">{x.description}</td><td className="money text-right">{money(x.cost)}</td>
                    <td className="money text-right">{x.markupPct}%</td><td>{x.recurring ? `Recurring (${x.period})` : "Once off"}</td>
                    <td className="money text-right">{billed === undefined ? "n/a" : fmt(billed)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      {!result.ok ? (
        <Banner tone="cost">This estimate does not price cleanly right now: {result.issues.map((i) => i.message).join("; ")}. <Link className="underline" href={`/estimates/${id}`}>Fix it first.</Link></Banner>
      ) : (
        <>
          <Card>
            <h2 className="text-base font-semibold">Steps, in order</h2>
            <ol className="mt-3 space-y-3">
              {result.result.explanations.map((x, i) => (
                <li key={x.key} className="rounded-lg border border-line p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-semibold">{i + 1}. {x.label}</span>
                    <span className="money text-lg font-semibold">{fmt(x.amountCents)}</span>
                  </div>
                  <p className="mt-1 text-sm text-ink-muted">Formula: {x.formula}</p>
                  <ul className="money mt-1 space-y-0.5 text-xs text-ink-muted">
                    {x.inputs.map((t, k) => <li key={k}>{t}</li>)}
                  </ul>
                </li>
              ))}
            </ol>
          </Card>
          <Card>
            <h2 className="text-base font-semibold">Result</h2>
            <dl className="mt-2 grid grid-cols-[1fr_auto] gap-y-1 text-sm">
              <dt className="font-semibold">Total</dt><dd className="money text-lg font-semibold">{fmt(result.result.breakdown.totalCents)}</dd>
              <dt className="text-ink-muted">In cents (what is stored)</dt><dd className="money text-ink-muted">{result.result.breakdown.totalCents}</dd>
              <dt className="text-ink-muted">Effective hourly rate (internal)</dt>
              <dd className="money text-ink-muted">{result.result.internal.effectiveHourlyRateCents === null ? "none" : `${fmt(result.result.internal.effectiveHourlyRateCents)}/h over ${result.result.internal.estimatedHours} h`}</dd>
            </dl>
            {result.result.internal.belowMinimumRate && <div className="mt-2"><Badge tone="cost">Below your minimum hourly rate</Badge></div>}
          </Card>
        </>
      )}
    </div>
  );
}
