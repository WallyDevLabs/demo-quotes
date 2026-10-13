// Sign-in and setup read cookies and the database on every request.
export const dynamic = "force-dynamic";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-10">
      <div className="mb-6 text-center">
        <div className="text-2xl font-bold tracking-tight">CodeQuote</div>
        <div className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">Pricing and invoicing</div>
      </div>
      <div className="rounded-lg border border-line bg-surface p-5 shadow-raised">{children}</div>
    </main>
  );
}
