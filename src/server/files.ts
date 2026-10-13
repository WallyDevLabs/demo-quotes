import { createHash, randomUUID } from "node:crypto";
import type { FileKind, Prisma } from "@prisma/client";
import { db } from "./db";

type Tx = Prisma.TransactionClient;

export interface StoredBytes {
  id: string;
  bytes: Buffer;
  contentType: string;
  sha256: string;
}

/**
 * Files live in Postgres (bytea): private by construction, covered by the same backups as the
 * records they belong to, and served unchanged. Stored PDFs are made immutable by a database trigger.
 */
export async function storeFile(
  tx: Tx,
  ownerId: string,
  kind: FileKind,
  bytes: Uint8Array,
  contentType: string,
): Promise<{ id: string; sha256: string }> {
  const buf = Buffer.from(bytes);
  const sha256 = createHash("sha256").update(buf).digest("hex");
  const f = await tx.storedFile.create({
    data: { ownerId, kind, storageKey: `db:${randomUUID()}`, contentType, sizeBytes: buf.length, sha256, data: buf },
    select: { id: true },
  });
  return { id: f.id, sha256 };
}

/** Owner-scoped read. Returns null for another owner's file. */
export async function readFile(ownerId: string, id: string): Promise<StoredBytes | null> {
  const f = await db.storedFile.findFirst({ where: { id, ownerId } });
  if (!f || !f.data) return null;
  return { id: f.id, bytes: Buffer.from(f.data), contentType: f.contentType, sha256: f.sha256 };
}

/** Accepts only real PNG or JPEG bytes, whatever the file claims to be. */
export function sniffImage(bytes: Uint8Array): "image/png" | "image/jpeg" | null {
  const b = bytes;
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  return null;
}
