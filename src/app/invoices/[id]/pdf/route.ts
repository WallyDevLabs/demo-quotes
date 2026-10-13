import { z } from "zod";
import { getInvoicePdf } from "@/server/invoices";
import { requireOwnerId } from "@/server/owner";

/**
 * INV7: every download serves the PDF stored when the invoice was issued, byte for byte.
 * Authenticated and owner-scoped; the file is never regenerated.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) return new Response("Not found", { status: 404 });
  let ownerId: string;
  try {
    ownerId = await requireOwnerId();
  } catch {
    return new Response("Unauthorised", { status: 401 });
  }
  const pdf = await getInvoicePdf(ownerId, id);
  if (!pdf) return new Response("This invoice has no PDF yet. It is created when the invoice is issued.", { status: 404 });
  const name = `${(pdf.number ?? "invoice").replace(/[^A-Za-z0-9._-]/g, "_")}.pdf`;
  return new Response(new Uint8Array(pdf.bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${name}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      ETag: `"${pdf.sha256}"`,
    },
  });
}
