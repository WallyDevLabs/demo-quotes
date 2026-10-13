import Decimal from "decimal.js";

/** Isolated Decimal constructor so we never touch global Decimal config. */
export const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export type Decimalish = number | string;

/**
 * Money is an integer number of cents. It is a JS number in the domain (safe up to ~R90 trillion)
 * and a Postgres bigint at rest; the repository layer converts at the boundary.
 */
export type Cents = number;

export function dec(v: Decimalish): Decimal {
  const d = new D(v);
  if (!d.isFinite()) throw new RangeError(`Invalid number: ${String(v)}`);
  return d;
}

export function isCents(n: unknown): n is Cents {
  return typeof n === "number" && Number.isSafeInteger(n);
}

/** Round a Decimal amount of cents half up to a whole number of cents. */
export function toCents(amount: Decimal): Cents {
  return amount.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
}

/** `pct` percent of `cents`, rounded half up once. */
export function pctOf(cents: Cents, pct: Decimalish): Cents {
  return toCents(dec(cents).mul(dec(pct)).div(100));
}

/** Hours x rate (cents per hour), rounded half up once. */
export function hoursTimesRate(hours: Decimalish, rateCents: Cents): Cents {
  return toCents(dec(hours).mul(rateCents));
}

export function hasMaxDecimals(v: Decimalish, places: number): boolean {
  return dec(v).decimalPlaces() <= places;
}

export const CURRENCIES = ["ZAR", "USD"] as const;
export type Currency = (typeof CURRENCIES)[number];

const SYMBOLS: Record<Currency, string> = { ZAR: "R", USD: "US$" };

/** Display only. Never parse this back into a number. No conversion exists between currencies. */
export function formatMoney(cents: Cents, currency: Currency = "ZAR"): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const major = Math.trunc(abs / 100);
  const minor = String(abs % 100).padStart(2, "0");
  const grouped = String(major).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${sign}${SYMBOLS[currency]}${grouped}.${minor}`;
}

export const formatZAR = (cents: Cents): string => formatMoney(cents, "ZAR");

/** Form input in major units ("600", "1 234.50", "1234,5") to cents. Rejects more than two decimals. */
export function parseAmountToCents(input: string): Cents {
  const cleaned = input.trim().replace(/[\s ]/g, "").replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) throw new RangeError("Enter an amount like 600.00");
  const d = new D(cleaned);
  if (d.decimalPlaces() > 2) throw new RangeError("An amount allows at most two decimal places");
  return toCents(d.mul(100));
}

/** Cents to an editable major-unit string ("60000" -> "600.00"). */
export function centsToAmountString(cents: Cents): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}
