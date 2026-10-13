import { AppShell } from "@/components/app-shell";

// Every page here reads the database per request.
export const dynamic = "force-dynamic";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
