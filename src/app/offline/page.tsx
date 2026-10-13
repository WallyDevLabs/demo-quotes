export const metadata = { title: "Offline" };

export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">You are offline</h1>
      <p className="text-sm text-ink-muted">
        This page has not been saved for offline use yet. Pages you have already opened still work, and any changes
        you make will sync when you are back online.
      </p>
    </main>
  );
}
