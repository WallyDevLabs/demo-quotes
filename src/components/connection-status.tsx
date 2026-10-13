"use client";

import { useSyncExternalStore } from "react";

function subscribe(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
}

export function ConnectionStatus() {
  const online = useOnline();
  return (
    <span
      role="status"
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${
        online
          ? "border-profit-soft bg-profit-soft text-profit-ink"
          : "border-caution-soft bg-caution-soft text-caution-ink"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${online ? "bg-profit" : "bg-caution"}`} />
      {online ? "Online" : "Offline: changes will sync later"}
    </span>
  );
}
