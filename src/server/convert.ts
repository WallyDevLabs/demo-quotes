import type { Prisma } from "@prisma/client";
import type { Complexity, LabourCategory } from "@/domain/pricing/schema";

export const big = (n: number): bigint => BigInt(n);
export function num(b: bigint | null | undefined): number {
  if (b === null || b === undefined) return 0;
  const n = Number(b);
  if (!Number.isSafeInteger(n)) throw new RangeError("Amount out of range");
  return n;
}
export const numOrNull = (b: bigint | null | undefined): number | null => (b === null || b === undefined ? null : num(b));
export const dstr = (d: Prisma.Decimal | null | undefined): string => (d ? d.toFixed(2) : "0.00");

export const catToDb = (c: LabourCategory) => c.toUpperCase() as Uppercase<LabourCategory>;
export const catFromDb = (c: string) => c.toLowerCase() as LabourCategory;
export const cxToDb = (c: Complexity) => c.toUpperCase() as Uppercase<Complexity>;
export const cxFromDb = (c: string) => c.toLowerCase() as Complexity;

/** "YYYY-MM-DD" <-> a UTC midnight Date for Postgres DATE columns. */
export const dateToDb = (s: string | undefined | null): Date | null => (s ? new Date(`${s}T00:00:00.000Z`) : null);
export const dateFromDb = (d: Date | null | undefined): string | null => (d ? d.toISOString().slice(0, 10) : null);
