import type { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

/**
 * One entry per status change, setting change or reversal. `detail` holds field names and ids only:
 * never client names, emails or amounts in free text (POPIA).
 */
export async function audit(
  tx: Tx,
  ownerId: string,
  entity: string,
  entityId: string,
  action: string,
  detail?: Prisma.InputJsonValue,
) {
  await tx.auditLog.create({ data: { ownerId, entity, entityId, action, detail } });
}

export function changedKeys(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  return Object.keys(after).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
}
