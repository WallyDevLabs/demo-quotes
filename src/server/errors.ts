import { ZodError } from "zod";
import { DomainError } from "@/domain/errors";
import { PricingValidationError, type FieldIssue } from "@/domain/pricing/engine";

/** A rule the service enforces that the caller can fix. */
export class ServiceError extends Error {
  constructor(
    message: string,
    public readonly issues: FieldIssue[] = [],
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; message: string; issues: FieldIssue[] };

export function zodIssues(e: ZodError): FieldIssue[] {
  return e.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
}

/** Wraps a server action body so every failure becomes a message the form can show with a retry. */
export async function runAction<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    // A redirect (for example to the sign-in page when a session has ended) is not a failure: let it through.
    if (typeof e === "object" && e !== null && String((e as { digest?: unknown }).digest ?? "").startsWith("NEXT_REDIRECT")) throw e;
    if (e instanceof ZodError) return { ok: false, message: "Some fields need attention.", issues: zodIssues(e) };
    if (e instanceof PricingValidationError) return { ok: false, message: "Some fields need attention.", issues: e.fieldIssues };
    if (e instanceof ServiceError) return { ok: false, message: e.message, issues: e.issues };
    if (e instanceof DomainError) return { ok: false, message: e.message, issues: [] };
    // Never log request data: it contains client personal information (POPIA).
    console.error("Unexpected server error:", e instanceof Error ? e.name : "unknown");
    return { ok: false, message: "Something went wrong saving that. Please try again.", issues: [] };
  }
}
