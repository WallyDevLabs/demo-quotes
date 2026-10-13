import Link from "next/link";
import { INVOICE_LABEL, INVOICE_TONE } from "@/components/invoice-status";
import { Badge, EmptyState, LinkButton } from "@/components/ui";
import { formatMoney } from "@/domain/money";
import { listInvoices } from "@/server/invoices";
import { requireOwnerId } from "@/server/owner";

export const metadata = { title: "Invoices" };

export default async function InvoicesPage() {
  const invoices = await listInvoices(await requireOwnerId());
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Invoices</h1>
        <LinkButton href="/quotations">Quotations</LinkButton>
      </div>
      {invoices.length === 0 ? (
        <EmptyState
          title="No invoices yet"
          body="Invoices are created from an accepted quotation: one for a deposit, one per milestone, or a custom one. Open an accepted quotation to start."
          action={<LinkButton href="/quotations" variant="primary">Go to quotations</LinkButton>}
        />
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
          {invoices.map((i) => (
            <li key={i.id}>
              <Link href={`/invoices/${i.id}`} className="grid gap-1 px-4 py-3 transition hover:bg-recessed md:grid-cols-[1.2fr_2fr_1.3fr_1fr_1fr_8rem] md:items-center md:gap-4">
                <span className="money text-sm font-semibold">{i.number ?? "Draft"}</span>
                <span className="font-semibold">{i.milestoneLabel ?? (i.customReason || "Invoice")}<span className="font-normal text-ink-muted"> · {i.clientName}</span></span>
                <span className="text-sm text-ink-muted">{i.dueDate ? `Due ${i.dueDate}` : "Not issued yet"}</span>
                <span className="money text-sm font-semibold">{formatMoney(i.totalCents, i.currency)}</span>
                <span className="money text-sm text-ink-muted">{i.status === "issued" ? `Balance ${formatMoney(i.balanceCents, i.currency)}` : ""}</span>
                <Badge tone={INVOICE_TONE[i.displayStatus]}>{INVOICE_LABEL[i.displayStatus]}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
