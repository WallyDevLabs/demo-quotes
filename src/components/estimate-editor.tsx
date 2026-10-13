"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  createQuotationAction,
  deleteEstimateAction,
  duplicateEstimateAction,
  saveEstimateAction,
  setEstimateReadyAction,
} from "@/app/actions";
import { centsToAmountString, CURRENCIES, formatMoney, type Currency } from "@/domain/money";
import {
  describePath,
  evaluateDraft,
  isOverride,
  linesDroppedBySwitch,
  type DraftDeliverable,
  type DraftExpense,
  type DraftLabour,
  type EstimateDraft,
  type PricingContext,
} from "@/domain/pricing/draft";
import type { EstimateResult, ExplainEntry } from "@/domain/pricing/engine";
import { COMPLEXITIES, LABOUR_CATEGORIES, type Complexity, type LabourCategory } from "@/domain/pricing/schema";
import type { PricingSettings } from "@/server/settings";
import { SaveStatus, useSave } from "./use-save";
import { Badge, Banner, Button, Card, Field, NumberInput, Segmented, Select, SectionTitle, TextInput, Textarea } from "./ui";

const CATEGORY_LABEL: Record<LabourCategory, string> = {
  development: "Development",
  design: "Design",
  testing: "Testing",
  consulting: "Consulting",
  project_management: "Project management",
};
const SYMBOL: Record<Currency, string> = { ZAR: "R", USD: "US$" };
const uid = () => crypto.randomUUID();

export interface EditorProps {
  estimateId: string | null;
  status: "DRAFT" | "READY";
  initial: { projectId: string; title: string; internalNotes: string; draft: EstimateDraft };
  projects: { id: string; label: string }[];
  settings: Record<Currency, PricingSettings>;
  quotations?: { id: string; number: string | null; status: string }[];
}

// ---------- small helpers (no formulas here: every number comes from the domain engine) ----------

function patchList<T extends { id: string }>(list: T[], id: string, patch: Partial<T>): T[] {
  return list.map((x) => (x.id === id ? { ...x, ...patch } : x));
}
function move<T>(list: T[], i: number, dir: -1 | 1): T[] {
  const j = i + dir;
  if (j < 0 || j >= list.length) return list;
  const copy = [...list];
  [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  return copy;
}

function LineActions({ i, count, onUp, onDown, onDuplicate, onRemove, label }: { i: number; count: number; onUp: () => void; onDown: () => void; onDuplicate: () => void; onRemove: () => void; label: string }) {
  return (
    <div className="flex items-center gap-0.5 sm:justify-end">
      <Button variant="ghost" aria-label={`Move ${label} up`} disabled={i === 0} onClick={onUp} className="min-h-8 px-2">↑</Button>
      <Button variant="ghost" aria-label={`Move ${label} down`} disabled={i === count - 1} onClick={onDown} className="min-h-8 px-2">↓</Button>
      <Button variant="ghost" aria-label={`Duplicate ${label}`} onClick={onDuplicate} className="min-h-8 px-2">Copy</Button>
      <Button variant="ghost" aria-label={`Remove ${label}`} onClick={onRemove} className="min-h-8 px-2 text-cost-ink">Remove</Button>
    </div>
  );
}

function Explain({ entry }: { entry?: ExplainEntry }) {
  const [open, setOpen] = useState(false);
  if (!entry) return null;
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-label={`Explain ${entry.label}`}
        onClick={() => setOpen(!open)}
        className="ml-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full border border-line text-[10px] font-bold text-ink-muted hover:text-ink"
      >
        ?
      </button>
      {open && (
        <div className="col-span-2 mt-1 rounded border border-line bg-recessed p-2 text-xs text-ink-muted">
          <div className="font-semibold text-ink">{entry.formula}</div>
          <ul className="mt-1 space-y-0.5">
            {entry.inputs.map((x, i) => (
              <li key={i} className="money">{x}</li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

// ---------- the editor ----------

export function EstimateEditor({ estimateId, status, initial, projects, settings, quotations = [] }: EditorProps) {
  const router = useRouter();
  const [meta, setMeta] = useState({ projectId: initial.projectId, title: initial.title, internalNotes: initial.internalNotes });
  const [draft, setDraft] = useState<EstimateDraft>(initial.draft);
  const [dirty, setDirty] = useState(estimateId === null);
  const [submitted, setSubmitted] = useState(false);
  const [view, setView] = useState<"client" | "internal">("client");
  const [panelOpen, setPanelOpen] = useState(false);
  const [pendingSwitch, setPendingSwitch] = useState<"time" | "fixed" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const save = useSave();
  const action = useSave();

  const ps = settings[draft.currency];
  const ctx: PricingContext = ps;
  const sym = SYMBOL[draft.currency];
  const fmt = (c: number) => formatMoney(c, draft.currency);

  const evaluation = useMemo(() => evaluateDraft(draft, ctx), [draft, ctx]);
  const lastGood = useRef<EstimateResult | null>(null);
  if (evaluation.ok) lastGood.current = evaluation.result;
  const result = evaluation.ok ? evaluation.result : lastGood.current;
  const stale = !evaluation.ok;

  const edit = (fn: (d: EstimateDraft) => EstimateDraft) => {
    setDraft(fn);
    setDirty(true);
  };
  const editMeta = (p: Partial<typeof meta>) => {
    setMeta((m) => ({ ...m, ...p }));
    setDirty(true);
  };

  // Field errors: from the shared evaluator, plus anything the server reported.
  const issueFor = (path: string, value = "x") => {
    const own = !evaluation.ok ? evaluation.issues.find((i) => i.path === path)?.message : undefined;
    const server = save.error(path);
    // Quiet until the owner has typed something invalid or tried to save.
    if (own && (submitted || value.trim() !== "")) return own;
    return server;
  };

  const billedById = useMemo(() => {
    const m = new Map<string, number>();
    result?.expenseLines.forEach((e) => m.set(e.id, e.billedCents));
    result?.recurringLines.forEach((e) => m.set(e.id, e.billedCents));
    return m;
  }, [result]);
  const lineAmount = (id: string) => result?.lines.find((l) => l.id === id);
  const explain = (key: string) => result?.explanations.find((e) => e.key === key);

  // ----- mutations -----
  const defaultRate = (cat: LabourCategory, c: PricingContext = ctx) => {
    const r = c.defaultRatesCents[cat];
    return r === undefined ? "" : centsToAmountString(r);
  };
  const addLabour = () => edit((d) => ({ ...d, labour: [...d.labour, { id: uid(), task: "", category: "development", hours: "", rate: defaultRate("development") }] }));
  const addDeliverable = () => edit((d) => ({ ...d, deliverables: [...d.deliverables, { id: uid(), name: "", price: "", estimatedHours: "" }] }));
  const addExpense = () => edit((d) => ({ ...d, expenses: [...d.expenses, { id: uid(), description: "", cost: "", markupPct: "0", recurring: false, period: "monthly" }] }));

  const changeCategory = (l: DraftLabour, category: LabourCategory) =>
    edit((d) => ({
      ...d,
      labour: patchList(d.labour, l.id, { category, rate: isOverride(l, ctx) ? l.rate : defaultRate(category) }),
    }));

  const changeCurrency = (currency: Currency) => {
    const next = settings[currency];
    edit((d) => ({
      ...d,
      currency,
      // Rates that were not overrides follow the new currency's defaults; overrides are kept and stay flagged.
      labour: d.labour.map((l) => (isOverride(l, ctx) ? l : { ...l, rate: defaultRate(l.category, next) })),
    }));
  };

  const requestSwitch = (to: "time" | "fixed") => {
    if (to === draft.method) return;
    if (linesDroppedBySwitch(draft, to).length === 0) applySwitch(to);
    else setPendingSwitch(to);
  };
  const applySwitch = (to: "time" | "fixed") => {
    edit((d) => ({
      ...d,
      method: to,
      complexity: to === "fixed" ? (d.complexity ?? "basic") : d.complexity,
      labour: to === "fixed" ? [] : d.labour.length ? d.labour : [{ id: uid(), task: "", category: "development", hours: "", rate: defaultRate("development") }],
      deliverables: to === "time" ? [] : d.deliverables.length ? d.deliverables : [{ id: uid(), name: "", price: "", estimatedHours: "" }],
    }));
    setPendingSwitch(null);
  };

  const payload = () => ({
    projectId: meta.projectId,
    title: meta.title,
    currency: draft.currency,
    complexity: draft.method === "fixed" ? draft.complexity : null,
    internalNotes: meta.internalNotes,
  });
  const doSave = () => {
    setSubmitted(true);
    save.run(
      () => saveEstimateAction(estimateId, payload(), draft),
      ({ id }) => {
        setDirty(false);
        // A new estimate moves to its own page; an existing one is already refreshed by the action's revalidatePath.
        if (!estimateId) router.replace(`/estimates/${id}`);
      },
    );
  };

  const issueCount = evaluation.ok ? 0 : evaluation.issues.length;
  const ready = status === "READY";
  const needsRates = !ps.ratesConfigured;

  return (
    <div className="pb-28 lg:pb-0">
      {/* top bar */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={doSave} disabled={save.pending || needsRates}>
          Save draft
        </Button>
        <SaveStatus state={save.state} retry={save.retry} />
        {dirty && save.state.status !== "saving" && <Badge tone="caution">Unsaved changes</Badge>}
        {estimateId && (
          <>
            <Badge tone={ready ? "profit" : "neutral"}>{ready ? "Ready for quotation" : "Draft"}</Badge>
            <Button
              disabled={action.pending || dirty}
              title={dirty ? "Save your changes first" : undefined}
              onClick={() => action.run(() => setEstimateReadyAction(estimateId, !ready))}
            >
              {ready ? "Back to draft" : "Mark ready"}
            </Button>
            {ready && (
              <Button
                variant="primary"
                disabled={action.pending || dirty}
                title={dirty ? "Save your changes first" : undefined}
                onClick={() => action.run(() => createQuotationAction(estimateId), ({ id }) => router.push(`/quotations/${id}`))}
              >
                Create quotation
              </Button>
            )}
            <Button
              disabled={action.pending}
              onClick={() => action.run(() => duplicateEstimateAction(estimateId), ({ id }) => router.push(`/estimates/${id}`))}
            >
              Duplicate
            </Button>
            {!confirmDelete ? (
              <Button variant="ghost" onClick={() => setConfirmDelete(true)}>Delete</Button>
            ) : (
              <>
                <Button variant="danger" disabled={action.pending} onClick={() => action.run(() => deleteEstimateAction(estimateId), () => router.push("/estimates"))}>
                  Confirm delete
                </Button>
                <Button variant="ghost" onClick={() => setConfirmDelete(false)}>Cancel</Button>
              </>
            )}
            <SaveStatus state={action.state} retry={action.retry} />
          </>
        )}
      </div>
      {quotations.length > 0 && (
        <p className="mb-4 text-sm text-ink-muted">
          Quotations from this estimate:{" "}
          {quotations.map((q, i) => (
            <span key={q.id}>
              {i > 0 && ", "}
              <Link className="font-semibold underline" href={`/quotations/${q.id}`}>{q.number ?? "Draft"}</Link> ({q.status})
            </span>
          ))}
        </p>
      )}
      {needsRates && (
        <div className="mb-4">
          <Banner tone="caution" action={<a href="/settings#rates" className="text-sm font-semibold underline">Open settings</a>}>
            No {draft.currency} hourly rates are set yet. Add them in Settings before saving an estimate in {draft.currency}.
          </Banner>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4">
          {/* 1. project, currency, method */}
          <Card>
            <SectionTitle title="1. Project and method" />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Project" htmlFor="e-project" error={issueFor("projectId", meta.projectId)}>
                <Select id="e-project" value={meta.projectId} invalid={!!issueFor("projectId", meta.projectId)} onChange={(e) => editMeta({ projectId: e.target.value })}>
                  <option value="">Choose a project…</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.label}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Estimate title" htmlFor="e-title" error={save.error("title")}>
                <TextInput id="e-title" value={meta.title} invalid={!!save.error("title")} onChange={(e) => editMeta({ title: e.target.value })} placeholder="e.g. Phase 1 build" />
              </Field>
              <div>
                <span className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-ink-muted">Currency</span>
                <Segmented label="Currency" value={draft.currency} onChange={changeCurrency} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
              </div>
              <div>
                <span className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-ink-muted">Pricing method</span>
                <Segmented
                  label="Pricing method"
                  value={draft.method}
                  onChange={requestSwitch}
                  options={[{ value: "time", label: "Time based" }, { value: "fixed", label: "Fixed price" }]}
                />
              </div>
            </div>
            {pendingSwitch && (
              <div role="alertdialog" aria-label="Confirm method switch" className="mt-3 rounded border border-caution/30 bg-caution-soft p-3 text-sm text-caution-ink">
                <p className="font-semibold">Switching to {pendingSwitch === "fixed" ? "fixed price" : "time based"} removes these lines:</p>
                <ul className="mt-1 list-disc pl-5">
                  {linesDroppedBySwitch(draft, pendingSwitch).map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
                <p className="mt-1 text-xs">Expenses, urgency, contingency and discount are kept.</p>
                <div className="mt-2 flex gap-2">
                  <Button variant="primary" onClick={() => applySwitch(pendingSwitch)}>Switch and remove them</Button>
                  <Button onClick={() => setPendingSwitch(null)}>Keep current method</Button>
                </div>
              </div>
            )}
            {draft.method === "fixed" ? (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field label="Project complexity" htmlFor="e-cx" error={issueFor("complexity", draft.complexity ?? "")} hint={`Multiplier from Settings. Applies to deliverable prices only.`}>
                  <Select id="e-cx" value={draft.complexity ?? ""} onChange={(e) => edit((d) => ({ ...d, complexity: (e.target.value || null) as Complexity | null }))}>
                    <option value="">Choose…</option>
                    {COMPLEXITIES.map((c) => (
                      <option key={c} value={c}>{c[0]!.toUpperCase() + c.slice(1)} (×{ps.multipliers[c]})</option>
                    ))}
                  </Select>
                </Field>
              </div>
            ) : (
              <p className="mt-3 text-xs text-ink-muted">
                Complexity does not change time based pricing: your hour estimates already carry it, and your hourly rate already contains your profit.
              </p>
            )}
          </Card>

          {/* 2. labour or deliverables */}
          {draft.method === "time" ? (
            <Card>
              <SectionTitle title="2. Labour" hint="Hours × the category rate from Settings. Changing a rate flags it as an override." right={<Button onClick={addLabour}>Add labour line</Button>} />
              <div className="space-y-3">
                {draft.labour.length === 0 && <p className="text-sm text-ink-muted">No labour lines yet.</p>}
                {draft.labour.map((l, i) => {
                  const over = isOverride(l, ctx);
                  const def = ps.defaultRatesCents[l.category];
                  const amount = lineAmount(l.id)?.amountCents;
                  return (
                    <div key={l.id} className="grid gap-2 rounded-lg border border-line bg-recessed/40 p-3 sm:grid-cols-[2fr_1.3fr_.8fr_1.1fr_1fr] sm:items-start">
                      <Field label="Task" htmlFor={`l-task-${l.id}`} error={issueFor(`labour.${i}.task`, l.task)} className="col-span-full sm:col-span-1">
                        <TextInput id={`l-task-${l.id}`} value={l.task} invalid={!!issueFor(`labour.${i}.task`, l.task)} onChange={(e) => edit((d) => ({ ...d, labour: patchList(d.labour, l.id, { task: e.target.value }) }))} />
                      </Field>
                      <Field label="Category" htmlFor={`l-cat-${l.id}`}>
                        <Select id={`l-cat-${l.id}`} value={l.category} onChange={(e) => changeCategory(l, e.target.value as LabourCategory)}>
                          {LABOUR_CATEGORIES.map((c) => (
                            <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
                          ))}
                        </Select>
                      </Field>
                      <Field label="Hours" htmlFor={`l-hrs-${l.id}`} error={issueFor(`labour.${i}.hours`, l.hours)}>
                        <NumberInput id={`l-hrs-${l.id}`} value={l.hours} invalid={!!issueFor(`labour.${i}.hours`, l.hours)} onChange={(e) => edit((d) => ({ ...d, labour: patchList(d.labour, l.id, { hours: e.target.value }) }))} />
                      </Field>
                      <Field label="Rate / hour" htmlFor={`l-rate-${l.id}`} error={issueFor(`labour.${i}.rate`, l.rate)}>
                        <NumberInput id={`l-rate-${l.id}`} prefix={sym} value={l.rate} invalid={!!issueFor(`labour.${i}.rate`, l.rate)} onChange={(e) => edit((d) => ({ ...d, labour: patchList(d.labour, l.id, { rate: e.target.value }) }))} />
                        {over && (
                          <div className="mt-1">
                            <Badge tone="caution">{def === undefined ? "No default rate" : `Override · default ${fmt(def)}`}</Badge>
                          </div>
                        )}
                      </Field>
                      <div>
                        <span className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-ink-muted">Amount</span>
                        <div className="money py-1.5 text-right text-sm font-semibold">{amount === undefined ? "—" : fmt(amount)}</div>
                      </div>
                      <div className="col-span-full">
                        <LineActions
                          i={i}
                          count={draft.labour.length}
                          label={`labour line ${i + 1}`}
                          onUp={() => edit((d) => ({ ...d, labour: move(d.labour, i, -1) }))}
                          onDown={() => edit((d) => ({ ...d, labour: move(d.labour, i, 1) }))}
                          onDuplicate={() => edit((d) => ({ ...d, labour: [...d.labour.slice(0, i + 1), { ...l, id: uid() }, ...d.labour.slice(i + 1)] }))}
                          onRemove={() => edit((d) => ({ ...d, labour: d.labour.filter((x) => x.id !== l.id) }))}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          ) : (
            <Card>
              <SectionTitle title="2. Deliverables" hint="You set each price. Estimated hours are internal: they never appear on a quotation and only feed the effective hourly rate check." right={<Button onClick={addDeliverable}>Add deliverable</Button>} />
              <div className="space-y-3">
                {draft.deliverables.length === 0 && <p className="text-sm text-ink-muted">No deliverables yet.</p>}
                {draft.deliverables.map((x, i) => {
                  const line = lineAmount(x.id);
                  return (
                    <div key={x.id} className="grid gap-2 rounded-lg border border-line bg-recessed/40 p-3 sm:grid-cols-[2fr_1fr_1fr_1fr] sm:items-start">
                      <Field label="Deliverable" htmlFor={`d-name-${x.id}`} error={issueFor(`deliverables.${i}.name`, x.name)} className="col-span-full sm:col-span-1">
                        <TextInput id={`d-name-${x.id}`} value={x.name} invalid={!!issueFor(`deliverables.${i}.name`, x.name)} onChange={(e) => edit((d) => ({ ...d, deliverables: patchList(d.deliverables, x.id, { name: e.target.value }) }))} />
                      </Field>
                      <Field label="Price" htmlFor={`d-price-${x.id}`} error={issueFor(`deliverables.${i}.price`, x.price)}>
                        <NumberInput id={`d-price-${x.id}`} prefix={sym} value={x.price} invalid={!!issueFor(`deliverables.${i}.price`, x.price)} onChange={(e) => edit((d) => ({ ...d, deliverables: patchList(d.deliverables, x.id, { price: e.target.value }) }))} />
                      </Field>
                      <Field label="Est. hours (internal)" htmlFor={`d-hrs-${x.id}`} error={issueFor(`deliverables.${i}.estimatedHours`, x.estimatedHours)}>
                        <NumberInput id={`d-hrs-${x.id}`} value={x.estimatedHours} invalid={!!issueFor(`deliverables.${i}.estimatedHours`, x.estimatedHours)} onChange={(e) => edit((d) => ({ ...d, deliverables: patchList(d.deliverables, x.id, { estimatedHours: e.target.value }) }))} />
                      </Field>
                      <div>
                        <span className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-ink-muted">After complexity</span>
                        <div className="money py-1.5 text-right text-sm font-semibold">{line?.adjustedCents === undefined ? "—" : fmt(line.adjustedCents)}</div>
                      </div>
                      <div className="col-span-full">
                        <LineActions
                          i={i}
                          count={draft.deliverables.length}
                          label={`deliverable ${i + 1}`}
                          onUp={() => edit((d) => ({ ...d, deliverables: move(d.deliverables, i, -1) }))}
                          onDown={() => edit((d) => ({ ...d, deliverables: move(d.deliverables, i, 1) }))}
                          onDuplicate={() => edit((d) => ({ ...d, deliverables: [...d.deliverables.slice(0, i + 1), { ...x, id: uid() } as DraftDeliverable, ...d.deliverables.slice(i + 1)] }))}
                          onRemove={() => edit((d) => ({ ...d, deliverables: d.deliverables.filter((y) => y.id !== x.id) }))}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          {/* 3. expenses */}
          <Card>
            <SectionTitle title="3. Expenses" hint="Cost plus your markup is what the client pays. Cost and markup stay internal. Recurring lines are listed separately and never added to the project total." right={<Button onClick={addExpense}>Add expense</Button>} />
            <div className="space-y-3">
              {draft.expenses.length === 0 && <p className="text-sm text-ink-muted">No expenses.</p>}
              {draft.expenses.map((x, i) => (
                <div key={x.id} className="grid gap-2 rounded-lg border border-line bg-recessed/40 p-3 sm:grid-cols-[2fr_1fr_.8fr_1fr] sm:items-start">
                  <Field label="Description" htmlFor={`x-d-${x.id}`} error={issueFor(`expenses.${i}.description`, x.description)} className="col-span-full sm:col-span-1">
                    <TextInput id={`x-d-${x.id}`} value={x.description} invalid={!!issueFor(`expenses.${i}.description`, x.description)} onChange={(e) => edit((d) => ({ ...d, expenses: patchList(d.expenses, x.id, { description: e.target.value }) }))} />
                  </Field>
                  <Field label="Your cost" htmlFor={`x-c-${x.id}`} error={issueFor(`expenses.${i}.cost`, x.cost)}>
                    <NumberInput id={`x-c-${x.id}`} prefix={sym} value={x.cost} invalid={!!issueFor(`expenses.${i}.cost`, x.cost)} onChange={(e) => edit((d) => ({ ...d, expenses: patchList(d.expenses, x.id, { cost: e.target.value }) }))} />
                  </Field>
                  <Field label="Markup" htmlFor={`x-m-${x.id}`} error={issueFor(`expenses.${i}.markupPct`, x.markupPct)}>
                    <NumberInput id={`x-m-${x.id}`} suffix="%" value={x.markupPct} invalid={!!issueFor(`expenses.${i}.markupPct`, x.markupPct)} onChange={(e) => edit((d) => ({ ...d, expenses: patchList(d.expenses, x.id, { markupPct: e.target.value }) }))} />
                  </Field>
                  <div>
                    <span className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-ink-muted">Billed{x.recurring ? ` / ${x.period === "annual" ? "year" : "month"}` : ""}</span>
                    <div className="money py-1.5 text-right text-sm font-semibold">{billedById.has(x.id) ? fmt(billedById.get(x.id)!) : "—"}</div>
                  </div>
                  <div className="col-span-full flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-3 text-sm">
                      <Segmented
                        label="Once off or recurring"
                        value={x.recurring ? "recurring" : "once"}
                        onChange={(v) => edit((d) => ({ ...d, expenses: patchList(d.expenses, x.id, { recurring: v === "recurring" } as Partial<DraftExpense>) }))}
                        options={[{ value: "once", label: "Once off" }, { value: "recurring", label: "Recurring" }]}
                      />
                      {x.recurring && (
                        <Select aria-label="Recurring period" className="w-32" value={x.period} onChange={(e) => edit((d) => ({ ...d, expenses: patchList(d.expenses, x.id, { period: e.target.value as "monthly" | "annual" }) }))}>
                          <option value="monthly">Monthly</option>
                          <option value="annual">Annual</option>
                        </Select>
                      )}
                    </div>
                    <LineActions
                      i={i}
                      count={draft.expenses.length}
                      label={`expense ${i + 1}`}
                      onUp={() => edit((d) => ({ ...d, expenses: move(d.expenses, i, -1) }))}
                      onDown={() => edit((d) => ({ ...d, expenses: move(d.expenses, i, 1) }))}
                      onDuplicate={() => edit((d) => ({ ...d, expenses: [...d.expenses.slice(0, i + 1), { ...x, id: uid() }, ...d.expenses.slice(i + 1)] }))}
                      onRemove={() => edit((d) => ({ ...d, expenses: d.expenses.filter((y) => y.id !== x.id) }))}
                    />
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* 4. adjustments */}
          <Card>
            <SectionTitle title="4. Adjustments" hint="Urgency and contingency are each a percentage of the base (labour, or deliverables after complexity). Neither is charged on expenses or on the other." />
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="mb-1 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-ink-muted">
                  <input type="checkbox" checked={draft.urgent} onChange={(e) => edit((d) => ({ ...d, urgent: e.target.checked }))} />
                  Urgent delivery
                </label>
                <NumberInput aria-label="Urgency percent" suffix="%" disabled={!draft.urgent} value={draft.urgencyPct} invalid={!!issueFor("urgencyPct", draft.urgencyPct)} onChange={(e) => edit((d) => ({ ...d, urgencyPct: e.target.value }))} />
                {issueFor("urgencyPct", draft.urgencyPct) && <p role="alert" className="mt-1 text-xs font-medium text-cost-ink">{issueFor("urgencyPct", draft.urgencyPct)}</p>}
              </div>
              <Field label="Contingency" htmlFor="e-cont" error={issueFor("contingencyPct", draft.contingencyPct)}>
                <NumberInput id="e-cont" suffix="%" value={draft.contingencyPct} invalid={!!issueFor("contingencyPct", draft.contingencyPct)} onChange={(e) => edit((d) => ({ ...d, contingencyPct: e.target.value }))} />
              </Field>
              <div>
                <span className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-ink-muted">Discount</span>
                <div className="flex gap-2">
                  <Select aria-label="Discount type" className="w-28" value={draft.discount.type} onChange={(e) => edit((d) => ({ ...d, discount: { type: e.target.value as "none" | "percent" | "fixed", value: "" } }))}>
                    <option value="none">None</option>
                    <option value="percent">Percent</option>
                    <option value="fixed">Amount</option>
                  </Select>
                  {draft.discount.type !== "none" && (
                    <NumberInput
                      aria-label="Discount value"
                      prefix={draft.discount.type === "fixed" ? sym : undefined}
                      suffix={draft.discount.type === "percent" ? "%" : undefined}
                      value={draft.discount.value}
                      invalid={!!issueFor("discount.value", draft.discount.value)}
                      onChange={(e) => edit((d) => ({ ...d, discount: { ...d.discount, value: e.target.value } }))}
                    />
                  )}
                </div>
                {issueFor("discount.value", draft.discount.value) && <p role="alert" className="mt-1 text-xs font-medium text-cost-ink">{issueFor("discount.value", draft.discount.value)}</p>}
              </div>
            </div>
            <Field label="Internal notes" htmlFor="e-notes" className="mt-4" hint="Never shown to the client.">
              <Textarea id="e-notes" value={meta.internalNotes} onChange={(e) => editMeta({ internalNotes: e.target.value })} />
            </Field>
          </Card>
        </div>

        {/* summary panel: sticky on desktop, a bottom bar that expands on mobile */}
        <aside aria-label="Estimate summary" className="fixed inset-x-0 bottom-0 z-20 lg:sticky lg:top-4 lg:z-auto lg:self-start">
          <div className="max-h-[75vh] overflow-y-auto rounded-t-xl border border-line bg-surface p-4 shadow-dock lg:max-h-none lg:overflow-visible lg:rounded-lg lg:shadow-raised">
            <button type="button" className="flex w-full items-center justify-between gap-3 text-left lg:pointer-events-none" aria-expanded={panelOpen} onClick={() => setPanelOpen(!panelOpen)}>
              <span>
                <span className="block text-[11px] font-bold uppercase tracking-wider text-ink-muted">Estimated price · {draft.currency}</span>
                <span className={`money block text-2xl font-semibold ${stale ? "opacity-50" : ""}`} data-testid="summary-total">
                  {result ? fmt(result.breakdown.totalCents) : fmt(0)}
                </span>
              </span>
              <span className="text-xs font-semibold text-primary lg:hidden">{panelOpen ? "Hide" : "Details"}</span>
            </button>

            <div className={`${panelOpen ? "block" : "hidden"} lg:block`}>
              {stale && (
                <div role="alert" className="mt-3 rounded border border-cost/30 bg-cost-soft p-2 text-xs text-cost-ink">
                  <p className="font-semibold">Fix {issueCount} {issueCount === 1 ? "problem" : "problems"} to update the price (showing the last valid total):</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4">
                    {(!evaluation.ok ? evaluation.issues : []).slice(0, 6).map((i, k) => (
                      <li key={k}>{describePath(i.path)}: {i.message}</li>
                    ))}
                  </ul>
                </div>
              )}
              {!result && !stale && <p className="mt-3 text-xs text-ink-muted">Add lines to see a price.</p>}

              <div className="mt-3">
                <Segmented label="Summary view" value={view} onChange={setView} options={[{ value: "client", label: "Client facing" }, { value: "internal", label: "Internal" }]} />
              </div>

              {result && view === "client" && (
                <dl className={`mt-3 grid grid-cols-[1fr_auto] gap-y-1.5 text-sm ${stale ? "opacity-60" : ""}`}>
                  <dt>{draft.method === "time" ? "Labour" : "Deliverables"}{draft.method === "fixed" && draft.complexity ? ` (×${ps.multipliers[draft.complexity]})` : ""}<Explain entry={explain(draft.method === "time" ? "labour" : "deliverables")} /></dt>
                  <dd className="money text-right">{fmt(result.breakdown.baseCents)}</dd>
                  {draft.urgent && (<><dt>Urgency surcharge<Explain entry={explain("urgency")} /></dt><dd className="money text-right">{fmt(result.breakdown.urgencyCents)}</dd></>)}
                  {result.breakdown.contingencyCents > 0 && (<><dt>Contingency<Explain entry={explain("contingency")} /></dt><dd className="money text-right">{fmt(result.breakdown.contingencyCents)}</dd></>)}
                  {result.expenseLines.length > 0 && (<><dt>Expenses<Explain entry={explain("expenses")} /></dt><dd className="money text-right">{fmt(result.breakdown.expensesBilledCents)}</dd></>)}
                  <dt className="border-t border-line pt-1.5 font-semibold">Subtotal<Explain entry={explain("subtotal")} /></dt>
                  <dd className="money border-t border-line pt-1.5 text-right font-semibold">{fmt(result.breakdown.subtotalCents)}</dd>
                  {result.breakdown.discountCents > 0 && (<><dt>Discount<Explain entry={explain("discount")} /></dt><dd className="money text-right">−{fmt(result.breakdown.discountCents)}</dd></>)}
                  <dt className="border-t border-line pt-1.5 font-semibold">Total<Explain entry={explain("total")} /></dt>
                  <dd className="money border-t border-line pt-1.5 text-right font-semibold">{fmt(result.breakdown.totalCents)}</dd>
                </dl>
              )}

              {result && view === "internal" && (
                <div className={`mt-3 space-y-2 text-sm ${stale ? "opacity-60" : ""}`}>
                  <p className="text-xs text-ink-muted">Internal only. None of this reaches a quotation.</p>
                  <dl className="grid grid-cols-[1fr_auto] gap-y-1.5">
                    <dt>Effective hourly rate<Explain entry={explain("effectiveRate")} /></dt>
                    <dd className="money text-right font-semibold">{result.internal.effectiveHourlyRateCents === null ? "—" : `${fmt(result.internal.effectiveHourlyRateCents)}/h`}</dd>
                    <dt>Estimated hours</dt>
                    <dd className="money text-right">{result.internal.estimatedHours}</dd>
                    <dt>Contingency amount</dt>
                    <dd className="money text-right text-caution-ink">{fmt(result.internal.contingencyCents)}</dd>
                    <dt>Expense cost</dt>
                    <dd className="money text-right">{fmt(result.internal.expenseCostCents)}</dd>
                    <dt>Markup earned</dt>
                    <dd className="money text-right text-profit-ink">{fmt(result.internal.markupEarnedCents)}</dd>
                  </dl>
                  {result.internal.belowMinimumRate && (
                    <Banner tone="cost">
                      Below your minimum of {fmt(result.internal.minimumHourlyRateCents)}/h. This price underpays you.
                    </Banner>
                  )}
                  {!result.internal.belowMinimumRate && result.internal.minimumHourlyRateCents === 0 && (
                    <p className="text-xs text-ink-muted">Set a minimum effective hourly rate in Settings to get a warning when a price underpays you.</p>
                  )}
                </div>
              )}

              {result && (result.recurring.monthlyCents > 0 || result.recurring.annualCents > 0) && (
                <div className="mt-3 rounded border border-line bg-recessed p-2 text-xs">
                  <div className="font-semibold">Recurring (not in the total)</div>
                  {result.recurring.monthlyCents > 0 && <div className="money flex justify-between"><span>Monthly</span><span>{fmt(result.recurring.monthlyCents)}</span></div>}
                  {result.recurring.annualCents > 0 && <div className="money flex justify-between"><span>Annual</span><span>{fmt(result.recurring.annualCents)}</span></div>}
                </div>
              )}

              {result && result.internal.belowMinimumRate && view === "client" && (
                <div className="mt-3">
                  <Banner tone="cost">Below your minimum hourly rate. Switch to Internal to see the figures.</Banner>
                </div>
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
