"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createCustomInvoiceAction, createMilestoneInvoiceAction } from "@/app/actions";
import { formatMoney } from "@/domain/money";
import type { QuotationInvoicing as Data } from "@/server/invoices";
import { CustomInvoiceForm } from "./custom-invoice-form";
import { Badge, Button, Card, SectionTitle } from "./ui";
import { SaveStatus, useSave } from "./use-save";

/** INV1 and INV2: invoice by milestone or custom, up to the accepted value, with the remainder always visible. */
export function QuotationInvoicing({ data }: { data: Data }) {
  const router = useRouter();
  const act = useSave();
  const [custom, setCustom] = useState(false);
  const fmt = (c: number) => formatMoney(c, data.currency);
  const sym = data.currency === "USD" ? "US$" : "R";
  return (
    <Card>
      <SectionTitle title="Invoicing" hint="One accepted quotation can produce several invoices (a deposit, milestones, a final one), up to its accepted value." />
      <dl className="grid grid-cols-3 gap-3 text-sm">
        {[
          ["Accepted total", fmt(data.totalCents)],
          ["Invoiced", fmt(data.invoicedCents)],
          ["Still to invoice", fmt(data.remainingCents)],
        ].map(([k, v]) => (
          <div key={k} className="rounded border border-line bg-recessed p-2">
            <dt className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">{k}</dt>
            <dd className="money mt-0.5 font-semibold">{v}</dd>
          </div>
        ))}
      </dl>

      <ul className="mt-4 divide-y divide-line rounded-lg border border-line">
        {data.milestones.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
            <div>
              <span className="font-semibold">{m.label}</span> <span className="text-sm text-ink-muted">{m.percent}%</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="money text-sm">{fmt(m.amountCents)}</span>
              {m.invoiceId ? (
                <Link href={`/invoices/${m.invoiceId}`} className="inline-flex items-center gap-1">
                  <Badge tone={m.invoiceStatus === "issued" ? "primary" : "neutral"}>{m.invoiceNumber ?? "Draft invoice"}</Badge>
                </Link>
              ) : (
                <Button
                  disabled={act.pending}
                  aria-label={`Create invoice for ${m.label}`}
                  onClick={() => act.run(() => createMilestoneInvoiceAction(data.quotationId, m.id), ({ id }) => router.push(`/invoices/${id}`))}
                >
                  Create invoice
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-2"><SaveStatus state={act.state} retry={act.retry} /></div>

      <div className="mt-4">
        {!custom ? (
          <Button disabled={data.remainingCents <= 0} onClick={() => setCustom(true)}>Create a custom invoice…</Button>
        ) : (
          <div className="rounded-lg border border-line p-3">
            <CustomInvoiceForm
              currencySymbol={sym}
              submitLabel="Create custom invoice"
              onSubmit={(f) => createCustomInvoiceAction(data.quotationId, f)}
            />
            <div className="mt-2"><Button variant="ghost" onClick={() => setCustom(false)}>Cancel</Button></div>
          </div>
        )}
      </div>
    </Card>
  );
}
