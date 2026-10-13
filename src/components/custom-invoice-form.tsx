"use client";

import { useState } from "react";
import type { ActionResult } from "@/server/errors";
import { Button, Field, NumberInput, TextInput } from "./ui";
import { SaveStatus, useSave } from "./use-save";

export interface CustomForm {
  reason: string;
  lines: { description: string; amount: string }[];
}

/** A custom invoice: a stated reason and its own lines. It still counts against the accepted total. */
export function CustomInvoiceForm({
  initial,
  currencySymbol,
  submitLabel,
  onSubmit,
  onDone,
}: {
  initial?: CustomForm;
  currencySymbol: string;
  submitLabel: string;
  onSubmit: (f: CustomForm) => Promise<ActionResult<unknown>>;
  onDone?: () => void;
}) {
  const { state, run, retry, pending, error } = useSave();
  const [f, setF] = useState<CustomForm>(initial ?? { reason: "", lines: [{ description: "", amount: "" }] });
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => onSubmit(f), () => onDone?.());
      }}
    >
      <Field label="Reason for a custom invoice" htmlFor="ci-reason" error={error("reason")} hint="For example: extra scope agreed by email.">
        <TextInput id="ci-reason" value={f.reason} invalid={!!error("reason")} onChange={(e) => setF({ ...f, reason: e.target.value })} />
      </Field>
      <div className="space-y-2">
        {f.lines.map((l, i) => (
          <div key={i} className="grid grid-cols-[1fr_9rem_auto] items-start gap-2">
            <Field label={i === 0 ? "Description" : ""} error={error(`lines.${i}.description`)}>
              <TextInput aria-label={`Line ${i + 1} description`} value={l.description} onChange={(e) => setF({ ...f, lines: f.lines.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)) })} />
            </Field>
            <Field label={i === 0 ? "Amount" : ""} error={error(`lines.${i}.amount`)}>
              <NumberInput aria-label={`Line ${i + 1} amount`} prefix={currencySymbol} invalid={!!error(`lines.${i}.amount`)} value={l.amount} onChange={(e) => setF({ ...f, lines: f.lines.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)) })} />
            </Field>
            <Button variant="ghost" className={i === 0 ? "mt-5" : ""} disabled={f.lines.length === 1} aria-label={`Remove line ${i + 1}`} onClick={() => setF({ ...f, lines: f.lines.filter((_, j) => j !== i) })}>
              Remove
            </Button>
          </div>
        ))}
      </div>
      {error("lines") && <p role="alert" className="text-xs font-medium text-cost-ink">{error("lines")}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => setF({ ...f, lines: [...f.lines, { description: "", amount: "" }] })}>Add line</Button>
        <Button type="submit" variant="primary" disabled={pending}>{submitLabel}</Button>
        <SaveStatus state={state} retry={retry} />
      </div>
    </form>
  );
}
