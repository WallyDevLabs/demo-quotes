import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

/**
 * Node-only security primitives: password hashing, TOTP (RFC 6238), encryption of the authenticator
 * secret at rest, and recovery codes. No third-party crypto and no native modules, so it installs
 * the same on Windows, CI and Vercel.
 */

// ---------------------------------------------------------------------------------------------
// Passwords: scrypt with a per-password salt (OWASP-accepted; argon2id is preferred where a native
// module is acceptable). Parameters are stored with the hash so they can be raised later.
// ---------------------------------------------------------------------------------------------

const SCRYPT = { N: 2 ** 15, r: 8, p: 1, keylen: 32, maxmem: 128 * 1024 * 1024 } as const;

function derive(password: string, salt: Buffer, N: number, r: number, p: number, keylen: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize("NFKC"), salt, keylen, { N, r, p, maxmem: SCRYPT.maxmem }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, SCRYPT.N, SCRYPT.r, SCRYPT.p, SCRYPT.keylen);
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString("base64"), key.toString("base64")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [N, r, p] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  // Refuse absurd parameters from a corrupted value rather than burning memory on them.
  if (!Number.isInteger(N) || N < 2 ** 12 || N > 2 ** 17 || r < 1 || r > 16 || p < 1 || p > 4) return false;
  const expected = Buffer.from(parts[5]!, "base64");
  const actual = await derive(password, Buffer.from(parts[4]!, "base64"), N, r, p, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

let dummy: Promise<string> | null = null;
/** Verifies against a throwaway hash so an unknown email takes as long as a wrong password. */
export async function burnPasswordTime(password: string): Promise<void> {
  dummy ??= hashPassword("not-a-real-password");
  await verifyPassword(password, await dummy);
}

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 200;

export function passwordProblem(password: string, email: string): string | null {
  if (password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters. A long passphrase is easier to remember and stronger.`;
  if (password.length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters.`;
  if (password.trim().toLowerCase() === email.trim().toLowerCase()) return "The password cannot be your email address.";
  if (/^(.)\1+$/.test(password)) return "That password is too easy to guess.";
  return null;
}

// ---------------------------------------------------------------------------------------------
// Base32 and TOTP (RFC 4648, RFC 4226, RFC 6238)
// ---------------------------------------------------------------------------------------------

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.replace(/[\s=-]/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error("Invalid base32");
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export const TOTP_PERIOD = 30;
export const totpStepAt = (nowMs: number) => Math.floor(nowMs / 1000 / TOTP_PERIOD);

/** RFC 6238 with HMAC-SHA1, six digits (what every authenticator app expects). */
export function totpCode(secret: Buffer, step: number, digits = 6): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", secret).update(counter).digest();
  const offset = h[h.length - 1]! & 0xf;
  const bin = ((h[offset]! & 0x7f) << 24) | (h[offset + 1]! << 16) | (h[offset + 2]! << 8) | h[offset + 3]!;
  return String(bin % 10 ** digits).padStart(digits, "0");
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/**
 * Returns the matched time step, or null. Accepts the previous, current and next step to allow for clock
 * drift, and refuses any step at or before `lastStep` so a code cannot be used twice (replay protection).
 */
export function verifyTotp(secretB32: string, input: string, nowMs: number, lastStep: number | null): number | null {
  const code = input.replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) return null;
  const secret = base32Decode(secretB32);
  const now = totpStepAt(nowMs);
  let matched: number | null = null;
  for (const step of [now - 1, now, now + 1]) {
    const expected = totpCode(secret, step);
    // Always compare all three, in constant time, so timing does not reveal which step matched.
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(code)) && matched === null) matched = step;
  }
  if (matched === null) return null;
  if (lastStep !== null && matched <= lastStep) return null;
  return matched;
}

export function otpauthUri(secretB32: string, email: string): string {
  const label = encodeURIComponent(`CodeQuote:${email}`);
  return `otpauth://totp/${label}?secret=${secretB32}&issuer=CodeQuote&algorithm=SHA1&digits=6&period=${TOTP_PERIOD}`;
}

// ---------------------------------------------------------------------------------------------
// The authenticator secret is encrypted at rest (AES-256-GCM, key derived from AUTH_SECRET)
// ---------------------------------------------------------------------------------------------

function key(authSecret: string): Buffer {
  return Buffer.from(hkdfSync("sha256", authSecret, "codequote", "totp-secret", 32));
}

export function encryptSecret(plain: string, authSecret: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(authSecret), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), ct.toString("base64")].join(":");
}

export function decryptSecret(stored: string, authSecret: string): string {
  const [v, iv, tag, ct] = stored.split(":");
  if (v !== "v1" || !iv || !tag || !ct) throw new Error("Unrecognised secret format");
  const d = createDecipheriv("aes-256-gcm", key(authSecret), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64")), d.final()]).toString("utf8");
}

// ---------------------------------------------------------------------------------------------
// Recovery codes: ten random characters, shown once, stored only as a hash, each usable once
// ---------------------------------------------------------------------------------------------

export function generateRecoveryCodes(count = 8): string[] {
  return Array.from({ length: count }, () => {
    const raw = base32Encode(randomBytes(7)).slice(0, 10);
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}

export const normaliseRecoveryCode = (s: string) => s.toUpperCase().replace(/[^A-Z2-7]/g, "");
export const hashRecoveryCode = (s: string) => createHash("sha256").update(normaliseRecoveryCode(s)).digest("hex");
export const looksLikeRecoveryCode = (s: string) => normaliseRecoveryCode(s).length === 10 && !/^\d{6}$/.test(s.replace(/\s/g, ""));
