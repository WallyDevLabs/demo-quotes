import Link from "next/link";
import { Badge, EmptyState, LinkButton } from "@/components/ui";
import { AUDIT_ENTITIES, listAudit } from "@/server/audit-log";
import { requireOwnerId } from "@/server/owner";

export const metadata = { title: "Audit log" };

const LINK: Record<string, string> = { quotation: "/quotations", invoice: "/invoices", estimate: "/estimates", client: "/clients", project: "/projects" };

/** Johannesburg wall clock, so the log reads the way the business does. */
const when = (iso: string) =>
  new Intl.DateTimeFormat("en-ZA", { timeZone: "Africa/Johannesburg", dateStyle: "medium", timeStyle: "medium" }).format(new Date(iso));

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ entity?: string; before?: string }> }) {
  const { entity, before } = await searchParams;
  const { entries, nextBefore } = await listAudit(await requireOwnerId(), { entity, before });
  const q = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ entity, ...extra })) if (v) p.set(k, v);
    const s = p.toString();
    return `/audit${s ? `?${s}` : ""}`;
  };
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Audit log</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Every status change, setting change, payment reversal and sign-in is recorded here with its time. It is read-only and holds field names, ids and statuses only, never client names, emails or amounts.
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5" aria-label="Filter by type">
        <LinkButton href="/audit" variant={entity ? "secondary" : "primary"}>All</LinkButton>
        {AUDIT_ENTITIES.map((e) => (
          <LinkButton key={e} href={`/audit?entity=${e}`} variant={entity === e ? "primary" : "secondary"}>{e}</LinkButton>
        ))}
      </div>
      {entries.length === 0 ? (
        <EmptyState title="Nothing logged here yet" body="Entries appear as you send quotations, issue invoices, change settings and sign in." />
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
          {entries.map((e) => (
            <li key={e.id} className="grid gap-1 px-4 py-2.5 text-sm md:grid-cols-[13rem_7rem_1fr] md:items-baseline md:gap-4">
              <span className="money text-xs text-ink-muted">{when(e.at)}</span>
              <span><Badge>{e.entity}</Badge></span>
              <span className="min-w-0">
                <span className="font-semibold">{e.action}</span>
                {LINK[e.entity] ? (
                  <Link className="ml-2 text-xs text-primary underline" href={`${LINK[e.entity]}/${e.entityId}`}>open</Link>
                ) : null}
                {e.detail && <span className="money block break-all text-xs text-ink-muted">{e.detail}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {nextBefore && <div><LinkButton href={q({ before: nextBefore })}>Older entries</LinkButton></div>}
    </div>
  );
}
