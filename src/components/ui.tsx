import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cx("rounded-lg border border-line bg-surface p-4 md:p-5", className)}>{children}</section>;
}

export function SectionTitle({ title, hint, right }: { title: string; hint?: string; right?: ReactNode }) {
  return (
    <div className="mb-3 flex items-start justify-between gap-3">
      <div>
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        {hint && <p className="mt-0.5 text-xs text-ink-muted">{hint}</p>}
      </div>
      {right}
    </div>
  );
}

type Variant = "primary" | "secondary" | "danger" | "ghost";
const VARIANTS: Record<Variant, string> = {
  primary: "bg-primary text-white hover:bg-primary-hover dark:text-canvas",
  secondary: "border border-line bg-surface text-ink hover:bg-recessed",
  danger: "border border-cost/40 bg-cost-soft text-cost-ink hover:brightness-95",
  ghost: "text-ink-muted hover:bg-recessed hover:text-ink",
};

export function Button({
  variant = "secondary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      {...props}
      className={cx(
        "inline-flex min-h-9 items-center justify-center gap-1.5 rounded px-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50",
        VARIANTS[variant],
        className,
      )}
    />
  );
}

export function LinkButton({ href, children, variant = "secondary" }: { href: string; children: ReactNode; variant?: Variant }) {
  return (
    <a
      href={href}
      className={cx("inline-flex min-h-9 items-center justify-center rounded px-3 text-sm font-semibold transition", VARIANTS[variant])}
    >
      {children}
    </a>
  );
}

const inputBase =
  "w-full rounded border bg-surface px-2.5 py-1.5 text-sm placeholder:text-ink-muted/70 disabled:opacity-60 focus:border-primary";

export function Field({
  label,
  error,
  hint,
  children,
  htmlFor,
  className,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
  htmlFor?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-ink-muted">
        {label}
      </label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-ink-muted">{hint}</p>}
      {error && (
        <p role="alert" className="mt-1 text-xs font-medium text-cost-ink">
          {error}
        </p>
      )}
    </div>
  );
}

export function TextInput({ invalid, className, ...props }: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return <input {...props} aria-invalid={invalid || undefined} className={cx(inputBase, invalid ? "border-cost" : "border-line", className)} />;
}

/** Money and number inputs: monospaced, right aligned, with an optional prefix such as "R". */
export function NumberInput({
  invalid,
  prefix,
  suffix,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean; prefix?: string; suffix?: string }) {
  return (
    <div className="relative">
      {prefix && <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-ink-muted">{prefix}</span>}
      <input
        inputMode="decimal"
        {...props}
        aria-invalid={invalid || undefined}
        className={cx(inputBase, "money text-right", prefix && "pl-9", suffix && "pr-7", invalid ? "border-cost" : "border-line", className)}
      />
      {suffix && <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-ink-muted">{suffix}</span>}
    </div>
  );
}

export function Select({ invalid, className, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) {
  return <select {...props} aria-invalid={invalid || undefined} className={cx(inputBase, invalid ? "border-cost" : "border-line", className)} />;
}

export function Textarea({ invalid, className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return <textarea {...props} aria-invalid={invalid || undefined} className={cx(inputBase, "min-h-24", invalid ? "border-cost" : "border-line", className)} />;
}

type Tone = "neutral" | "profit" | "caution" | "cost" | "primary";
const TONES: Record<Tone, string> = {
  neutral: "border-line bg-recessed text-ink-muted",
  profit: "border-profit/30 bg-profit-soft text-profit-ink",
  caution: "border-caution/30 bg-caution-soft text-caution-ink",
  cost: "border-cost/30 bg-cost-soft text-cost-ink",
  primary: "border-primary/30 bg-primary-soft text-primary-ink",
};
export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={cx("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold", TONES[tone])}>
      {children}
    </span>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-md border border-line bg-recessed p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={cx(
            "min-h-8 rounded px-3 text-sm font-semibold transition",
            o.value === value ? "bg-surface text-ink shadow-sm" : "text-ink-muted hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-line bg-surface px-6 py-10 text-center">
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="mx-auto mt-1 max-w-md text-sm text-ink-muted">{body}</p>
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function Banner({
  tone = "caution",
  children,
  action,
}: {
  tone?: "caution" | "cost" | "profit" | "primary";
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div role={tone === "cost" ? "alert" : "status"} className={cx("flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm", TONES[tone])}>
      <div>{children}</div>
      {action}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("skeleton", className)} aria-hidden="true" />;
}

export { cx };
