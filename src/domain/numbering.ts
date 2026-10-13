import { DomainError } from "./errors";

const TOKEN = /\{(YYYY|YY|PRJ|CLIENT|SEQ(?::(\d{1,2}))?)\}/g;

/** SET5: patterns look like QUO{YYYY}{SEQ:4}. Exactly one {SEQ} token is required. */
export function validateNumberPattern(pattern: string): void {
  const seqTokens = [...pattern.matchAll(TOKEN)].filter((m) => m[1]!.startsWith("SEQ"));
  if (seqTokens.length !== 1) {
    throw new DomainError("INVALID_PATTERN", "A numbering pattern needs exactly one {SEQ} or {SEQ:n} token");
  }
  const leftover = pattern.replace(TOKEN, "");
  if (/[{}]/.test(leftover)) throw new DomainError("INVALID_PATTERN", "Unknown token in numbering pattern");
}

export interface NumberCodes {
  /** Short project code for {PRJ}. */
  project?: string | null;
  /** Short client code for {CLIENT}. */
  client?: string | null;
}

/** Codes are printed in document numbers, so keep them short, upper case and unambiguous. */
export function normaliseCode(code: string): string {
  return code.trim().toUpperCase();
}
export const CODE_PATTERN = /^[A-Z0-9]{2,8}$/;

/**
 * `seq` comes from the locked counter row inside the issuing transaction; `year` from the issue
 * date. There is one gap-free sequence however the pattern is written: {PRJ} and {CLIENT} only
 * change how the number reads, never how it is counted.
 */
export function formatDocumentNumber(pattern: string, seq: number, year: number, codes: NumberCodes = {}): string {
  validateNumberPattern(pattern);
  if (pattern.includes("{PRJ}") && !codes.project) {
    throw new DomainError("INVALID_PATTERN", "This pattern needs a project code, but the project has none");
  }
  if (pattern.includes("{CLIENT}") && !codes.client) {
    throw new DomainError("INVALID_PATTERN", "This pattern needs a client code, but the client has none");
  }
  if (!Number.isSafeInteger(seq) || seq < 1) throw new DomainError("INVALID_AMOUNT", "Sequence must be a positive integer");
  return pattern.replace(TOKEN, (_m, token: string, width?: string) => {
    if (token === "YYYY") return String(year).padStart(4, "0");
    if (token === "YY") return String(year % 100).padStart(2, "0");
    if (token === "PRJ") return normaliseCode(codes.project!);
    if (token === "CLIENT") return normaliseCode(codes.client!);
    return String(seq).padStart(width ? Number(width) : 1, "0");
  });
}

/** SET5: a counter can never be lowered. */
export function assertCounterNotLowered(current: number, next: number): void {
  if (!Number.isSafeInteger(next) || next < current) {
    throw new DomainError("COUNTER_LOWERED", `The next number cannot be lower than ${current}`);
  }
}
