import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Badge, Banner, Card, LinkButton } from "@/components/ui";
import { formatMoney } from "@/domain/money";
import { reconcileQuotation } from "@/domain/quotation";
import { requireOwnerId } from "@/server/owner";
import { getQuotation } from "@/server/quotations";

export const metadata = { title: "Quotation working" };

/**
 * Re-adds the quotation from the lines and milestones as stored, which are exactly what the PDF prints.
 * Compare each figure with your own hand calculation of the estimate; every check below must pass.
 */
export default async function QuotationWorkingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const q = await getQuotation(await requireOwnerId(), id);
  if (!q) notFound();
  const fmt = (c: number) => formatMoney(c, q.currency);
  const checks = reconcileQuotation(q);
  const allOk = checks.every((c) => c.ok);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Working: {q.number ?? "Draft quotation"}</h1>
          <p className="text-sm text-ink-muted">{q.title || q.projectName} · {q.clientName} · {q.currency}</p>
        </div>
        <LinkButton href={`/quotations/${id}`}>Back to the quotation</LinkButton>
      </div>

      <Banner tone={allOk ? "profit" : "cost"}>
        {allOk ? "Every internal check passes: the printed lines, totals and payment schedule agree to the cent." : "A check fails below. Do not send this quotation; report it as a bug."}
      </Banner>

      <Card>
        <h2 className="text-base font-semibold">As stored</h2>
        <div className="overflow-x-auto"><table className="mt-2 w-full text-left text-sm">
          <thead><tr className="text-[11px] uppercase tracking-wider text-ink-muted"><th className="py-1">Item</th><th>Detail</th><th className="text-right">Amount</th></tr></thead>
          <tbody>
            {q.lines.map((l, i) => (
              <tr key={i} className="border-t border-line">
                <td className="py-1">{l.description}{l.kind === "RECURRING" && <span className="ml-2 text-xs text-ink-muted">(recurring, not in the total)</span>}</td>
                <td className="text-ink-muted">{l.detail}</td>
                <td className="money text-right">{fmt(l.amountCents)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="text-sm">
            <tr className="border-t border-line"><td colSpan={2} className="py-1 font-semibold">Subtotal</td><td className="money text-right font-semibold">{fmt(q.subtotalCents)}</td></tr>
            <tr><td colSpan={2} className="py-1">Discount</td><td className="money text-right">-{fmt(q.discountCents)}</td></tr>
            <tr className="border-t border-line"><td colSpan={2} className="py-1 font-semibold">Total</td><td className="money text-right text-base font-semibold">{fmt(q.totalCents)}</td></tr>
          </tfoot>
        </table></div>
        <div className="overflow-x-auto"><table className="mt-5 w-full text-left text-sm">
          <caption className="mb-1 text-left text-[11px] font-bold uppercase tracking-wider text-ink-muted">Payment schedule</caption>
          <thead><tr className="text-[11px] uppercase tracking-wider text-ink-muted"><th className="py-1">Milestone</th><th className="text-right">Percent</th><th className="text-right">Amount</th></tr></thead>
          <tbody>
            {q.milestones.map((m, i) => (
              <tr key={i} className="border-t border-line"><td className="py-1">{m.label}</td><td className="money text-right">{m.percent}%</td><td className="money text-right">{fmt(m.amountCents)}</td></tr>
            ))}
          </tbody>
        </table></div>
      </Card>

      <Card>
        <h2 className="text-base font-semibold">Checks</h2>
        <ul className="mt-2 divide-y divide-line">
          {checks.map((c) => (
            <li key={c.label} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <span>{c.label}</span>
              <span className="flex items-center gap-3">
                {c.expectedCents !== null && <span className="money text-xs text-ink-muted">{fmt(c.expectedCents)} expected, {fmt(c.actualCents ?? 0)} stored</span>}
                {c.note && <span className="money text-xs text-ink-muted">{c.note}</span>}
                <Badge tone={c.ok ? "profit" : "cost"}>{c.ok ? "Pass" : "FAIL"}</Badge>
              </span>
            </li>
          ))}
        </ul>
        {q.estimateId && (
          <p className="mt-3 text-sm text-ink-muted">
            To check how the price itself was worked out, see the <Link className="underline" href={`/estimates/${q.estimateId}/working`}>estimate&apos;s working</Link> (it shows the estimate as it is now; this quotation keeps the figures it was created with).
          </p>
        )}
      </Card>
    </div>
  );
}
