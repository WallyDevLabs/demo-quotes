"use client";

import { useState } from "react";
import {
  changePasswordAction,
  enrollConfirmAction,
  finishEnrollmentAction,
  loginAction,
  logoutAction,
  pinLoginAction,
  regenerateRecoveryCodesAction,
  removeDeviceAction,
  setPinAction,
  setupAction,
  signOutEverywhereAction,
} from "@/app/auth-actions";
import type { FieldIssue } from "@/domain/pricing/engine";
import type { ActionResult } from "@/server/errors";
import { Banner, Button, Card, Field, TextInput } from "./ui";

/** Runs an auth action, keeping a message and any field issues. Never stores a password in state longer than the form needs. */
function useAuth() {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [issues, setIssues] = useState<FieldIssue[]>([]);
  // Plain state, not useTransition: see use-save.tsx.
  const run = <T,>(fn: () => Promise<ActionResult<T>>, onOk: (data: T) => void) => {
    setMessage(null);
    setIssues([]);
    setPending(true);
    void (async () => {
      try {
        const r = await fn();
        if (r.ok) onOk(r.data);
        else {
          setMessage(r.message);
          setIssues(r.issues);
        }
      } catch {
        setMessage("Could not reach the server. Check your connection and try again.");
      } finally {
        setPending(false);
      }
    })();
  };
  return { pending, message, issues, run, error: (p: string) => issues.find((i) => i.path === p)?.message };
}

/** A hard navigation, so the new session cookie is used for every request that follows. */
const go = (to: string) => window.location.assign(to);

export function LoginForm({ next, pinEmail }: { next?: string; pinEmail?: string }) {
  // A browser that has already passed the authenticator code signs in with the PIN; anything else gets the full form.
  const [mode, setMode] = useState<"pin" | "full">(pinEmail ? "pin" : "full");
  const [notice, setNotice] = useState<string | null>(null);
  if (mode === "pin" && pinEmail) {
    return (
      <PinLogin
        email={pinEmail}
        next={next}
        onFull={(message) => {
          setNotice(message ?? null);
          setMode("full");
        }}
      />
    );
  }
  return <FullLogin next={next} notice={notice} onPin={pinEmail ? () => setMode("pin") : undefined} />;
}

const digitsOnly = (v: string) => v.replace(/\D/g, "").slice(0, 4);
const safeLocal = (next?: string) => (next && next.startsWith("/") && !next.startsWith("//") ? next : "/");

function PinLogin({ email, next, onFull }: { email: string; next?: string; onFull: (message?: string) => void }) {
  const a = useAuth();
  const [pin, setPin] = useState("");
  const submit = (value: string) =>
    a.run(
      () => pinLoginAction({ pin: value, next }),
      (d) => {
        if (d.redirectTo) go(d.redirectTo);
        else onFull(d.message);
      },
    );
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (pin.length === 4) submit(pin);
      }}
    >
      <p className="text-sm text-ink-muted">
        Welcome back, <span className="font-semibold text-ink">{email}</span>. Enter your PIN.
      </p>
      {a.message && <Banner tone="cost">{a.message}</Banner>}
      <Field label="4 digit PIN" htmlFor="login-pin">
        <TextInput
          id="login-pin"
          type="password"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={4}
          autoComplete="off"
          autoFocus
          required
          value={pin}
          className="money tracking-[0.5em]"
          onChange={(e) => {
            const v = digitsOnly(e.target.value);
            setPin(v);
            if (v.length === 4 && !a.pending) submit(v);
          }}
        />
      </Field>
      <Button type="submit" variant="primary" disabled={a.pending || pin.length !== 4} className="w-full">
        {a.pending ? "Signing in…" : "Sign in"}
      </Button>
      <button type="button" className="text-xs font-semibold text-accent underline" onClick={() => onFull()}>
        Use my password and authenticator code instead
      </button>
    </form>
  );
}

function FullLogin({ next, notice, onPin }: { next?: string; notice: string | null; onPin?: () => void }) {
  const a = useAuth();
  const [f, setF] = useState({ email: "", password: "", code: "" });
  const [trust, setTrust] = useState(true);
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        a.run(() => loginAction({ ...f, trust, next }), (d) => go(d.redirectTo));
      }}
    >
      {notice && <Banner tone="caution">{notice}</Banner>}
      {a.message && <Banner tone="cost">{a.message}</Banner>}
      <Field label="Email" htmlFor="login-email">
        <TextInput id="login-email" type="email" autoComplete="username" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
      </Field>
      <Field label="Password" htmlFor="login-password">
        <TextInput id="login-password" type="password" autoComplete="current-password" required value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
      </Field>
      <Field label="Authenticator code" htmlFor="login-code" hint="The 6 digit code from your authenticator app, or one of your recovery codes.">
        <TextInput id="login-code" inputMode="text" autoComplete="one-time-code" required value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} className="money" />
      </Field>
      <label className="flex items-start gap-2 text-sm">
        <input id="login-trust" type="checkbox" className="mt-1" checked={trust} onChange={(e) => setTrust(e.target.checked)} />
        <span>
          Trust this device
          <span className="block text-xs text-ink-muted">Next time, sign in here with just your PIN. Untick this on a shared or public computer.</span>
        </span>
      </label>
      <Button type="submit" variant="primary" disabled={a.pending} className="w-full">
        {a.pending ? "Signing in…" : "Sign in"}
      </Button>
      {onPin && (
        <button type="button" className="text-xs font-semibold text-accent underline" onClick={onPin}>
          Back to PIN sign in
        </button>
      )}
    </form>
  );
}

/** First PIN (right after sign-in or two-factor setup, which also trusts this browser) or a change from the Account page. */
export function PinForm({ next, firstTime }: { next?: string; firstTime?: boolean }) {
  const a = useAuth();
  const [f, setF] = useState({ pin: "", confirm: "", password: "" });
  const [done, setDone] = useState(false);
  return (
    <form
      className="grid gap-3 sm:max-w-sm"
      onSubmit={(e) => {
        e.preventDefault();
        setDone(false);
        a.run(
          () => setPinAction({ ...f, trust: firstTime }),
          () => {
            if (firstTime) go(safeLocal(next));
            else {
              setF({ pin: "", confirm: "", password: "" });
              setDone(true);
            }
          },
        );
      }}
    >
      {a.message && !a.issues.length && <Banner tone="cost">{a.message}</Banner>}
      {done && <Banner tone="profit">PIN saved.</Banner>}
      <Field label="New 4 digit PIN" htmlFor="pin-new" error={a.error("pin")}>
        <TextInput id="pin-new" type="password" inputMode="numeric" pattern="[0-9]*" maxLength={4} autoComplete="off" required invalid={!!a.error("pin")} value={f.pin} className="money tracking-[0.5em]" onChange={(e) => setF({ ...f, pin: digitsOnly(e.target.value) })} />
      </Field>
      <Field label="Repeat the PIN" htmlFor="pin-confirm" error={a.error("confirm")}>
        <TextInput id="pin-confirm" type="password" inputMode="numeric" pattern="[0-9]*" maxLength={4} autoComplete="off" required invalid={!!a.error("confirm")} value={f.confirm} className="money tracking-[0.5em]" onChange={(e) => setF({ ...f, confirm: digitsOnly(e.target.value) })} />
      </Field>
      <Field label="Your password" htmlFor="pin-password" error={a.error("password")} hint="Needed so nobody else can change your PIN.">
        <TextInput id="pin-password" type="password" autoComplete="current-password" required invalid={!!a.error("password")} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
      </Field>
      <Button type="submit" variant="primary" disabled={a.pending} className="w-full sm:w-auto">
        {a.pending ? "Saving…" : firstTime ? "Save PIN and trust this device" : "Save PIN"}
      </Button>
      {firstTime && (
        <a href={safeLocal(next)} className="text-xs font-semibold text-accent underline">
          Skip for now (you will need the authenticator code each time you sign in)
        </a>
      )}
    </form>
  );
}

export function DevicesCard({ hasPin, devices }: { hasPin: boolean; devices: { id: string; label: string; lastUsedAt: string; current: boolean }[] }) {
  const a = useAuth();
  const [changing, setChanging] = useState(!hasPin);
  return (
    <Card>
      <h2 className="text-base font-semibold">PIN and trusted devices</h2>
      <p className="mt-1 text-xs text-ink-muted">
        A trusted device signs in with your 4 digit PIN instead of the authenticator code. Five wrong PINs remove the device. Any other device needs your password and a code.
      </p>
      <div className="mt-3 space-y-3">
        {devices.length === 0 ? (
          <p className="text-sm text-ink-muted">No trusted devices. Tick &ldquo;Trust this device&rdquo; the next time you sign in with a code.</p>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {devices.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <span>
                  <span className="font-semibold">{d.label}</span>
                  {d.current && <span className="ml-2 text-xs font-semibold text-accent">this device</span>}
                  <span className="block text-xs text-ink-muted">Last used {new Date(d.lastUsedAt).toLocaleDateString("en-ZA", { timeZone: "Africa/Johannesburg" })}</span>
                </span>
                <Button variant="ghost" disabled={a.pending} onClick={() => a.run(() => removeDeviceAction(d.id), () => window.location.reload())}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
        {a.message && (
          <span role="alert" className="text-xs font-semibold text-cost-ink">
            {a.message}
          </span>
        )}
        {changing ? <PinForm /> : <Button onClick={() => setChanging(true)}>Change PIN…</Button>}
      </div>
    </Card>
  );
}

export function SetupForm({ tokenRequired }: { tokenRequired: boolean }) {
  const a = useAuth();
  const [f, setF] = useState({ email: "", password: "", confirm: "", setupToken: "" });
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        a.run(() => setupAction(f), (d) => go(d.redirectTo));
      }}
    >
      {a.message && !a.issues.length && <Banner tone="cost">{a.message}</Banner>}
      <Field label="Your email" htmlFor="setup-email" error={a.error("email")}>
        <TextInput id="setup-email" type="email" autoComplete="username" required invalid={!!a.error("email")} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
      </Field>
      <Field label="Password" htmlFor="setup-password" error={a.error("password")} hint="At least 12 characters. A long passphrase is best.">
        <TextInput id="setup-password" type="password" autoComplete="new-password" required invalid={!!a.error("password")} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
      </Field>
      <Field label="Repeat the password" htmlFor="setup-confirm" error={a.error("confirm")}>
        <TextInput id="setup-confirm" type="password" autoComplete="new-password" required invalid={!!a.error("confirm")} value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} />
      </Field>
      {tokenRequired && (
        <Field label="Setup token" htmlFor="setup-token" error={a.error("setupToken")} hint="The SETUP_TOKEN value you set on the server. It stops anyone else creating the account first.">
          <TextInput id="setup-token" type="password" autoComplete="off" required invalid={!!a.error("setupToken")} value={f.setupToken} onChange={(e) => setF({ ...f, setupToken: e.target.value })} />
        </Field>
      )}
      <Button type="submit" variant="primary" disabled={a.pending} className="w-full">
        {a.pending ? "Creating…" : "Create account and continue"}
      </Button>
    </form>
  );
}

export function FinishEnrollment() {
  const a = useAuth();
  return (
    <div className="space-y-3">
      {a.message && <Banner tone="cost">{a.message}</Banner>}
      <Button variant="primary" disabled={a.pending} className="w-full" onClick={() => a.run(() => finishEnrollmentAction(), () => go("/setup/pin"))}>
        {a.pending ? "Continuing…" : "Continue to the app"}
      </Button>
    </div>
  );
}

export function EnrollForm({ qr, secret }: { qr: string; secret: string }) {
  const a = useAuth();
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [saved, setSaved] = useState(false);

  if (codes) {
    return (
      <div className="space-y-4">
        <Banner tone="profit">Two-factor authentication is on.</Banner>
        <div>
          <h2 className="text-base font-semibold">Save your recovery codes</h2>
          <p className="mt-1 text-sm text-ink-muted">
            If you lose your phone, each of these codes lets you sign in once. They are shown <strong>only now</strong>. Store them somewhere safe, such as a password manager.
          </p>
          <ul className="money mt-3 grid grid-cols-2 gap-2 rounded-lg border border-line bg-recessed p-3 text-sm" aria-label="Recovery codes">
            {codes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <div className="mt-2">
            <Button onClick={() => navigator.clipboard?.writeText(codes.join("\n"))}>Copy codes</Button>
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
          I have saved my recovery codes
        </label>
        {saved && <FinishEnrollment />}
        {!saved && (
          <Button variant="primary" disabled className="w-full">
            Continue to the app
          </Button>
        )}
      </div>
    );
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        a.run(() => enrollConfirmAction(code), (d) => setCodes(d.recoveryCodes));
      }}
    >
      <ol className="list-decimal space-y-1 pl-5 text-sm">
        <li>Open an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Authy…).</li>
        <li>Scan this code, or enter the key by hand.</li>
        <li>Type the 6 digit code the app shows to confirm.</li>
      </ol>
      <div className="flex flex-wrap items-center gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={qr} alt="QR code for your authenticator app" width={176} height={176} className="rounded border border-line bg-white p-1" />
        <div className="min-w-0 text-sm">
          <div className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">Key for manual entry</div>
          <div className="money mt-1 break-all font-semibold">{secret.match(/.{1,4}/g)?.join(" ")}</div>
        </div>
      </div>
      {a.message && !a.issues.length && <Banner tone="cost">{a.message}</Banner>}
      <Field label="Code from the app" htmlFor="enroll-code" error={a.error("code")}>
        <TextInput id="enroll-code" inputMode="numeric" autoComplete="one-time-code" required value={code} invalid={!!a.error("code")} onChange={(e) => setCode(e.target.value)} className="money" />
      </Field>
      <Button type="submit" variant="primary" disabled={a.pending} className="w-full">
        {a.pending ? "Checking…" : "Confirm and turn on two-factor"}
      </Button>
    </form>
  );
}

export function SignOutButton() {
  const [pending, setPending] = useState(false);
  return (
    <Button
      variant="ghost"
      disabled={pending}
      onClick={() =>
        void (async () => {
          setPending(true);
          await logoutAction();
          // Nothing personal is cached by the service worker, but clear any old copies on this device too.
          try {
            const keys = await caches.keys();
            await Promise.all(keys.filter((k) => k.startsWith("pages-")).map((k) => caches.delete(k)));
          } catch {
            /* caches unavailable: nothing to clear */
          }
          go("/login");
        })()
      }
    >
      Sign out
    </Button>
  );
}

function RecoveryCodes() {
  const a = useAuth();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  return (
    <Card>
      <h2 className="text-base font-semibold">Recovery codes</h2>
      <p className="mt-1 text-xs text-ink-muted">Generating new codes replaces all the old ones. They are shown once, so save them straight away.</p>
      {codes ? (
        <div className="mt-3 space-y-2">
          <ul className="money grid grid-cols-2 gap-2 rounded-lg border border-line bg-recessed p-3 text-sm sm:max-w-sm" aria-label="New recovery codes">
            {codes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <Button onClick={() => navigator.clipboard?.writeText(codes.join("\n"))}>Copy codes</Button>
        </div>
      ) : !open ? (
        <div className="mt-3"><Button onClick={() => setOpen(true)}>Generate new recovery codes…</Button></div>
      ) : (
        <form
          className="mt-3 grid gap-2 sm:max-w-sm"
          onSubmit={(e) => {
            e.preventDefault();
            a.run(() => regenerateRecoveryCodesAction(password), (d) => { setPassword(""); setCodes(d.recoveryCodes); });
          }}
        >
          <Field label="Your password" htmlFor="rc-password" error={a.error("password")}>
            <TextInput id="rc-password" type="password" autoComplete="current-password" required invalid={!!a.error("password")} value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          {a.message && !a.issues.length && <Banner tone="cost">{a.message}</Banner>}
          <div className="flex gap-2">
            <Button type="submit" variant="danger" disabled={a.pending}>Replace my recovery codes</Button>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
          </div>
        </form>
      )}
    </Card>
  );
}

export function AccountPanel() {
  const pw = useAuth();
  const all = useAuth();
  const [f, setF] = useState({ current: "", next: "", confirm: "" });
  const [done, setDone] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      <Card>
        <h2 className="text-base font-semibold">Change password</h2>
        <p className="mt-1 text-xs text-ink-muted">Changing it signs out every other device.</p>
        <form
          className="mt-3 grid gap-3 sm:max-w-md"
          onSubmit={(e) => {
            e.preventDefault();
            setDone(null);
            pw.run(() => changePasswordAction(f), () => {
              setF({ current: "", next: "", confirm: "" });
              setDone("Password changed. Other devices have been signed out.");
            });
          }}
        >
          {pw.message && !pw.issues.length && <Banner tone="cost">{pw.message}</Banner>}
          {done && <Banner tone="profit">{done}</Banner>}
          <Field label="Current password" htmlFor="pw-current" error={pw.error("current")}>
            <TextInput id="pw-current" type="password" autoComplete="current-password" required invalid={!!pw.error("current")} value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} />
          </Field>
          <Field label="New password" htmlFor="pw-next" error={pw.error("next")} hint="At least 12 characters.">
            <TextInput id="pw-next" type="password" autoComplete="new-password" required invalid={!!pw.error("next")} value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} />
          </Field>
          <Field label="Repeat the new password" htmlFor="pw-confirm" error={pw.error("confirm")}>
            <TextInput id="pw-confirm" type="password" autoComplete="new-password" required invalid={!!pw.error("confirm")} value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} />
          </Field>
          <div><Button type="submit" variant="primary" disabled={pw.pending}>Change password</Button></div>
        </form>
      </Card>
      <RecoveryCodes />
      <Card>
        <h2 className="text-base font-semibold">Sign out everywhere</h2>
        <p className="mt-1 text-xs text-ink-muted">Ends every session on every device except this one. Use it if you lose a phone or laptop.</p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button variant="danger" disabled={all.pending} onClick={() => all.run(() => signOutEverywhereAction(), () => setDone("All other sessions have ended."))}>
            Sign out everywhere else
          </Button>
          {all.message && <span role="alert" className="text-xs font-semibold text-cost-ink">{all.message}</span>}
        </div>
      </Card>
    </div>
  );
}
