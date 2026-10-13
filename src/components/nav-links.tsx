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

export function NavLinks() {
  const path = usePathname();
  return (
    <nav aria-label="Primary" className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:pb-5">
      {NAV.map((item) => {
        if (!item.href) {
          return (
            <span key={item.label} aria-disabled="true" className="flex items-center justify-between gap-2 whitespace-nowrap rounded px-3 py-2 text-sm text-ink-muted/70">
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
              "whitespace-nowrap rounded px-3 py-2 text-sm font-semibold transition",
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
