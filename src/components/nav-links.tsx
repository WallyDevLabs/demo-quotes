"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Badge, cx } from "./ui";

const NAV: { label: string; href: string | null; note?: string }[] = [
  { label: "Dashboard", href: "/" },
  { label: "Estimates", href: "/estimates" },
  { label: "Clients", href: "/clients" },
  { label: "Projects", href: "/projects" },
  { label: "Quotations", href: "/quotations" },
  { label: "Invoices", href: "/invoices" },
  { label: "Reports", href: null, note: "phase 2" },
  { label: "Settings", href: "/settings" },
  { label: "Audit log", href: "/audit" },
];

/** A vertical list: the sidebar on desktop and the drawer on a phone. Rows are tall enough for a thumb. */
export function NavLinks() {
  const path = usePathname();
  return (
    <nav aria-label="Primary" className="flex flex-col gap-1 px-3 pb-3">
      {NAV.map((item) => {
        if (!item.href) {
          return (
            <span key={item.label} aria-disabled="true" className="flex items-center justify-between gap-2 rounded px-3 py-3 text-sm text-ink-muted/70 md:py-2">
              {item.label}
              <Badge>{item.note}</Badge>
            </span>
          );
        }
        const active = item.href === "/" ? path === "/" : path === item.href || path.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.label}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cx(
              "rounded px-3 py-3 text-sm font-semibold transition md:py-2",
              active ? "bg-primary-soft text-primary-ink" : "text-ink-muted hover:bg-recessed hover:text-ink",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
