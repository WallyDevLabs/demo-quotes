import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ProjectForm } from "@/components/client-project-forms";
import { ScopedFigures } from "@/components/figure-tiles";
import { INVOICE_LABEL, INVOICE_TONE } from "@/components/invoice-status";
import { STATUS_LABEL, STATUS_TONE } from "@/components/quotation-status";
import { Badge, Card, EmptyState, LinkButton } from "@/components/ui";
import { CURRENCIES, formatMoney } from "@/domain/money";
import { listClients, getProject } from "@/server/clients";
import { getDashboard } from "@/server/dashboard";
import { listEstimates } from "@/server/estimates";
import { listInvoices } from "@/server/invoices";
import { requireOwnerId } from "@/server/owner";
import { listQuotations } from "@/server/quotations";

export const metadata = { title: "Project" };

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const ownerId = await requireOwnerId();
  const now = new Date();
  const scope = { projectId: id };
  const [project, clients, estimates, quotations, invoices, dash] = await Promise.all([
    getProject(ownerId, id),
    listClients(ownerId),
    listEstimates(ownerId),
    listQuotations(ownerId, now, scope),
    listInvoices(ownerId, now, scope),
    getDashboard(ownerId, now, scope),
  ]);
  if (!project) notFound();
  const mine = estimates.filter((e) => e.projectId === id);
  // PRJ2: scope changes are new quotations on the same project; the agreed price is the sum of the accepted ones.
  const agreed = CURRENCIES.map((c) => ({ c, cents: dash.byCurrency[c].confirmedCents })).filter((x) => x.cents > 0);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
        <LinkButton href={`/estimates/new?project=${id}`} variant="primary">New estimate</LinkButton>
      </div>
      <ProjectForm project={project} clients={clients.map((c) => ({ id: c.id, name: c.name }))} />

      <Card>
        <h2 className="mb-1 text-base font-semibold">Agreed price</h2>
        <p className="mb-3 text-xs text-ink-muted">The sum of this project&apos;s accepted quotations. A change of scope is a new quotation on the same project, so the agreed price grows only when you accept it.</p>
        {agreed.length === 0 ? (
          <p className="text-sm text-ink-muted">Nothing agreed yet: no quotation on this project has been accepted.</p>
        ) : (
          <div className="flex flex-wrap gap-6">
            {agreed.map((a) => (
              <div key={a.c}>
                <div className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">{a.c}</div>
                <div className="money text-2xl font-semibold">{formatMoney(a.cents, a.c)}</div>
              </div>
            ))}
          </div>
        )}
        <div className="mt-4">
          <ScopedFigures dash={dash} empty="" />
        </div>
      </Card>

      <Card>
        <h2 className="mb-2 text-base font-semibold">Estimates</h2>
        {mine.length === 0 ? (
          <EmptyState title="No estimates yet" body="Price this project with an estimate." />
        ) : (
          <ul className="divide-y divide-line">
            {mine.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 py-2">
                <Link href={`/estimates/${e.id}`} className="font-semibold hover:underline">{e.title}</Link>
                <span className="money text-sm">{e.totalCents === null ? "Needs attention" : formatMoney(e.totalCents, e.currency)}</span>
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
                <Link href={`/quotations/${q.id}`} className="font-semibold hover:underline"><span className="money">{q.number ?? "Draft"}</span></Link>
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
                <Link href={`/invoices/${i.id}`} className="font-semibold hover:underline"><span className="money">{i.number ?? "Draft"}</span></Link>
                <span className="flex items-center gap-3">
                  <span className="money text-sm">{formatMoney(i.totalCents, i.currency)}</span>
                  <Badge tone={INVOICE_TONE[i.displayStatus]}>{INVOICE_LABEL[i.displayStatus]}</Badge>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
