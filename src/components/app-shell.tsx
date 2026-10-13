import Link from "next/link";
import { SignOutButton } from "./auth-forms";
import { MobileNav } from "./mobile-nav";
import { NavLinks } from "./nav-links";
import { ThemeToggle } from "./theme";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh md:grid md:grid-cols-[250px_1fr]">
      {/* Phones: top bar with a burger menu. */}
      <MobileNav />
      {/* Tablets and desktops: a fixed sidebar. */}
      <aside className="hidden border-r border-line bg-surface md:sticky md:top-0 md:block md:h-dvh md:overflow-y-auto">
        <div className="px-5 py-5">
          <div className="text-lg font-bold tracking-tight">CodeQuote</div>
          <div className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">Pricing and invoicing</div>
        </div>
        <NavLinks />
      </aside>
      <div className="min-w-0">
        <header className="hidden items-center justify-end gap-2 border-b border-line bg-surface px-8 py-2 md:flex">
          <ThemeToggle />
          <Link href="/account" className="rounded px-3 py-1.5 text-sm font-semibold text-ink-muted hover:bg-recessed hover:text-ink">Account</Link>
          <SignOutButton />
        </header>
        <main className="mx-auto max-w-6xl p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] md:p-8">{children}</main>
      </div>
    </div>
  );
}
