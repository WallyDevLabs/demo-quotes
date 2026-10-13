import Link from "next/link";
import { Badge, EmptyState, LinkButton } from "@/components/ui";
import { listClients, listProjects } from "@/server/clients";
import { requireOwnerId } from "@/server/owner";

export const metadata = { title: "Projects" };

export default async function ProjectsPage() {
  const ownerId = await requireOwnerId();
  const [projects, clients] = await Promise.all([listProjects(ownerId), listClients(ownerId)]);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
        {clients.length > 0 && <LinkButton href="/projects/new" variant="primary">New project</LinkButton>}
      </div>
      {clients.length === 0 ? (
        <EmptyState title="Add a client first" body="A project belongs to a client." action={<LinkButton href="/clients/new" variant="primary">Add a client</LinkButton>} />
      ) : projects.length === 0 ? (
        <EmptyState title="No projects yet" body="Create a project, then price it with an estimate." action={<LinkButton href="/projects/new" variant="primary">Create a project</LinkButton>} />
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
          {projects.map((p) => (
            <li key={p.id}>
              <Link href={`/projects/${p.id}`} className="grid gap-1 px-4 py-3 transition hover:bg-recessed md:grid-cols-[2fr_2fr_1fr_6.5rem] md:items-center md:gap-4">
                <span className="font-semibold">{p.name}</span>
                <span className="text-sm text-ink-muted">{p.clientName}</span>
                <span className="text-sm text-ink-muted">{p.deadline ? `Due ${p.deadline}` : "No deadline"}</span>
                <Badge>{p.status.replace("_", " ").toLowerCase()}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
