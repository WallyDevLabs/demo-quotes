import Link from "next/link";
import { Badge, EmptyState, LinkButton } from "@/components/ui";
import { formatMoney } from "@/domain/money";
import { listEstimates } from "@/server/estimates";
import { requireOwnerId } from "@/server/owner";
import { getOverview } from "@/server/overview";

export const metadata = { title: "Estimates" };

export default async function EstimatesPage() {
  const ownerId = await requireOwnerId();
  const [estimates, overview] = await Promise.all([listEstimates(ownerId), getOverview(ownerId)]);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Estimates</h1>
        <LinkButton href="/estimates/new" variant="primary">New estimate</LinkButton>
      </div>
      {estimates.length === 0 ? (
        overview.anyRatesReady ? (
          <EmptyState title="No estimates yet" body="Price a project by time or at a fixed price. You will see the total update as you type." action={<LinkButton href="/estimates/new" variant="primary">Create an estimate</LinkButton>} />
        ) : (
          <EmptyState title="Set your rates first" body="Estimates use your own hourly rates, so none can be created until you have entered them." action={<LinkButton href="/settings#rates" variant="primary">Set rates</LinkButton>} />
        )
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
          {estimates.map((e) => (
            <li key={e.id}>
              <Link href={`/estimates/${e.id}`} className="grid gap-1 px-4 py-3 transition hover:bg-recessed md:grid-cols-[2fr_2fr_1fr_1fr_6.5rem] md:items-center md:gap-4">
                <span className="font-semibold">{e.title}</span>
                <span className="text-sm text-ink-muted">{e.projectName} · {e.clientName}</span>
                <span className="text-sm text-ink-muted">{e.method === "time" ? "Time based" : "Fixed price"}</span>
                <span className="money text-sm font-semibold">{e.totalCents === null ? <Badge tone="caution">Needs attention</Badge> : formatMoney(e.totalCents, e.currency)}</span>
                <Badge tone={e.status === "READY" ? "profit" : "neutral"}>{e.status === "READY" ? "Ready" : "Draft"}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
