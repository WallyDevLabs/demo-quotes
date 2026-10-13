"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  cancelInvoiceAction,
  deleteInvoiceDraftAction,
  issueInvoiceAction,
  recordPaymentAction,
  reversePaymentAction,
  updateCustomInvoiceDraftAction,
} from "@/app/actions";
import { centsToAmountString, formatMoney } from "@/domain/money";
import { PAYMENT_LABELS, PAYMENT_METHODS } from "@/domain/schemas";
import type { InvoiceDTO, PaymentDTO } from "@/server/invoices";
import { CustomInvoiceForm } from "./custom-invoice-form";
import { INVOICE_LABEL, INVOICE_TONE } from "./invoice-status";
import { Badge, Banner, Button, Card, Field, LinkButton, NumberInput, SectionTitle, Select, TextInput, Textarea } from "./ui";
import { SaveStatus, useSave } from "./use-save";

const METHOD_LABEL: Record<string, string> = { EFT: "EFT", CARD: "Card", CASH: "Cash", OTHER: "Other" };
const LABEL_LABEL: Record<string, string> = { DEPOSIT: "Deposit", MILESTONE: "Milestone", FINAL: "Final", OTHER: "Other" };

function Draft({ inv }: { inv: InvoiceDTO }) {
  const router = useRouter();
  const issue = useSave();
  const del = useSave();
  const [confirmIssue, setConfirmIssue] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [zar, setZar] = useState("");
  const sym = inv.currency === "USD" ? "US$" : "R";
  const isCustom = inv.customReason !== "";
  return (
    <div className="space-y-4">
      {isCustom ? (
        <Card>
          <SectionTitle title="Custom invoice" hint="Edit the reason and lines while this is a draft. The total must stay within what is still to invoice on the quotation." />
          <CustomInvoiceForm
            currencySymbol={sym}
            submitLabel="Save draft"
            initial={{ reason: inv.customReason, lines: inv.lines.map((l) => ({ description: l.description, amount: centsToAmountString(l.amountCents) })) }}
            onSubmit={(f) => updateCustomInvoiceDraftAction(inv.id, f)}
           
          />
        </Card>
      ) : (
        <Banner tone="primary">
          This invoice is for the milestone {inv.milestoneLabel}. Its amount is fixed by the quotation. To change it, delete this draft and adjust the invoicing on the quotation.
        </Banner>
      )}
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          {!confirmIssue && <Button variant="primary" onClick={() => setConfirmIssue(true)}>Issue invoice…</Button>}
          <Button variant="ghost" onClick={() => setConfirmDelete(true)}>Delete draft</Button>
        </div>
        {confirmIssue && (
          <div role="alertdialog" aria-label="Confirm issue" className="mt-3 rounded border border-caution/30 bg-caution-soft p-3 text-sm text-caution-ink">
            <p className="font-semibold">Issue this invoice?</p>
            <p className="mt-1 text-xs">It gets its number now, the due date is set from your payment terms, a PDF is created and stored, and the invoice can no longer be edited or deleted. A mistake can only be fixed by cancelling it (before any payment is recorded).</p>
            {inv.currency === "USD" && (
              <Field label="Rand value at issue (optional)" htmlFor="zar" error={issue.error("zarValue")} hint="Only used by the VAT threshold monitor. Leave blank if you do not know it." className="mt-2 max-w-xs">
                <NumberInput id="zar" prefix="R" value={zar} onChange={(e) => setZar(e.target.value)} />
              </Field>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button variant="primary" disabled={issue.pending} onClick={() => issue.run(() => issueInvoiceAction(inv.id, { zarValue: zar }), undefined, { reload: true })}>
                Issue and freeze
              </Button>
              <Button onClick={() => setConfirmIssue(false)}>Not yet</Button>
              <SaveStatus state={issue.state} retry={issue.retry} />
            </div>
          </div>
        )}
        {confirmDelete && (
          <div role="alertdialog" aria-label="Confirm delete" className="mt-3 rounded border border-cost/30 bg-cost-soft p-3 text-sm text-cost-ink">
            <p className="font-semibold">Delete this draft? It has no number, so nothing is lost from your records.</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button variant="danger" disabled={del.pending} onClick={() => del.run(() => deleteInvoiceDraftAction(inv.id), () => router.push(inv.quotationId ? `/quotations/${inv.quotationId}` : "/invoices"))}>Delete draft</Button>
              <Button onClick={() => setConfirmDelete(false)}>Keep it</Button>
              <SaveStatus state={del.state} retry={del.retry} />
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

function PaymentRow({ p, inv, canReverse }: { p: PaymentDTO; inv: InvoiceDTO; canReverse: boolean }) {
  const router = useRouter();
  const rev = useSave();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const isReversal = p.reversesPaymentId !== null;
  const fmt = (c: number) => formatMoney(c, inv.currency);
  return (
    <li className={`rounded-lg border border-line p-3 ${p.reversed || isReversal ? "bg-recessed" : ""}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`money font-semibold ${p.reversed ? "line-through opacity-60" : ""}`}>{isReversal ? "-" : ""}{fmt(p.amountCents)}</span>
          {isReversal && <Badge tone="cost">Reversal</Badge>}
          {p.reversed && <Badge tone="caution">Reversed</Badge>}
          {!isReversal && <Badge>{LABEL_LABEL[p.label]}</Badge>}
        </div>
        <span className="text-sm text-ink-muted"><span className="money">{p.receivedOn}</span> · {METHOD_LABEL[p.method]}{p.reference ? ` · ${p.reference}` : ""}</span>
      </div>
      {p.notes && <p className="mt-1 text-sm text-ink-muted">{p.notes}</p>}
      {isReversal && <p className="mt-1 text-sm">Reason: {p.reversalReason}</p>}
      {canReverse && !p.reversed && !isReversal && (
        <div className="mt-2">
          {!open ? (
            <Button variant="ghost" onClick={() => setOpen(true)}>Reverse…</Button>
          ) : (
            <div className="grid gap-2 sm:max-w-md">
              <Field label="Reason for reversing" htmlFor={`rev-${p.id}`} error={rev.error("reason")}>
                <TextInput id={`rev-${p.id}`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Paid against the wrong invoice" />
              </Field>
              <p className="text-xs text-ink-muted">Both entries stay visible and the balance is restored. Nothing is deleted.</p>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="danger" disabled={rev.pending} onClick={() => rev.run(() => reversePaymentAction(p.id, reason), undefined, { reload: true })}>Reverse payment</Button>
                <Button onClick={() => setOpen(false)}>Cancel</Button>
                <SaveStatus state={rev.state} retry={rev.retry} />
              </div>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function RecordPayment({ inv, today }: { inv: InvoiceDTO; today: string }) {
  const router = useRouter();
  const { state, run, retry, pending, error } = useSave();
  const [f, setF] = useState({ amount: "", receivedOn: today, method: "EFT", label: "OTHER", reference: "", notes: "" });
  const sym = inv.currency === "USD" ? "US$" : "R";
  return (
    <Card>
      <SectionTitle title="Record a payment" hint={`Outstanding balance: ${formatMoney(inv.balanceCents, inv.currency)}. A payment above the balance is rejected. Record payments from your bank statement.`} />
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(
            () => recordPaymentAction(inv.id, { ...f, method: f.method as "EFT", label: f.label as "OTHER" }),
            undefined,
            { reload: true },
          );
        }}
      >
        <Field label="Amount received" htmlFor="pay-amount" error={error("amount")}>
          <div className="flex gap-2">
            <NumberInput id="pay-amount" prefix={sym} value={f.amount} invalid={!!error("amount")} onChange={(e) => setF({ ...f, amount: e.target.value })} />
            <Button onClick={() => setF({ ...f, amount: centsToAmountString(inv.balanceCents) })}>Full balance</Button>
          </div>
        </Field>
        <Field label="Date received" htmlFor="pay-date" error={error("receivedOn")}>
          <TextInput id="pay-date" type="date" max={today} value={f.receivedOn} invalid={!!error("receivedOn")} onChange={(e) => setF({ ...f, receivedOn: e.target.value })} />
        </Field>
        <Field label="Method" htmlFor="pay-method">
          <Select id="pay-method" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>
            {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}
          </Select>
        </Field>
        <Field label="Label" htmlFor="pay-label" hint="Descriptive only: it never changes a calculation.">
          <Select id="pay-label" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })}>
            {PAYMENT_LABELS.map((m) => <option key={m} value={m}>{LABEL_LABEL[m]}</option>)}
          </Select>
        </Field>
        <Field label="Reference (optional)" htmlFor="pay-ref"><TextInput id="pay-ref" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
        <Field label="Notes (optional)" htmlFor="pay-notes"><TextInput id="pay-notes" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
          <Button type="submit" variant="primary" disabled={pending}>Record payment</Button>
          <SaveStatus state={state} retry={retry} />
        </div>
      </form>
    </Card>
  );
}

function Issued({ inv, today }: { inv: InvoiceDTO; today: string }) {
  const router = useRouter();
  const cancel = useSave();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const fmt = (c: number) => formatMoney(c, inv.currency);
  const cancelled = inv.status === "cancelled";
  const hasActive = inv.payments.some((p) => !p.reversesPaymentId && !p.reversed);
  const canPay = inv.status === "issued" && inv.balanceCents > 0;
  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={INVOICE_TONE[inv.displayStatus]}>{INVOICE_LABEL[inv.displayStatus]}</Badge>
          {inv.overdue && inv.partiallyPaid && <Badge tone="caution">Partially paid</Badge>}
          <span className="flex-1" />
          <LinkButton href={`/invoices/${inv.id}/pdf`}>Download PDF</LinkButton>
        </div>
        <dl className="mt-3 grid grid-cols-3 gap-3 text-sm">
          {[
            ["Total", fmt(inv.totalCents)],
            ["Paid", fmt(inv.paidCents)],
            ["Balance", fmt(inv.balanceCents)],
          ].map(([k, v]) => (
            <div key={k} className="rounded border border-line bg-recessed p-2">
              <dt className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">{k}</dt>
              <dd className="money mt-0.5 font-semibold">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-xs text-ink-muted">
          Issued {inv.issueDate}, due <span className="money">{inv.dueDate}</span>. Paid, partially paid and overdue are worked out from the payments and the due date; they are never stored. This invoice is a record: it can no longer be edited, and its PDF is the one made at issue.
        </p>
        {inv.overdue && <div className="mt-3"><Banner tone="cost">This invoice was due on {inv.dueDate} and still has a balance of {fmt(inv.balanceCents)}.</Banner></div>}
        {cancelled && <div className="mt-3"><Banner tone="caution">Cancelled{inv.cancelledAt ? ` on ${inv.cancelledAt}` : ""}: {inv.cancelReason}</Banner></div>}
      </Card>

      {canPay && <RecordPayment inv={inv} today={today} />}

      <Card>
        <SectionTitle title="Payments" hint="Payments are never edited or deleted. A mistake is reversed with a reason, and both entries stay on record." />
        {inv.payments.length === 0 ? (
          <p className="text-sm text-ink-muted">No payments recorded yet.</p>
        ) : (
          <ul className="space-y-2">
            {inv.payments.map((p) => <PaymentRow key={p.id} p={p} inv={inv} canReverse={inv.status === "issued"} />)}
          </ul>
        )}
      </Card>

      {inv.status === "issued" && (
        <Card>
          <SectionTitle title="Cancel this invoice" hint="Allowed only while it has no payments, and a reason is required. After a payment, corrections need a credit note (phase two)." />
          {hasActive ? (
            <p className="text-sm text-ink-muted">Reverse its payments first to cancel it.</p>
          ) : !open ? (
            <Button variant="danger" onClick={() => setOpen(true)}>Cancel invoice…</Button>
          ) : (
            <div className="grid gap-2 sm:max-w-md">
              <Field label="Reason" htmlFor="cancel-reason" error={cancel.error("reason")}>
                <Textarea id="cancel-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
              </Field>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="danger" disabled={cancel.pending} onClick={() => cancel.run(() => cancelInvoiceAction(inv.id, reason), undefined, { reload: true })}>Cancel invoice</Button>
                <Button onClick={() => setOpen(false)}>Keep it</Button>
                <SaveStatus state={cancel.state} retry={cancel.retry} />
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

export function InvoicePanel({ inv, today }: { inv: InvoiceDTO; today: string }) {
  return inv.status === "draft" ? <Draft inv={inv} /> : <Issued inv={inv} today={today} />;
}
