import type { QuotationDocument } from "@/domain/quotation";

/**
 * The quotation as the client will read it. Presentation only: every string comes from the pure
 * document model. It is styled like paper (always light) so it looks the same in either theme.
 */
function Block({ title, body }: { title: string; body: string }) {
  if (!body.trim()) return null;
  return (
    <section className="mt-5">
      <h3 className="text-sm font-bold">{title}</h3>
      <p className="mt-1 whitespace-pre-wrap text-sm">{body}</p>
    </section>
  );
}

function Rows({ heads, rows }: { heads: [string, string, string]; rows: { a: string; b: string; c: string }[] }) {
  return (
    <table className="mt-2 w-full text-left text-sm">
      <thead>
        <tr className="bg-slate-100 text-[11px] uppercase tracking-wider text-slate-500">
          <th className="px-2 py-1.5 font-bold">{heads[0]}</th>
          <th className="px-2 py-1.5 font-bold">{heads[1]}</th>
          <th className="px-2 py-1.5 text-right font-bold">{heads[2]}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-b border-slate-200 align-top">
            <td className="px-2 py-1.5">{r.a}</td>
            <td className="px-2 py-1.5 text-slate-500">{r.b}</td>
            <td className="money px-2 py-1.5 text-right">{r.c}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function DocumentView({ doc }: { doc: QuotationDocument }) {
  return (
    <article aria-label="Quotation preview" className="rounded-lg border border-line bg-white p-5 text-slate-900 shadow-raised sm:p-8">
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
          {doc.isDraft && <div className="text-sm font-bold text-amber-700">DRAFT, not yet sent</div>}
          <div className="text-sm text-slate-500">Issued: {doc.issueDate}</div>
          <div className="text-sm text-slate-500">Valid until: {doc.expiryDate}</div>
        </div>
      </header>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Prepared for</div>
          <div className="font-bold">{doc.client.name}</div>
          {doc.client.lines.map((l, i) => (
            <div key={i} className="text-sm text-slate-500">{l}</div>
          ))}
        </div>
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Project</div>
          <div className="font-bold">{doc.projectName}</div>
          {doc.heading && <div className="text-sm text-slate-500">{doc.heading}</div>}
        </div>
      </div>

      <Block title="Scope of work" body={doc.text.scope} />
      <Block title="Deliverables" body={doc.text.deliverables} />
      <Block title="Exclusions" body={doc.text.exclusions} />

      <Rows heads={["Item", "Detail", "Amount"]} rows={doc.lines.map((l) => ({ a: l.description, b: l.detail, c: l.amount }))} />
      <dl className="ml-auto mt-3 grid w-full max-w-xs grid-cols-[1fr_auto] gap-y-1 text-sm">
        <dt>Subtotal</dt>
        <dd className="money text-right">{doc.totals.subtotal}</dd>
        {doc.totals.discount && (
          <>
            <dt>Discount</dt>
            <dd className="money text-right">-{doc.totals.discount}</dd>
          </>
        )}
        <dt className="border-t border-slate-900 pt-1 text-base font-bold">Total</dt>
        <dd className="money border-t border-slate-900 pt-1 text-right text-base font-bold">{doc.totals.total}</dd>
      </dl>

      {doc.recurring.length > 0 && (
        <section className="mt-5">
          <h3 className="text-sm font-bold">Recurring costs (not included in the total above)</h3>
          <Rows heads={["Item", "Billed", "Amount"]} rows={doc.recurring.map((l) => ({ a: l.description, b: l.detail, c: l.amount }))} />
        </section>
      )}

      <section className="mt-5">
        <h3 className="text-sm font-bold">Payment schedule</h3>
        <Rows heads={["Milestone", "Share", "Amount"]} rows={doc.schedule.map((m) => ({ a: m.label, b: m.percent, c: m.amount }))} />
      </section>

      <Block title="Estimated timeline" body={doc.text.timeline} />
      <Block title="Revision policy" body={doc.text.revisionPolicy} />
      <Block title="Terms and conditions" body={doc.text.terms} />

      <section className="mt-6">
        <h3 className="text-sm font-bold">Acceptance</h3>
        <p className="mt-1 text-sm">{doc.acceptance}</p>
        <div className="mt-8 grid grid-cols-3 gap-6 text-xs text-slate-500">
          {["Name", "Signature", "Date"].map((x) => (
            <div key={x} className="border-t border-slate-900 pt-1">{x}</div>
          ))}
        </div>
      </section>
    </article>
  );
}
