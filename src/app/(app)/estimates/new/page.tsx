import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { EstimateEditor } from "@/components/estimate-editor";
import { EmptyState, LinkButton } from "@/components/ui";
import { CURRENCIES, type Currency } from "@/domain/money";
import { blankDraft } from "@/domain/pricing/draft";
import { listProjects } from "@/server/clients";
import { requireOwnerId } from "@/server/owner";
import { getOverview } from "@/server/overview";
import { getPricingSettings, getSettings } from "@/server/settings";

export const metadata = { title: "New estimate" };

export default async function NewEstimatePage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const ownerId = await requireOwnerId();
  const overview = await getOverview(ownerId);
  // EST10: no estimate can be created until rates are configured, so first run goes to settings.
  if (!overview.anyRatesReady) redirect("/settings#rates");

  const [settings, projects, ...pricing] = await Promise.all([
    getSettings(ownerId),
    listProjects(ownerId),
    ...CURRENCIES.map((c) => getPricingSettings(ownerId, c)),
  ]);
  if (projects.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">New estimate</h1>
        <EmptyState title="Create a project first" body="An estimate belongs to a project." action={<LinkButton href="/projects/new" variant="primary">Create a project</LinkButton>} />
      </div>
    );
  }
  const byCurrency = Object.fromEntries(CURRENCIES.map((c, i) => [c, pricing[i]!])) as Record<Currency, (typeof pricing)[number]>;
  const preferred = settings.business.defaultCurrency;
  const currency: Currency = overview.ratesReady[preferred] ? preferred : CURRENCIES.find((c) => overview.ratesReady[c])!;
  const { project } = await searchParams;
  const draft = blankDraft(currency, randomUUID, { urgencyPct: settings.business.urgencyPct, contingencyPct: settings.business.contingencyPct }, byCurrency[currency]);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">New estimate</h1>
      <EstimateEditor
        estimateId={null}
        status="DRAFT"
        initial={{ projectId: projects.some((p) => p.id === project) ? project! : "", title: "", internalNotes: "", draft }}
        projects={projects.map((p) => ({ id: p.id, label: `${p.name} · ${p.clientName}` }))}
        settings={byCurrency}
      />
    </div>
  );
}
