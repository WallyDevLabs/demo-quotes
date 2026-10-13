import { z } from "zod";
import { db } from "@/server/db";
import { requireOwnerId } from "@/server/owner";

/** Authenticated, owner-scoped image serving (the logo). PDFs are served by their quotation's route. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) return new Response("Not found", { status: 404 });
  let ownerId: string;
  try {
    ownerId = await requireOwnerId();
  } catch {
    return new Response("Unauthorised", { status: 401 });
  }
  const f = await db.storedFile.findFirst({ where: { id, ownerId, kind: "LOGO" } });
  if (!f?.data) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(f.data), {
    headers: {
      "Content-Type": f.contentType,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
