import { describe, expect, it } from "vitest";
import { sniffImage } from "@/server/files";
import { db } from "@/server/db";
import { removeLogo, uploadLogo } from "@/server/logo";
import { createQuotationFromEstimate, getQuotationDocument, getQuotationPdf, sendQuotation } from "@/server/quotations";
import { newOwner, setupReadyEstimate } from "./helpers";

// A real 1x1 PNG.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const asFile = (bytes: Uint8Array | string, name = "logo.png", type = "image/png") => new File([bytes as BlobPart], name, { type });

describe("logo upload (SET1)", () => {
  it("checks the real bytes, not the file name or claimed type", async () => {
    const o = await newOwner();
    await expect(uploadLogo(o, asFile("this is not an image"))).rejects.toThrow(/PNG or JPEG/);
    await expect(uploadLogo(o, asFile("<svg onload=alert(1)/>", "logo.png", "image/png"))).rejects.toThrow(/PNG or JPEG/);
    await expect(uploadLogo(o, null)).rejects.toThrow(/Choose/);
    await expect(uploadLogo(o, asFile(new Uint8Array(301 * 1024).fill(1)))).rejects.toThrow(/300 KB/);
    expect(sniffImage(PNG)).toBe("image/png");
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe("image/jpeg");
  });

  it("stores a real PNG, audits it, and can remove it", async () => {
    const o = await newOwner();
    await uploadLogo(o, asFile(PNG));
    const s = await db.businessSettings.findUniqueOrThrow({ where: { ownerId: o } });
    expect(s.logoFileId).not.toBeNull();
    const f = await db.storedFile.findUniqueOrThrow({ where: { id: s.logoFileId! } });
    expect(f.contentType).toBe("image/png");
    expect(f.kind).toBe("LOGO");
    expect(await db.auditLog.count({ where: { ownerId: o, action: "logo.update" } })).toBe(1);
    await removeLogo(o);
    expect((await db.businessSettings.findUniqueOrThrow({ where: { ownerId: o } })).logoFileId).toBeNull();
  });

  it("is printed on a sent quotation and kept by it when the logo later changes", async () => {
    const s = await setupReadyEstimate();
    await uploadLogo(s.ownerId, asFile(PNG));
    const id = await createQuotationFromEstimate(s.ownerId, s.estimateId);
    await sendQuotation(s.ownerId, id, { now: new Date("2026-10-13T10:00:00Z") }); // the real PDF renderer
    const before = await getQuotationDocument(s.ownerId, id);
    expect(before!.business.logoFileId).not.toBeNull();
    expect((await getQuotationPdf(s.ownerId, id))!.bytes.subarray(0, 5).toString()).toBe("%PDF-");

    await removeLogo(s.ownerId);
    expect((await getQuotationDocument(s.ownerId, id))!.business.logoFileId).toBe(before!.business.logoFileId);
  }, 60_000);
});
