import { DomainError } from "./errors";
import { D, dec, hasMaxDecimals, type Cents, type Decimalish } from "./money";

/**
 * QUO6: split a total across milestone percentages. Percentages must total exactly 100 and
 * amounts use largest remainder rounding, so they sum to the total to the cent. Ties on the
 * remainder go to the earlier milestone, which keeps the result deterministic.
 */
export function splitByPercentages(totalCents: Cents, percentages: Decimalish[]): Cents[] {
  if (!Number.isSafeInteger(totalCents) || totalCents < 0) {
    throw new DomainError("INVALID_AMOUNT", "Total must be a non-negative whole number of cents");
  }
  if (percentages.length === 0) throw new DomainError("INVALID_PERCENTAGES", "At least one milestone is required");

  const pcts = percentages.map((p) => dec(p));
  if (pcts.some((p) => p.isNegative() || p.isZero() || !hasMaxDecimals(p.toString(), 2))) {
    throw new DomainError("INVALID_PERCENTAGES", "Each percentage must be above zero with at most two decimals");
  }
  const sum = pcts.reduce((s, p) => s.plus(p), new D(0));
  if (!sum.eq(100)) {
    throw new DomainError("INVALID_PERCENTAGES", `Milestone percentages must total exactly 100 (got ${sum})`);
  }

  const exact = pcts.map((p) => p.mul(totalCents).div(100));
  const floors = exact.map((x) => x.floor().toNumber());
  let remaining = totalCents - floors.reduce((s, f) => s + f, 0);

  const order = exact
    .map((x, i) => ({ i, frac: x.minus(x.floor()) }))
    .sort((a, b) => b.frac.comparedTo(a.frac) || a.i - b.i);
  const result = [...floors];
  for (const { i } of order) {
    if (remaining <= 0) break;
    result[i]! += 1;
    remaining -= 1;
  }
  return result;
}
