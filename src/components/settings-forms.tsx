"use client";

import { useEffect, useState } from "react";
import {
  removeLogoAction,
  saveBusinessAction,
  saveCurrencyAction,
  saveMultipliersAction,
  setNextNumberAction,
  uploadLogoAction,
} from "@/app/actions";
import { useRouter } from "next/navigation";
import { CURRENCIES, type Currency } from "@/domain/money";
import { formatDocumentNumber } from "@/domain/numbering";
import { COMPLEXITIES, LABOUR_CATEGORIES, type Complexity, type LabourCategory } from "@/domain/pricing/schema";
import type { BusinessForm, CurrencyForm } from "@/domain/settings-forms";
import type { SettingsDTO } from "@/server/settings";
import { SaveStatus, useSave } from "./use-save";
import { Badge, Button, Card, Field, NumberInput, Segmented, SectionTitle, TextInput, Textarea } from "./ui";

const CATEGORY_LABEL: Record<LabourCategory, string> = {
  development: "Development",
  design: "UI / UX design",
  testing: "Testing",
  consulting: "Consulting",
  project_management: "Project management",
};
const SYMBOL: Record<Currency, string> = { ZAR: "R", USD: "US$" };

function SectionFooter({ state, retry, pending, label = "Save" }: { state: ReturnType<typeof useSave>["state"]; retry: () => void; pending: boolean; label?: string }) {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
      <Button type="submit" variant="primary" disabled={pending}>
        {label}
      </Button>
      <SaveStatus state={state} retry={retry} />
    </div>
  );
}

function LogoSection({ logoFileId }: { logoFileId: string | null }) {
  const router = useRouter();
  const up = useSave();
  const [chosen, setChosen] = useState<File | null>(null);
  return (
    <Card>
      <SectionTitle title="Logo" hint="Printed on quotations and invoices. PNG or JPEG, up to 300 KB. A quotation that was already sent keeps the logo it was sent with." />
      <div className="flex flex-wrap items-center gap-4">
        {logoFileId ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/files/${logoFileId}`} alt="Current logo" className="h-16 w-16 rounded border border-line bg-white object-contain" />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded border border-dashed border-line text-xs text-ink-muted">No logo</div>
        )}
        <input
          type="file"
          accept="image/png,image/jpeg"
          aria-label="Choose a logo file"
          onChange={(e) => setChosen(e.target.files?.[0] ?? null)}
          className="text-sm"
        />
        <Button
          variant="primary"
          disabled={!chosen || up.pending}
          onClick={() => {
            const data = new FormData();
            data.set("logo", chosen!);
            up.run(() => uploadLogoAction(data));
          }}
        >
          Upload
        </Button>
        {logoFileId && (
          <Button variant="ghost" disabled={up.pending} onClick={() => up.run(() => removeLogoAction())}>
            Remove
          </Button>
        )}
        <SaveStatus state={up.state} retry={up.retry} />
      </div>
    </Card>
  );
}

function BusinessSection({ initial }: { initial: BusinessForm }) {
  const [f, setF] = useState(initial);
  const { state, run, retry, pending, error } = useSave();
  const set = <K extends keyof BusinessForm>(k: K, v: BusinessForm[K]) => setF((p) => ({ ...p, [k]: v }));
  const text = (k: keyof BusinessForm, label: string, extra?: { hint?: string; className?: string }) => (
    <Field label={label} error={error(k)} hint={extra?.hint} htmlFor={k} className={extra?.className}>
      <TextInput id={k} value={String(f[k])} invalid={!!error(k)} onChange={(e) => set(k, e.target.value as never)} />
    </Field>
  );
  return (
    <Card>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(() => saveBusinessAction(f));
        }}
      >
        <SectionTitle title="Business details" hint="Printed on every quotation and invoice. As a sole proprietor, your own name is your legal name." />
        <div className="grid gap-3 sm:grid-cols-2">
          {text("legalName", "Legal name")}
          {text("tradingName", "Trading name (optional)")}
          {text("registrationNumber", "Registration number (optional)")}
          {text("email", "Email")}
          {text("phone", "Phone")}
          <Field label="Address" error={error("address")} htmlFor="address" className="sm:col-span-2">
            <Textarea id="address" value={f.address} invalid={!!error("address")} onChange={(e) => set("address", e.target.value)} />
          </Field>
        </div>
        <SectionFooter state={state} retry={retry} pending={pending} />
      </form>
    </Card>
  );
}

function RatesSection({ initial }: { initial: Record<Currency, CurrencyForm> }) {
  const [currency, setCurrency] = useState<Currency>("ZAR");
  const [forms, setForms] = useState(initial);
  const f = forms[currency];
  const { state, run, retry, pending, error } = useSave();
  const sym = SYMBOL[currency];
  const patch = (p: Partial<CurrencyForm>) => setForms((all) => ({ ...all, [currency]: { ...all[currency], ...p } }));
  const bank = (k: keyof CurrencyForm["banking"], label: string, className?: string) => (
    <Field label={label} htmlFor={`bank-${k}`} className={className}>
      <TextInput id={`bank-${k}`} value={f.banking[k]} onChange={(e) => patch({ banking: { ...f.banking, [k]: e.target.value } })} />
    </Field>
  );
  return (
    <Card>
      <form
        id="rates"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => saveCurrencyAction(f));
        }}
      >
        <SectionTitle
          title="Rates and banking"
          hint="Each currency has its own rates and bank details. USD rates are your own, never converted from rand."
          right={<Segmented label="Currency" value={currency} onChange={setCurrency} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />}
        />
        <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-ink-muted">Hourly rate per category ({currency})</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {LABOUR_CATEGORIES.map((c) => (
            <Field key={c} label={CATEGORY_LABEL[c]} error={error(`rates.${c}`)} htmlFor={`rate-${c}`} hint="Leave blank if you do not offer this.">
              <NumberInput
                id={`rate-${c}`}
                prefix={sym}
                suffix="/h"
                placeholder="0.00"
                value={f.rates[c]}
                invalid={!!error(`rates.${c}`)}
                onChange={(e) => patch({ rates: { ...f.rates, [c]: e.target.value } })}
              />
            </Field>
          ))}
          <Field
            label="Minimum effective hourly rate"
            error={error("minimumHourlyRate")}
            htmlFor="minrate"
            hint="Estimates warn when the real rate falls below this. Internal only."
          >
            <NumberInput id="minrate" prefix={sym} suffix="/h" placeholder="0.00" value={f.minimumHourlyRate} invalid={!!error("minimumHourlyRate")} onChange={(e) => patch({ minimumHourlyRate: e.target.value })} />
          </Field>
        </div>

        <h3 className="mb-2 mt-6 text-[11px] font-bold uppercase tracking-wider text-ink-muted">Where {currency} is paid</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          {bank("bankName", "Bank name")}
          {bank("accountName", "Account name")}
          {bank("accountNumber", "Account number")}
          {bank("branchCode", "Branch code")}
          {currency === "USD" && bank("swiftCode", "SWIFT / BIC")}
          {bank("accountType", "Account type")}
          <Field label="Payment instructions" htmlFor="bank-instructions" className="sm:col-span-2" hint="Printed on invoices, for example your reference format.">
            <Textarea id="bank-instructions" value={f.banking.instructions} onChange={(e) => patch({ banking: { ...f.banking, instructions: e.target.value } })} />
          </Field>
        </div>
        <SectionFooter state={state} retry={retry} pending={pending} label={`Save ${currency} settings`} />
      </form>
    </Card>
  );
}

function DefaultsSection({ initial }: { initial: BusinessForm }) {
  const [f, setF] = useState(initial);
  const { state, run, retry, pending, error } = useSave();
  const set = <K extends keyof BusinessForm>(k: K, v: BusinessForm[K]) => setF((p) => ({ ...p, [k]: v }));
  const total = f.defaultMilestones.reduce((s, m) => s + (Number(m.percent) || 0), 0);
  return (
    <Card>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(() => saveBusinessAction(f));
        }}
      >
        <SectionTitle title="Defaults" hint="Starting values for new estimates, quotations and invoices. They are suggestions: review each one. Changing them never alters an existing document." />
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Hours per working day" error={error("hoursPerDay")} htmlFor="hpd" hint="Days are shown as hours divided by this.">
            <NumberInput id="hpd" value={f.hoursPerDay} invalid={!!error("hoursPerDay")} onChange={(e) => set("hoursPerDay", e.target.value)} />
          </Field>
          <Field label="Urgency surcharge" error={error("urgencyPct")} htmlFor="urg">
            <NumberInput id="urg" suffix="%" value={f.urgencyPct} invalid={!!error("urgencyPct")} onChange={(e) => set("urgencyPct", e.target.value)} />
          </Field>
          <Field label="Contingency" error={error("contingencyPct")} htmlFor="cont">
            <NumberInput id="cont" suffix="%" value={f.contingencyPct} invalid={!!error("contingencyPct")} onChange={(e) => set("contingencyPct", e.target.value)} />
          </Field>
          <Field label="Quotation validity (days)" error={error("quotationValidityDays")} htmlFor="qv">
            <NumberInput id="qv" value={f.quotationValidityDays} invalid={!!error("quotationValidityDays")} onChange={(e) => set("quotationValidityDays", e.target.value)} />
          </Field>
          <Field label="Payment terms (days)" error={error("paymentTermsDays")} htmlFor="pt">
            <NumberInput id="pt" value={f.paymentTermsDays} invalid={!!error("paymentTermsDays")} onChange={(e) => set("paymentTermsDays", e.target.value)} />
          </Field>
          <Field label="Upcoming-due window (days)" error={error("upcomingWindowDays")} htmlFor="uw">
            <NumberInput id="uw" value={f.upcomingWindowDays} invalid={!!error("upcomingWindowDays")} onChange={(e) => set("upcomingWindowDays", e.target.value)} />
          </Field>
        </div>

        <h3 className="mb-2 mt-6 text-[11px] font-bold uppercase tracking-wider text-ink-muted">Default payment milestones</h3>
        <div className="space-y-2">
          {f.defaultMilestones.map((m, i) => (
            <div key={i} className="grid grid-cols-[1fr_7rem_auto] items-start gap-2">
              <TextInput
                aria-label={`Milestone ${i + 1} name`}
                value={m.label}
                invalid={!!error(`defaultMilestones.${i}.label`)}
                onChange={(e) => set("defaultMilestones", f.defaultMilestones.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
              />
              <NumberInput
                aria-label={`Milestone ${i + 1} percent`}
                suffix="%"
                value={m.percent}
                invalid={!!error(`defaultMilestones.${i}.percent`)}
                onChange={(e) => set("defaultMilestones", f.defaultMilestones.map((x, j) => (j === i ? { ...x, percent: e.target.value } : x)))}
              />
              <Button variant="ghost" aria-label={`Remove milestone ${i + 1}`} onClick={() => set("defaultMilestones", f.defaultMilestones.filter((_, j) => j !== i))}>
                Remove
              </Button>
            </div>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <Button onClick={() => set("defaultMilestones", [...f.defaultMilestones, { label: "", percent: "" }])}>Add milestone</Button>
          {f.defaultMilestones.length > 0 && (
            <Badge tone={Math.round(total * 100) === 10000 ? "profit" : "caution"}>Total {total}% (must be 100)</Badge>
          )}
        </div>
        {error("defaultMilestones") && <p role="alert" className="mt-1 text-xs font-medium text-cost-ink">{error("defaultMilestones")}</p>}

        <div className="mt-6 grid gap-3">
          <Field label="Revision policy" htmlFor="rev">
            <Textarea id="rev" value={f.revisionPolicy} onChange={(e) => set("revisionPolicy", e.target.value)} />
          </Field>
          <Field label="Terms and conditions" htmlFor="tc">
            <Textarea id="tc" className="min-h-40" value={f.termsAndConditions} onChange={(e) => set("termsAndConditions", e.target.value)} />
          </Field>
        </div>
        <SectionFooter state={state} retry={retry} pending={pending} />
      </form>
    </Card>
  );
}

function MultipliersSection({ initial }: { initial: Record<Complexity, string> }) {
  const [m, setM] = useState(initial);
  const { state, run, retry, pending } = useSave();
  const [bad, setBad] = useState<Record<string, string>>({});
  return (
    <Card>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(() => saveMultipliersAction(m));
        }}
      >
        <SectionTitle title="Complexity multipliers" hint="Used by fixed price estimates only: each deliverable price is multiplied by the level's multiplier. All four start at 1.00 so nothing is assumed. Time based estimates ignore complexity." />
        <div className="grid gap-3 sm:grid-cols-4">
          {COMPLEXITIES.map((c) => (
            <Field key={c} label={c} htmlFor={`cx-${c}`} error={bad[c]}>
              <NumberInput
                id={`cx-${c}`}
                prefix="×"
                value={m[c]}
                invalid={!!bad[c]}
                onChange={(e) => {
                  setM({ ...m, [c]: e.target.value });
                  setBad({ ...bad, [c]: /^\d+(\.\d{1,2})?$/.test(e.target.value) && Number(e.target.value) > 0 ? "" : "Use a positive number with up to two decimals" });
                }}
              />
            </Field>
          ))}
        </div>
        <SectionFooter state={state} retry={retry} pending={pending} />
      </form>
    </Card>
  );
}

function NumberingSection({ initial, counters }: { initial: BusinessForm; counters: SettingsDTO["counters"] }) {
  const [f, setF] = useState(initial);
  const { state, run, retry, pending, error } = useSave();
  const [next, setNext] = useState({ q: String(counters.quotation), i: String(counters.invoice) });
  const counter = useSave();
  const preview = (pattern: string, seq: number) => {
    try {
      return formatDocumentNumber(pattern, seq, new Date().getFullYear(), { project: "ACME", client: "ACME" });
    } catch {
      return "Invalid pattern";
    }
  };
  return (
    <Card>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(() => saveBusinessAction(f));
        }}
      >
        <SectionTitle
          title="Numbering"
          hint="Numbers are given when a quotation is sent or an invoice is issued, in one gap-free sequence. Tokens: {YYYY} {YY} {SEQ:4} {PRJ} (project code) {CLIENT} (client code). Changing a pattern affects new documents only."
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Quotation pattern" error={error("quotationPattern")} htmlFor="qp" hint={`Next: ${preview(f.quotationPattern, counters.quotation)}`}>
            <TextInput id="qp" className="money" value={f.quotationPattern} invalid={!!error("quotationPattern")} onChange={(e) => setF({ ...f, quotationPattern: e.target.value })} />
          </Field>
          <Field label="Invoice pattern" error={error("invoicePattern")} htmlFor="ip" hint={`Next: ${preview(f.invoicePattern, counters.invoice)}`}>
            <TextInput id="ip" className="money" value={f.invoicePattern} invalid={!!error("invoicePattern")} onChange={(e) => setF({ ...f, invoicePattern: e.target.value })} />
          </Field>
        </div>
        <SectionFooter state={state} retry={retry} pending={pending} label="Save patterns" />
      </form>

      <div className="mt-6 border-t border-line pt-4">
        <h3 className="mb-1 text-[11px] font-bold uppercase tracking-wider text-ink-muted">Next number</h3>
        <p className="mb-3 text-xs text-ink-muted">A counter can be raised, for example to continue from your old invoices, but never lowered.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {([["QUOTATION", "q", "Next quotation number", counters.quotation], ["INVOICE", "i", "Next invoice number", counters.invoice]] as const).map(([kind, key, label, current]) => (
            <Field key={kind} label={label} htmlFor={`next-${key}`} hint={`Currently ${current}`}>
              <div className="flex gap-2">
                <NumberInput id={`next-${key}`} inputMode="numeric" value={next[key]} onChange={(e) => setNext({ ...next, [key]: e.target.value })} />
                <Button
                  disabled={counter.pending || !/^\d+$/.test(next[key])}
                  onClick={() => counter.run(() => setNextNumberAction(kind, Number(next[key])))}
                >
                  Raise
                </Button>
              </div>
            </Field>
          ))}
        </div>
        <div className="mt-2">
          <SaveStatus state={counter.state} retry={counter.retry} />
        </div>
      </div>
    </Card>
  );
}

function VatSection({ initial }: { initial: BusinessForm }) {
  const [f, setF] = useState(initial);
  const { state, run, retry, pending, error } = useSave();
  return (
    <Card>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(() => saveBusinessAction(f));
        }}
      >
        <SectionTitle
          title="VAT"
          hint="You are not VAT registered, so VAT is off and invisible: documents are titled Invoice and show no VAT line or number. This section sets up the early-warning monitor only."
          right={<Badge tone={f.vatRegistered ? "caution" : "neutral"}>{f.vatRegistered ? "VAT mode requested" : "VAT off"}</Badge>}
        />
        <label className="mb-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.vatRegistered} onChange={(e) => setF({ ...f, vatRegistered: e.target.checked })} />
          I am registered for VAT
        </label>
        {f.vatRegistered && (
          <p className="mb-3 rounded border border-caution/30 bg-caution-soft px-3 py-2 text-xs text-caution-ink">
            VAT documents are not built yet (phase two). Keep this off until they are, so your invoices stay correct.
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Registration threshold (ZAR)" error={error("vatThreshold")} htmlFor="vt" hint="Enter the figure you have verified with SARS. It is not assumed.">
            <NumberInput id="vt" prefix="R" value={f.vatThreshold} invalid={!!error("vatThreshold")} onChange={(e) => setF({ ...f, vatThreshold: e.target.value })} />
          </Field>
          <Field label="Warn at this share of the threshold" error={error("vatWarnSharePct")} htmlFor="vw">
            <NumberInput id="vw" suffix="%" value={f.vatWarnSharePct} invalid={!!error("vatWarnSharePct")} onChange={(e) => setF({ ...f, vatWarnSharePct: e.target.value })} />
          </Field>
        </div>
        <SectionFooter state={state} retry={retry} pending={pending} />
      </form>
    </Card>
  );
}

const SECTIONS = ["Business", "Rates", "Defaults", "Complexity", "Numbering", "VAT"] as const;

export function SettingsForms({ settings }: { settings: SettingsDTO }) {
  const [tab, setTab] = useState<(typeof SECTIONS)[number]>("Business");
  // The URL fragment only exists in the browser, so it is read after hydration (first run lands on #rates).
  useEffect(() => {
    const fromHash = () => {
      if (window.location.hash === "#rates") setTab("Rates");
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, []);
  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Settings sections" className="flex gap-1 overflow-x-auto rounded-md border border-line bg-recessed p-1">
        {SECTIONS.map((s) => (
          <button
            key={s}
            role="tab"
            aria-selected={tab === s}
            onClick={() => setTab(s)}
            className={`min-h-8 whitespace-nowrap rounded px-3 text-sm font-semibold ${tab === s ? "bg-surface text-ink shadow-sm" : "text-ink-muted hover:text-ink"}`}
          >
            {s}
          </button>
        ))}
      </div>
      {tab === "Business" && (
        <>
          <BusinessSection initial={settings.business} />
          <LogoSection logoFileId={settings.logoFileId} />
        </>
      )}
      {tab === "Rates" && <RatesSection initial={settings.currencies} />}
      {tab === "Defaults" && <DefaultsSection initial={settings.business} />}
      {tab === "Complexity" && <MultipliersSection initial={settings.multipliers} />}
      {tab === "Numbering" && <NumberingSection initial={settings.business} counters={settings.counters} />}
      {tab === "VAT" && <VatSection initial={settings.business} />}
    </div>
  );
}
