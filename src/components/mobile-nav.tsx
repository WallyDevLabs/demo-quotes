"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { SignOutButton } from "./auth-forms";
import { NavLinks } from "./nav-links";
import { ThemeToggle } from "./theme";

const bars = { width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", "aria-hidden": true } as const;

/** Phone layout: a top bar with a burger button that opens the navigation as a drawer. Hidden from `md` up, where the sidebar shows. */
export function MobileNav({ demo = false }: { demo?: boolean }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  const closeRef = useRef<HTMLButtonElement>(null);
  const burgerRef = useRef<HTMLButtonElement>(null);

  // Any navigation closes the drawer.
  useEffect(() => setOpen(false), [path]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    // The page behind must not scroll while the drawer is open.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const burger = burgerRef.current;
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      burger?.focus();
    };
  }, [open]);

  return (
    <div className="md:hidden">
      <header className="sticky top-0 z-30 flex items-center gap-1 border-b border-line bg-surface px-2 pb-2 pt-[calc(0.5rem+env(safe-area-inset-top))]">
        <button
          ref={burgerRef}
          type="button"
          aria-label="Open menu"
          aria-expanded={open}
          aria-controls="mobile-drawer"
          onClick={() => setOpen(true)}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded text-ink hover:bg-recessed"
        >
          <svg {...bars}>
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <Link href="/" className="min-w-0 flex-1 truncate px-1 text-base font-bold tracking-tight">
          CodeQuote
        </Link>
        <ThemeToggle />
      </header>

      {open && (
        <div className="fixed inset-0 z-40">
          <button type="button" aria-label="Close menu" tabIndex={-1} className="absolute inset-0 bg-ink/40" onClick={() => setOpen(false)} />
          <aside
            id="mobile-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
            className="absolute inset-y-0 left-0 flex w-[min(20rem,85vw)] flex-col overflow-y-auto border-r border-line bg-surface pt-[env(safe-area-inset-top)] shadow-raised"
          >
            <div className="flex items-center justify-between px-4 py-3">
              <div>
                <div className="text-lg font-bold tracking-tight">CodeQuote</div>
                <div className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">Pricing and invoicing</div>
              </div>
              <button
                ref={closeRef}
                type="button"
                aria-label="Close menu"
                onClick={() => setOpen(false)}
                className="inline-flex h-10 w-10 items-center justify-center rounded text-ink-muted hover:bg-recessed hover:text-ink"
              >
                <svg {...bars}>
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
            <NavLinks />
            {!demo && (
              <div className="mt-auto flex flex-col gap-1 border-t border-line p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
                <Link href="/account" className="rounded px-3 py-3 text-sm font-semibold text-ink-muted hover:bg-recessed hover:text-ink">
                  Account
                </Link>
                <SignOutButton className="min-h-11 w-full !justify-start px-3 py-3" />
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
