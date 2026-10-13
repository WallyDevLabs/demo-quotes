import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { InvoiceDocumentView } from "@/components/invoice-doc-view";
import { InvoicePanel } from "@/components/invoice-panel";
import { INVOICE_LABEL, INVOICE_TONE } from "@/components/invoice-status";
import { Badge } from "@/components/ui";
import { todayInJohannesburg } from "@/domain/dates";
import { formatMoney } from "@/domain/money";
import { getInvoice, getInvoiceDocument } from "@/server/invoices";
import { requireOwnerId } from "@/server/owner";

export const metadata = { title: "Invoice" };

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const ownerId = await requireOwnerId();
  const [inv, doc] = await Promise.all([getInvoice(ownerId, id), getInvoiceDocument(ownerId, id)]);
  if (!inv || !doc) notFound();
  return (
    <div className="space-y-4">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{inv.number ?? "Draft invoice"}</h1>
          <Badge tone={INVOICE_TONE[inv.displayStatus]}>{INVOICE_LABEL[inv.displayStatus]}</Badge>
        </div>
        <p className="text-sm text-ink-muted">
          {inv.milestoneLabel ?? inv.customReason} · {inv.clientName} · {inv.projectName} · <span className="money">{formatMoney(inv.totalCents, inv.currency)}</span>
          {inv.quotationId && <> · <Link className="underline" href={`/quotations/${inv.quotationId}`}>{inv.quotationNumber ?? "quotation"}</Link></>}
        </p>
      </div>
      <InvoicePanel inv={inv} today={todayInJohannesburg(new Date())} />
      <details open={inv.status !== "draft"} className="rounded-lg border border-line bg-surface p-4">
        <summary className="cursor-pointer text-sm font-semibold">{inv.status === "draft" ? "Preview (the saved version)" : "The invoice as issued"}</summary>
        <div className="mt-3"><InvoiceDocumentView doc={doc} /></div>
      </details>
    </div>
  );
}
