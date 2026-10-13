import { ProjectForm } from "@/components/client-project-forms";
import { EmptyState, LinkButton } from "@/components/ui";
import { listClients } from "@/server/clients";
import { requireOwnerId } from "@/server/owner";

export const metadata = { title: "New project" };

export default async function NewProjectPage({ searchParams }: { searchParams: Promise<{ client?: string }> }) {
  const clients = await listClients(await requireOwnerId());
  const { client } = await searchParams;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">New project</h1>
      {clients.length === 0 ? (
        <EmptyState title="Add a client first" body="A project belongs to a client." action={<LinkButton href="/clients/new" variant="primary">Add a client</LinkButton>} />
      ) : (
        <ProjectForm clients={clients.map((c) => ({ id: c.id, name: c.name }))} defaultClientId={client} />
      )}
    </div>
  );
}
