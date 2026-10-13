"use client";

import { useCallback, useRef, useState } from "react";
import type { FieldIssue } from "@/domain/pricing/engine";
import type { ActionResult } from "@/server/errors";
import { Button } from "./ui";

export interface SaveState {
  status: "idle" | "saving" | "saved" | "error";
  message?: string;
  issues: FieldIssue[];
}

/**
 * Runs a server action, tracks saving / saved / error, and remembers the last call so a failed
 * save can be retried with one click (every failed save shows a message with a retry).
 *
 * "Pending" is plain state, deliberately not useTransition: a server action started inside a transition
 * that does not return its promise leaves the transition open, and React then never applies the refreshed
 * page (found by the end-to-end test: a quotation was sent but the screen stayed on the draft).
 */
export function useSave() {
  const [pending, setPending] = useState(false);
  const [state, setState] = useState<SaveState>({ status: "idle", issues: [] });
  const last = useRef<(() => Promise<unknown>) | null>(null);

  const run = useCallback(
    <T,>(fn: () => Promise<ActionResult<T>>, onOk?: (data: T) => void, opts?: { reload?: boolean }) => {
      const attempt = async () => {
        setPending(true);
        setState({ status: "saving", issues: [] });
        try {
          const r = await fn();
          if (r.ok) {
            setState({ status: "saved", issues: [] });
            onOk?.(r.data);
            // For actions that change what the page IS (sent, accepted, issued, paid, cancelled) a full load is
            // used: it always shows the true state, whereas the soft page refresh was seen, in the production
            // build only, to leave the old screen up after the server had already acted.
            if (opts?.reload) window.location.reload();
          } else {
            setState({ status: "error", message: r.message, issues: r.issues });
          }
        } catch {
          setState({ status: "error", message: "Could not reach the server. Check your connection and retry.", issues: [] });
        } finally {
          setPending(false);
        }
      };
      last.current = attempt;
      void attempt();
    },
    [],
  );

  const retry = useCallback(() => {
    const fn = last.current;
    if (fn) void fn();
  }, []);

  const error = useCallback(
    (path: string) => state.issues.find((i) => i.path === path)?.message,
    [state.issues],
  );

  return { state, run, retry, pending, error };
}

export function SaveStatus({ state, retry }: { state: SaveState; retry: () => void }) {
  if (state.status === "saving") return <span className="text-xs text-ink-muted">Saving…</span>;
  if (state.status === "saved") return <span role="status" className="text-xs font-semibold text-profit-ink">Saved</span>;
  if (state.status === "error") {
    return (
      <span role="alert" className="flex flex-wrap items-center gap-2 text-xs font-semibold text-cost-ink">
        {state.message}
        <Button variant="secondary" onClick={retry} className="min-h-7 px-2 text-xs">
          Retry
        </Button>
      </span>
    );
  }
  return null;
}
