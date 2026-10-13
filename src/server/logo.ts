import { audit } from "./audit";
import { db } from "./db";
import { ServiceError } from "./errors";
import { sniffImage, storeFile } from "./files";

const MAX_BYTES = 300 * 1024;

/**
 * SET1: the logo printed on quotations. The bytes are checked, not the file name or claimed type.
 * Old logo files are kept (a sent quotation's stored PDF already contains the one it used).
 */
export async function uploadLogo(ownerId: string, file: FormDataEntryValue | null): Promise<void> {
  if (!(file instanceof File) || file.size === 0) throw new ServiceError("Choose a PNG or JPEG image.");
  if (file.size > MAX_BYTES) throw new ServiceError("The logo must be 300 KB or smaller.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffImage(bytes);
  if (!type) throw new ServiceError("The logo must be a PNG or JPEG image.");
  await db.$transaction(async (tx) => {
    const stored = await storeFile(tx, ownerId, "LOGO", bytes, type);
    await tx.businessSettings.upsert({
      where: { ownerId },
      update: { logoFileId: stored.id },
      create: { ownerId, logoFileId: stored.id },
    });
    await audit(tx, ownerId, "settings", ownerId, "logo.update", { fileId: stored.id });
  });
}

export async function removeLogo(ownerId: string): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.businessSettings.updateMany({ where: { ownerId }, data: { logoFileId: null } });
    await audit(tx, ownerId, "settings", ownerId, "logo.remove");
  });
}

export async function getLogoFileId(ownerId: string): Promise<string | null> {
  const s = await db.businessSettings.findUnique({ where: { ownerId }, select: { logoFileId: true } });
  return s?.logoFileId ?? null;
}
