import { DomainError } from "./errors";

/**
 * A calendar date as "YYYY-MM-DD" (Africa/Johannesburg). Due and expiry dates are calendar
 * dates, not timestamps, so a document never becomes overdue early or late because of a zone.
 */
export type CalendarDate = string;

const SHAPE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isCalendarDate(s: string): boolean {
  const m = SHAPE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

export function assertCalendarDate(s: string): void {
  if (!isCalendarDate(s)) throw new DomainError("INVALID_DATE", `Not a calendar date: ${s}`);
}

/** The current calendar date in South Africa. The clock is passed in, never read here. */
export function todayInJohannesburg(now: Date): CalendarDate {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function addDays(date: CalendarDate, days: number): CalendarDate {
  assertCalendarDate(date);
  const m = SHAPE.exec(date)!;
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
  return dt.toISOString().slice(0, 10);
}

/** Negative if a is before b, 0 if equal, positive if after. */
export function compareDates(a: CalendarDate, b: CalendarDate): number {
  assertCalendarDate(a);
  assertCalendarDate(b);
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Adds calendar months, clamping to the end of a shorter month (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(date: CalendarDate, months: number): CalendarDate {
  assertCalendarDate(date);
  const m = SHAPE.exec(date)!;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1 + months;
  const day = Number(m[3]);
  const lastDay = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, mo, Math.min(day, lastDay))).toISOString().slice(0, 10);
}

/** First day of the trailing twelve months ending today, inclusive: 2026-10-13 gives 2025-10-14. */
export function trailingYearStart(today: CalendarDate): CalendarDate {
  return addDays(addMonths(today, -12), 1);
}
