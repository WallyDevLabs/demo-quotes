import { z } from "zod";
import { currencySchema } from "../schemas";
import { COMPLEXITIES, LABOUR_CATEGORIES } from "./schema";
import type { EstimateDraft } from "./draft";

/**
 * Shape check for a draft arriving from the browser. It only guards structure and size; the
 * numeric rules (EST9) are enforced by evaluateDraft and the engine's schema.
 */
const str = (max: number) => z.string().max(max);
const id = z.string().uuid();

export const estimateDraftSchema = z.object({
  method: z.enum(["time", "fixed"]),
  currency: currencySchema,
  complexity: z.enum(COMPLEXITIES).nullable(),
  urgent: z.boolean(),
  urgencyPct: str(12),
  contingencyPct: str(12),
  discount: z.object({ type: z.enum(["none", "percent", "fixed"]), value: str(20) }),
  labour: z
    .array(
      z.object({
        id,
        task: str(300),
        category: z.enum(LABOUR_CATEGORIES),
        hours: str(12),
        rate: str(20),
      }),
    )
    .max(200),
  deliverables: z
    .array(z.object({ id, name: str(300), price: str(20), estimatedHours: str(12) }))
    .max(200),
  expenses: z
    .array(
      z.object({
        id,
        description: str(300),
        cost: str(20),
        markupPct: str(12),
        recurring: z.boolean(),
        period: z.enum(["monthly", "annual"]),
      }),
    )
    .max(200),
}) satisfies z.ZodType<EstimateDraft>;
