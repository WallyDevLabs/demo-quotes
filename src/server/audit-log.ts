import { db } from "./db";

export interface AuditEntryDTO {
  id: string;
  at: string;
  entity: string;
  entityId: string;
  action: string;
  detail: string;
}

export interface AuditPage {
  entries: AuditEntryDTO[];
  /** Pass back as `before` to read the next, older page. Null when there is no more. */
  nextBefore: string | null;
}

export const AUDIT_ENTITIES = ["auth", "settings", "counter", "client", "project", "estimate", "quotation", "invoice", "payment"] as const;

/** Newest first, owner-scoped. Entries hold field names, ids and statuses only: never client names, emails or amounts in free text. */
export async function listAudit(ownerId: string, opts: { entity?: string; before?: string; limit?: number } = {}): Promise<AuditPage> {
  const limit = Math.min(opts.limit ?? 100, 200);
  const before = opts.before ? new Date(opts.before) : null;
  const rows = await db.auditLog.findMany({
    where: {
      ownerId,
      ...(opts.entity && (AUDIT_ENTITIES as readonly string[]).includes(opts.entity) ? { entity: opts.entity } : {}),
      ...(before && !Number.isNaN(before.getTime()) ? { createdAt: { lt: before } } : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
  });
  const page = rows.slice(0, limit);
  return {
    entries: page.map((r) => ({
      id: r.id,
      at: r.createdAt.toISOString(),
      entity: r.entity,
      entityId: r.entityId,
      action: r.action,
      detail: r.detail === null ? "" : JSON.stringify(r.detail),
    })),
    nextBefore: rows.length > limit ? page[page.length - 1]!.createdAt.toISOString() : null,
  };
}
