import Link from "next/link";
import { SignOutButton } from "./auth-forms";
import { ConnectionStatus } from "./connection-status";
import { NavLinks } from "./nav-links";
import { ThemeToggle } from "./theme";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen md:grid md:grid-cols-[250px_1fr]">
      <aside className="border-b border-line bg-surface md:sticky md:top-0 md:h-screen md:border-b-0 md:border-r">
        <div className="px-4 py-3 md:px-5 md:py-5">
          <div className="text-lg font-bold tracking-tight">CodeQuote</div>
          <div className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">Pricing and invoicing</div>
        </div>
        <NavLinks />
      </aside>
      <div className="min-w-0">
        <header className="flex items-center justify-end gap-2 border-b border-line bg-surface px-4 py-2 md:px-8">
          <ConnectionStatus />
          <ThemeToggle />
          <Link href="/account" className="rounded px-3 py-1.5 text-sm font-semibold text-ink-muted hover:bg-recessed hover:text-ink">Account</Link>
          <SignOutButton />
        </header>
        <main className="mx-auto max-w-6xl p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}
