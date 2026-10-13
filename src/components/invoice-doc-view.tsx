import type { InvoiceDocument } from "@/domain/invoicing";

/**
 * The invoice as the client reads it, styled like paper (always light). Presentation only: every
 * string comes from the pure document model. Amount paid and balance here are live; the stored PDF
 * shows the balance at the moment of issue.
 */
export function InvoiceDocumentView({ doc }: { doc: InvoiceDocument }) {
  return (
    <article aria-label="Invoice preview" className="rounded-lg border border-line bg-white p-5 text-slate-900 shadow-raised sm:p-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          {doc.business.logoFileId && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/files/${doc.business.logoFileId}`} alt="Business logo" className="mb-2 h-16 w-16 object-contain" />
          )}
          <div className="text-base font-bold">{doc.business.name || "Your business name"}</div>
          {doc.business.lines.map((l, i) => (
            <div key={i} className="text-sm text-slate-500">{l}</div>
          ))}
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold text-indigo-600">{doc.title}</div>
          <div className="money text-sm">{doc.number}</div>
          {doc.isDraft && <div className="text-sm font-bold text-amber-700">DRAFT, not yet issued</div>}
          <div className="text-sm text-slate-500">Invoice date: {doc.invoiceDate}</div>
          <div className="text-sm text-slate-500">Due date: {doc.dueDate}</div>
        </div>
      </header>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Billed to</div>
          <div className="font-bold">{doc.client.name}</div>
          {doc.client.lines.map((l, i) => (
            <div key={i} className="text-sm text-slate-500">{l}</div>
          ))}
        </div>
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Project</div>
          <div className="font-bold">{doc.projectName}</div>
          {doc.reference && <div className="text-sm text-slate-500">{doc.reference}</div>}
        </div>
      </div>

      <table className="mt-6 w-full text-left text-sm">
        <thead>
          <tr className="bg-slate-100 text-[11px] uppercase tracking-wider text-slate-500">
            <th className="px-2 py-1.5 font-bold">Description</th>
            <th className="px-2 py-1.5 font-bold">Reference</th>
            <th className="px-2 py-1.5 text-right font-bold">Amount</th>
          </tr>
        </thead>
        <tbody>
          {doc.lines.map((l, i) => (
            <tr key={i} className="border-b border-slate-200 align-top">
              <td className="px-2 py-1.5">{l.description}</td>
              <td className="px-2 py-1.5 text-slate-500">{l.detail}</td>
              <td className="money px-2 py-1.5 text-right">{l.amount}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <dl className="ml-auto mt-3 grid w-full max-w-xs grid-cols-[1fr_auto] gap-y-1 text-sm">
        {doc.totals.discount && (
          <>
            <dt>Subtotal</dt>
            <dd className="money text-right">{doc.totals.subtotal}</dd>
            <dt>Discount</dt>
            <dd className="money text-right">-{doc.totals.discount}</dd>
          </>
        )}
        <dt className="border-t border-slate-900 pt-1 text-base font-bold">Total</dt>
        <dd className="money border-t border-slate-900 pt-1 text-right text-base font-bold">{doc.totals.total}</dd>
        <dt>Amount paid</dt>
        <dd className="money text-right">{doc.totals.paid}</dd>
        <dt className="font-bold">Balance due</dt>
        <dd className="money text-right font-bold">{doc.totals.balance}</dd>
      </dl>

      <section className="mt-6">
        <h3 className="text-sm font-bold">Payment details</h3>
        {doc.banking.lines.map((l, i) => (
          <div key={i} className="text-sm">{l}</div>
        ))}
        <div className="mt-1 text-sm font-bold">Payment reference: {doc.banking.reference}</div>
        {doc.banking.instructions && <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">{doc.banking.instructions}</p>}
      </section>
    </article>
  );
}
