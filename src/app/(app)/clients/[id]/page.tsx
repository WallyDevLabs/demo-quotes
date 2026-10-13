import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ClientForm } from "@/components/client-project-forms";
import { ScopedFigures } from "@/components/figure-tiles";
import { INVOICE_LABEL, INVOICE_TONE } from "@/components/invoice-status";
import { STATUS_LABEL, STATUS_TONE } from "@/components/quotation-status";
import { Badge, Card, EmptyState, LinkButton } from "@/components/ui";
import { formatMoney } from "@/domain/money";
import { getClient, listProjects } from "@/server/clients";
import { getDashboard } from "@/server/dashboard";
import { listInvoices, listPaymentsForClient } from "@/server/invoices";
import { requireOwnerId } from "@/server/owner";
import { listQuotations } from "@/server/quotations";

export const metadata = { title: "Client" };

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const ownerId = await requireOwnerId();
  const client = await getClient(ownerId, id);
  if (!client) notFound();
  const now = new Date();
  const scope = { clientId: id };
  const [projects, quotations, invoices, payments, dash] = await Promise.all([
    listProjects(ownerId).then((all) => all.filter((p) => p.clientId === id)),
    listQuotations(ownerId, now, scope),
    listInvoices(ownerId, now, scope),
    listPaymentsForClient(ownerId, id),
    getDashboard(ownerId, now, scope),
  ]);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{client.name}</h1>
        {!client.archived && <LinkButton href={`/projects/new?client=${id}`} variant="primary">New project</LinkButton>}
      </div>
      <ClientForm client={client} />

      <Card>
        <h2 className="mb-1 text-base font-semibold">Balance and totals</h2>
        <p className="mb-3 text-xs text-ink-muted">The same definitions as the dashboard, for this client only. Each currency stands on its own.</p>
        <ScopedFigures dash={dash} empty="No quotations or invoices for this client yet." />
      </Card>

      <Card>
        <h2 className="mb-2 text-base font-semibold">Projects</h2>
        {projects.length === 0 ? (
          <EmptyState title="No projects yet" body="Create a project to start an estimate for this client." />
        ) : (
          <ul className="divide-y divide-line">
            {projects.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                <Link href={`/projects/${p.id}`} className="font-semibold hover:underline">{p.name}</Link>
                <Badge>{p.status.replace("_", " ").toLowerCase()}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <h2 className="mb-2 text-base font-semibold">Quotations</h2>
        {quotations.length === 0 ? (
          <p className="text-sm text-ink-muted">None yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {quotations.map((q) => (
              <li key={q.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <Link href={`/quotations/${q.id}`} className="font-semibold hover:underline">
                  <span className="money">{q.number ?? "Draft"}</span> <span className="font-normal text-ink-muted">· {q.title || q.projectName}</span>
                </Link>
                <span className="flex items-center gap-3">
                  <span className="money text-sm">{formatMoney(q.totalCents, q.currency)}</span>
                  <Badge tone={STATUS_TONE[q.displayStatus]}>{STATUS_LABEL[q.displayStatus]}</Badge>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <h2 className="mb-2 text-base font-semibold">Invoices</h2>
        {invoices.length === 0 ? (
          <p className="text-sm text-ink-muted">None yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {invoices.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <Link href={`/invoices/${i.id}`} className="font-semibold hover:underline">
                  <span className="money">{i.number ?? "Draft"}</span> <span className="font-normal text-ink-muted">· {i.milestoneLabel ?? i.customReason}</span>
                </Link>
                <span className="flex items-center gap-3">
                  <span className="money text-sm">{formatMoney(i.totalCents, i.currency)}</span>
                  {i.status === "issued" && <span className="money text-xs text-ink-muted">balance {formatMoney(i.balanceCents, i.currency)}</span>}
                  <Badge tone={INVOICE_TONE[i.displayStatus]}>{INVOICE_LABEL[i.displayStatus]}</Badge>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <h2 className="mb-1 text-base font-semibold">Payments</h2>
        <p className="mb-2 text-xs text-ink-muted">Every entry, including reversals. Payments are never edited or deleted.</p>
        {payments.length === 0 ? (
          <p className="text-sm text-ink-muted">No payments recorded yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {payments.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span>
                  <span className="money">{p.receivedOn}</span> ·{" "}
                  <Link href={`/invoices/${p.invoiceId}`} className="underline">{p.invoiceNumber}</Link>
                </span>
                <span className="flex items-center gap-2">
                  <span className={`money font-semibold ${p.reversed ? "line-through opacity-60" : ""}`}>{p.isReversal ? "-" : ""}{formatMoney(p.amountCents, p.currency)}</span>
                  {p.isReversal && <Badge tone="cost">Reversal</Badge>}
                  {p.reversed && <Badge tone="caution">Reversed</Badge>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
