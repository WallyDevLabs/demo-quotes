"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  acceptQuotationAction,
  deleteQuotationDraftAction,
  duplicateQuotationAction,
  rejectQuotationAction,
  sendQuotationAction,
  updateQuotationDraftAction,
} from "@/app/actions";
import { formatMoney } from "@/domain/money";
import { buildPaymentSchedule } from "@/domain/quotation";
import type { QuotationDTO } from "@/server/quotations";
import { STATUS_LABEL, STATUS_TONE } from "./quotation-status";
import { SaveStatus, useSave } from "./use-save";
import { Badge, Banner, Button, Card, Field, LinkButton, NumberInput, SectionTitle, TextInput, Textarea } from "./ui";


function Draft({ q }: { q: QuotationDTO }) {
  const router = useRouter();
  const save = useSave();
  const send = useSave();
  const [confirmSend, setConfirmSend] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [f, setF] = useState({
    title: q.title,
    scope: q.scope,
    deliverables: q.deliverables,
    exclusions: q.exclusions,
    timeline: q.timeline,
    revisionPolicy: q.revisionPolicy,
    terms: q.terms,
  });
  const [ms, setMs] = useState(q.milestones.map((m) => ({ label: m.label, percent: m.percent })));
  const [dirty, setDirty] = useState(false);
  const edit = (p: Partial<typeof f>) => {
    setF({ ...f, ...p });
    setDirty(true);
  };

  // The schedule preview uses the same domain function as the server (QUO6).
  const schedule = useMemo(() => {
    try {
      return { ok: true as const, items: buildPaymentSchedule(q.totalCents, ms.map((m) => ({ label: m.label || "Milestone", percent: m.percent }))) };
    } catch (e) {
      return { ok: false as const, message: e instanceof Error ? e.message : "Check the percentages" };
    }
  }, [ms, q.totalCents]);
  const pctTotal = ms.reduce((s, m) => s + (Number(m.percent) || 0), 0);

  const saveDraft = () => save.run(() => updateQuotationDraftAction(q.id, { ...f, milestones: ms }), () => { setDirty(false); router.refresh(); });

  return (
    <div className="space-y-4">
      <Card>
        <SectionTitle title="Quotation content" hint="The priced lines and total are copied from the estimate and cannot be edited here. To change the price, change the estimate and create a new quotation." />
        <div className="grid gap-3">
          <Field label="Title" htmlFor="q-title" error={save.error("title")}><TextInput id="q-title" value={f.title} onChange={(e) => edit({ title: e.target.value })} /></Field>
          <Field label="Scope of work" htmlFor="q-scope"><Textarea id="q-scope" value={f.scope} onChange={(e) => edit({ scope: e.target.value })} /></Field>
          <Field label="Deliverables" htmlFor="q-del"><Textarea id="q-del" value={f.deliverables} onChange={(e) => edit({ deliverables: e.target.value })} /></Field>
          <Field label="Exclusions" htmlFor="q-exc"><Textarea id="q-exc" value={f.exclusions} onChange={(e) => edit({ exclusions: e.target.value })} /></Field>
          <Field label="Estimated delivery timeline" htmlFor="q-time"><TextInput id="q-time" value={f.timeline} onChange={(e) => edit({ timeline: e.target.value })} placeholder="e.g. 8 weeks from the deposit" /></Field>
          <Field label="Revision policy" htmlFor="q-rev"><Textarea id="q-rev" value={f.revisionPolicy} onChange={(e) => edit({ revisionPolicy: e.target.value })} /></Field>
          <Field label="Terms and conditions" htmlFor="q-terms"><Textarea id="q-terms" className="min-h-32" value={f.terms} onChange={(e) => edit({ terms: e.target.value })} /></Field>
        </div>
      </Card>

      <Card>
        <SectionTitle title="Payment schedule" hint="Milestone percentages must total exactly 100. Amounts always add up to the total to the cent." right={<Button onClick={() => { setMs([...ms, { label: "", percent: "" }]); setDirty(true); }}>Add milestone</Button>} />
        <div className="space-y-2">
          {ms.map((m, i) => (
            <div key={i} className="grid grid-cols-[1fr_6.5rem_8rem_auto] items-center gap-2">
              <TextInput aria-label={`Milestone ${i + 1} name`} value={m.label} onChange={(e) => { setMs(ms.map((x, j) => (j === i ? { ...x, label: e.target.value } : x))); setDirty(true); }} />
              <NumberInput aria-label={`Milestone ${i + 1} percent`} suffix="%" value={m.percent} onChange={(e) => { setMs(ms.map((x, j) => (j === i ? { ...x, percent: e.target.value } : x))); setDirty(true); }} />
              <span className="money text-right text-sm">{schedule.ok ? formatMoney(schedule.items[i]?.amountCents ?? 0, q.currency) : "—"}</span>
              <Button variant="ghost" aria-label={`Remove milestone ${i + 1}`} onClick={() => { setMs(ms.filter((_, j) => j !== i)); setDirty(true); }}>Remove</Button>
            </div>
          ))}
          {ms.length === 0 && <p className="text-sm text-ink-muted">No milestones: the whole amount is due as one payment.</p>}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {ms.length > 0 && <Badge tone={Math.round(pctTotal * 100) === 10000 ? "profit" : "caution"}>Total {Math.round(pctTotal * 100) / 100}% (must be 100)</Badge>}
          {save.error("milestones") && <span role="alert" className="text-xs font-medium text-cost-ink">{save.error("milestones")}</span>}
        </div>
      </Card>

      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" disabled={save.pending} onClick={saveDraft}>Save draft</Button>
          <SaveStatus state={save.state} retry={save.retry} />
          {dirty && <Badge tone="caution">Unsaved changes</Badge>}
          <span className="flex-1" />
          {!confirmSend ? (
            <Button disabled={dirty || send.pending} title={dirty ? "Save your changes first" : undefined} onClick={() => setConfirmSend(true)}>Send quotation…</Button>
          ) : null}
          <Button variant="ghost" onClick={() => setConfirmDelete(true)}>Delete draft</Button>
        </div>
        {confirmSend && (
          <div role="alertdialog" aria-label="Confirm send" className="mt-3 rounded border border-caution/30 bg-caution-soft p-3 text-sm text-caution-ink">
            <p className="font-semibold">Send this quotation?</p>
            <p className="mt-1 text-xs">It gets its number now, a PDF is created and stored, and the quotation can no longer be edited. To change it later you would duplicate it as a new draft.</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button variant="primary" disabled={send.pending} onClick={() => send.run(() => sendQuotationAction(q.id), undefined, { reload: true })}>Send and freeze</Button>
              <Button onClick={() => setConfirmSend(false)}>Not yet</Button>
              <SaveStatus state={send.state} retry={send.retry} />
            </div>
          </div>
        )}
        {confirmDelete && (
          <div role="alertdialog" aria-label="Confirm delete" className="mt-3 rounded border border-cost/30 bg-cost-soft p-3 text-sm text-cost-ink">
            <p className="font-semibold">Delete this draft? It has no number yet, so nothing is lost from your records.</p>
            <div className="mt-2 flex gap-2">
              <Button variant="danger" onClick={() => send.run(() => deleteQuotationDraftAction(q.id), () => router.push("/quotations"))}>Delete draft</Button>
              <Button onClick={() => setConfirmDelete(false)}>Keep it</Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

function Sent({ q }: { q: QuotationDTO }) {
  const router = useRouter();
  const act = useSave();
  const [mode, setMode] = useState<"accept" | "reject" | null>(null);
  const [name, setName] = useState("");
  const [reason, setReason] = useState("");
  const expired = q.displayStatus === "expired";
  const pdf = `/quotations/${q.id}/pdf`;
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={STATUS_TONE[q.displayStatus]}>{STATUS_LABEL[q.displayStatus]}</Badge>
        {q.number && <span className="money text-sm font-semibold">{q.number}</span>}
        <span className="flex-1" />
        <LinkButton href={pdf}>Download PDF</LinkButton>
        <Button disabled={act.pending} onClick={() => act.run(() => duplicateQuotationAction(q.id), ({ id }) => router.push(`/quotations/${id}`))}>Duplicate as new draft</Button>
      </div>

      {expired && (
        <div className="mt-3">
          <Banner tone="caution">This quotation expired on {q.expiryDate}. It cannot be accepted. Duplicate it as a new draft with a new expiry date.</Banner>
        </div>
      )}
      {q.displayStatus === "sent" && !mode && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => setMode("accept")}>Mark accepted</Button>
          <Button onClick={() => setMode("reject")}>Mark rejected</Button>
        </div>
      )}
      {mode === "accept" && (
        <div className="mt-3 grid gap-2 sm:max-w-md">
          <Field label="Accepted by (optional)" htmlFor="acc-by"><TextInput id="acc-by" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name of the person who accepted" /></Field>
          <div className="flex gap-2">
            <Button variant="primary" disabled={act.pending} onClick={() => act.run(() => acceptQuotationAction(q.id, name), undefined, { reload: true })}>Record acceptance</Button>
            <Button onClick={() => setMode(null)}>Cancel</Button>
          </div>
        </div>
      )}
      {mode === "reject" && (
        <div className="mt-3 grid gap-2 sm:max-w-md">
          <Field label="Reason (optional)" htmlFor="rej-why"><Textarea id="rej-why" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          <div className="flex gap-2">
            <Button variant="danger" disabled={act.pending} onClick={() => act.run(() => rejectQuotationAction(q.id, reason), undefined, { reload: true })}>Record rejection</Button>
            <Button onClick={() => setMode(null)}>Cancel</Button>
          </div>
        </div>
      )}
      {q.status === "accepted" && (
        <p className="mt-3 text-sm">Accepted on <span className="money">{q.acceptedAt}</span>{q.acceptedBy ? ` by ${q.acceptedBy}` : ""}. Invoices are created from accepted quotations in the next milestone.</p>
      )}
      {q.status === "rejected" && (
        <p className="mt-3 text-sm">Rejected on <span className="money">{q.rejectedAt}</span>{q.rejectionReason ? `: ${q.rejectionReason}` : ""}.</p>
      )}
      <div className="mt-2"><SaveStatus state={act.state} retry={act.retry} /></div>
      <p className="mt-3 text-xs text-ink-muted">Issued {q.issueDate}, valid until {q.expiryDate}. This quotation is a record: its content, price and PDF can no longer change.</p>
    </Card>
  );
}

export function QuotationPanel({ q }: { q: QuotationDTO }) {
  return q.status === "draft" ? <Draft q={q} /> : <Sent q={q} />;
}
