import { notFound } from "next/navigation";
import { z } from "zod";
import { EstimateEditor } from "@/components/estimate-editor";
import { CURRENCIES, type Currency } from "@/domain/money";
import { listProjects } from "@/server/clients";
import { getEstimate } from "@/server/estimates";
import { requireOwnerId } from "@/server/owner";
import { quotationsForEstimate } from "@/server/quotations";
import { getPricingSettings } from "@/server/settings";

export const metadata = { title: "Estimate" };

export default async function EstimatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const ownerId = await requireOwnerId();
  const [estimate, projects, quotations, ...pricing] = await Promise.all([
    getEstimate(ownerId, id),
    listProjects(ownerId),
    quotationsForEstimate(ownerId, id),
    ...CURRENCIES.map((c) => getPricingSettings(ownerId, c)),
  ]);
  if (!estimate) notFound();
  const settings = Object.fromEntries(CURRENCIES.map((c, i) => [c, pricing[i]!])) as Record<Currency, (typeof pricing)[number]>;
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{estimate.title || "Estimate"}</h1>
        <p className="text-sm text-ink-muted">{estimate.projectName} · {estimate.clientName} · <a className="underline" href={`/estimates/${estimate.id}/working`}>Show working</a></p>
      </div>
      <EstimateEditor
        estimateId={estimate.id}
        status={estimate.status}
        initial={{ projectId: estimate.projectId, title: estimate.title, internalNotes: estimate.internalNotes, draft: estimate.draft }}
        projects={projects.map((p) => ({ id: p.id, label: `${p.name} · ${p.clientName}` }))}
        settings={settings}
        quotations={quotations}
      />
    </div>
  );
}
