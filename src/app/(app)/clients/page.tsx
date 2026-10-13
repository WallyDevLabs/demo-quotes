import Link from "next/link";
import { Badge, EmptyState, LinkButton } from "@/components/ui";
import { listClients } from "@/server/clients";
import { requireOwnerId } from "@/server/owner";

export const metadata = { title: "Clients" };

export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ archived?: string }> }) {
  const showArchived = (await searchParams).archived === "1";
  const clients = await listClients(await requireOwnerId(), showArchived);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Clients</h1>
        <div className="flex items-center gap-2">
          <LinkButton href={showArchived ? "/clients" : "/clients?archived=1"}>{showArchived ? "Hide archived" : "Show archived"}</LinkButton>
          <LinkButton href="/clients/new" variant="primary">New client</LinkButton>
        </div>
      </div>
      {clients.length === 0 ? (
        <EmptyState title="No clients yet" body="Add the person or company you are quoting. Projects, estimates, quotations and invoices all hang off a client." action={<LinkButton href="/clients/new" variant="primary">Add your first client</LinkButton>} />
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
          {clients.map((c) => (
            <li key={c.id}>
              <Link href={`/clients/${c.id}`} className="grid gap-1 px-4 py-3 transition hover:bg-recessed md:grid-cols-[2fr_2fr_1fr_6.5rem] md:items-center md:gap-4">
                <span className="font-semibold">{c.name}{c.companyName && <span className="font-normal text-ink-muted"> · {c.companyName}</span>}</span>
                <span className="text-sm text-ink-muted">{c.email || c.phone || "No contact details"}</span>
                <span className="text-sm text-ink-muted">{c.projectCount} project{c.projectCount === 1 ? "" : "s"}</span>
                {c.archived ? <Badge>Archived</Badge> : <span />}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
