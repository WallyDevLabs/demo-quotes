import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { DocumentView } from "@/components/document-view";
import { QuotationInvoicing } from "@/components/quotation-invoicing";
import { QuotationPanel } from "@/components/quotation-panel";
import { STATUS_LABEL, STATUS_TONE } from "@/components/quotation-status";
import { Badge } from "@/components/ui";
import { formatMoney } from "@/domain/money";
import { getQuotationInvoicing } from "@/server/invoices";
import { requireOwnerId } from "@/server/owner";
import { getQuotation, getQuotationDocument } from "@/server/quotations";

export const metadata = { title: "Quotation" };

export default async function QuotationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const ownerId = await requireOwnerId();
  const [q, doc] = await Promise.all([getQuotation(ownerId, id), getQuotationDocument(ownerId, id)]);
  if (!q || !doc) notFound();
  const invoicing = q.status === "accepted" ? await getQuotationInvoicing(ownerId, id) : null;
  return (
    <div className="space-y-4">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{q.number ?? "Draft quotation"}</h1>
          <Badge tone={STATUS_TONE[q.displayStatus]}>{STATUS_LABEL[q.displayStatus]}</Badge>
        </div>
        <p className="text-sm text-ink-muted">
          {q.title || q.projectName} · {q.clientName} · <span className="money">{formatMoney(q.totalCents, q.currency)}</span>
          {q.estimateId && <> · <Link className="underline" href={`/estimates/${q.estimateId}`}>estimate</Link></>} · <Link className="underline" href={`/quotations/${q.id}/working`}>Show working</Link>
        </p>
      </div>
      <QuotationPanel q={q} />
      {invoicing && <QuotationInvoicing data={invoicing} />}
      <details open={q.status !== "draft"} className="rounded-lg border border-line bg-surface p-4">
        <summary className="cursor-pointer text-sm font-semibold">
          {q.status === "draft" ? "Preview (the saved version)" : "The quotation as sent"}
        </summary>
        <div className="mt-3"><DocumentView doc={doc} /></div>
      </details>
    </div>
  );
}
