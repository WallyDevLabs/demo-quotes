export const metadata = { title: "Offline" };

export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">You are offline</h1>
      <p className="text-sm text-ink-muted">
        CodeQuote needs a connection to show your clients, quotations and invoices, and none of them are stored on this device. Reconnect and reload this page.
      </p>
    </main>
  );
}
