import Link from "next/link";
import { STATUS_LABEL, STATUS_TONE } from "@/components/quotation-status";
import { Badge, EmptyState, LinkButton } from "@/components/ui";
import { formatMoney } from "@/domain/money";
import { requireOwnerId } from "@/server/owner";
import { listQuotations } from "@/server/quotations";

export const metadata = { title: "Quotations" };

export default async function QuotationsPage() {
  const quotations = await listQuotations(await requireOwnerId());
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Quotations</h1>
        <LinkButton href="/estimates">Estimates</LinkButton>
      </div>
      {quotations.length === 0 ? (
        <EmptyState
          title="No quotations yet"
          body="Mark an estimate ready, then create a quotation from it. A quotation gets its number when you send it."
          action={<LinkButton href="/estimates" variant="primary">Go to estimates</LinkButton>}
        />
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
          {quotations.map((q) => (
            <li key={q.id}>
              <Link href={`/quotations/${q.id}`} className="grid gap-1 px-4 py-3 transition hover:bg-recessed md:grid-cols-[1.2fr_2fr_1.5fr_1fr_6.5rem] md:items-center md:gap-4">
                <span className="money text-sm font-semibold">{q.number ?? "Draft"}</span>
                <span className="font-semibold">{q.title || q.projectName}<span className="font-normal text-ink-muted"> · {q.clientName}</span></span>
                <span className="text-sm text-ink-muted">{q.expiryDate ? `Valid until ${q.expiryDate}` : "Not sent yet"}</span>
                <span className="money text-sm font-semibold">{formatMoney(q.totalCents, q.currency)}</span>
                <Badge tone={STATUS_TONE[q.displayStatus]}>{STATUS_LABEL[q.displayStatus]}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
