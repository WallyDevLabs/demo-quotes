import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { db } from "../db";
import { ServiceError } from "../errors";
import { hashPassword, verifyPassword } from "./crypto";
import { lockedUntil, MAX_ACCOUNT_FAILURES, recordFailure, type AuthDeps, type Limit } from "./service";

/**
 * Trusted devices and the 4 digit PIN. A browser earns trust by passing password + authenticator code
 * once. From then on that browser signs in with the PIN alone. The PIN is useless without the device's
 * cookie, and five wrong PINs delete the device, so a four digit number is enough: guessing it would
 * need the cookie first, and there are only five tries.
 */

export const PIN_LENGTH = 4;
export const MAX_PIN_FAILURES = 5;
export const DEVICE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

async function audit(ownerId: string, action: string, detail?: object) {
  await db.auditLog.create({ data: { ownerId, entity: "auth", entityId: ownerId, action, detail: detail as never } });
}

/** Four digits, and not the ones anyone would try first. */
export function pinProblem(pin: string): string | null {
  if (!/^\d{4}$/.test(pin)) return "The PIN must be exactly 4 digits";
  if (/^(\d)\1{3}$/.test(pin)) return "Choose a PIN that is not four of the same digit";
  if (["0123", "1234", "2345", "3456", "4567", "5678", "6789", "3210", "4321", "5432", "6543", "7654", "8765", "9876"].includes(pin)) {
    return "Choose a PIN that is not a run of digits";
  }
  return null;
}

/** Sets or changes the PIN. Always needs the password, so a stolen session cannot swap it. */
export async function setPin(userId: string, input: { pin: string; password: string }, deps: AuthDeps = {}): Promise<void> {
  const now = deps.now ?? new Date();
  const limits: Limit[] = [{ key: `pw:${userId}`, max: MAX_ACCOUNT_FAILURES }];
  if (await lockedUntil(limits, now)) throw new ServiceError("Too many attempts. Wait a few minutes and try again.");
  const u = await db.user.findUnique({ where: { id: userId } });
  if (!u || !u.totpEnabledAt) throw new ServiceError("Two-factor authentication is not set up.");
  if (!(await verifyPassword(input.password, u.passwordHash))) {
    await recordFailure(limits, now);
    throw new ServiceError("Some fields need attention.", [{ path: "password", message: "That is not your password" }]);
  }
  const problem = pinProblem(input.pin);
  if (problem) throw new ServiceError("Some fields need attention.", [{ path: "pin", message: problem }]);
  await db.user.update({ where: { id: userId }, data: { pinHash: await hashPassword(input.pin) } });
  await audit(userId, "auth.pin_set");
}

export async function hasPin(userId: string): Promise<boolean> {
  const u = await db.user.findUnique({ where: { id: userId }, select: { pinHash: true } });
  return !!u?.pinHash;
}

// ---------------------------------------------------------------------------------------------
// Devices
// ---------------------------------------------------------------------------------------------

/** Registers this browser as trusted and returns the cookie value (shown to nobody; only its hash is stored). */
export async function trustDevice(userId: string, label: string, deps: AuthDeps = {}): Promise<string> {
  const now = deps.now ?? new Date();
  const secret = randomBytes(32).toString("base64url");
  const d = await db.trustedDevice.create({
    data: { userId, tokenHash: sha256(secret), label: label.slice(0, 80), expiresAt: new Date(now.getTime() + DEVICE_TTL_MS), createdAt: now, lastUsedAt: now },
  });
  // Housekeeping: devices past their date are of no use.
  await db.trustedDevice.deleteMany({ where: { userId, expiresAt: { lt: now } } });
  await audit(userId, "auth.device_trusted", { label: d.label });
  return `${d.id}.${secret}`;
}

function parseCookie(value: string | undefined): { id: string; secret: string } | null {
  if (!value) return null;
  const i = value.indexOf(".");
  if (i < 1) return null;
  const id = value.slice(0, i);
  const secret = value.slice(i + 1);
  return /^[0-9a-f-]{36}$/.test(id) && secret.length > 20 && secret.length < 100 ? { id, secret } : null;
}

async function findDevice(value: string | undefined, now: Date) {
  const c = parseCookie(value);
  if (!c) return null;
  const d = await db.trustedDevice.findUnique({ where: { id: c.id }, include: { user: { select: { id: true, email: true, pinHash: true, sessionVersion: true, totpEnabledAt: true } } } });
  if (!d || d.expiresAt <= now) return null;
  const a = Buffer.from(sha256(c.secret));
  const b = Buffer.from(d.tokenHash);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (!d.user.pinHash || !d.user.totpEnabledAt) return null;
  return d;
}

/** Whether this browser can sign in with a PIN, and for which email (shown on the PIN screen). */
export async function pinStatus(cookie: string | undefined, deps: AuthDeps = {}): Promise<{ email: string } | null> {
  const d = await findDevice(cookie, deps.now ?? new Date());
  return d ? { email: d.user.email } : null;
}

export type PinLoginResult =
  | { ok: true; userId: string; sessionVersion: number }
  | { ok: false; reason: "invalid"; attemptsLeft: number }
  | { ok: false; reason: "removed" };

export async function loginWithPin(cookie: string | undefined, pin: string, deps: AuthDeps = {}): Promise<PinLoginResult> {
  const now = deps.now ?? new Date();
  const d = await findDevice(cookie, now);
  if (!d) return { ok: false, reason: "removed" };

  // Reserve the attempt BEFORE checking, in one statement, so ten parallel guesses still count as ten.
  const reserved = await db.$queryRaw<{ pinFailures: number }[]>`
    UPDATE "TrustedDevice" SET "pinFailures" = "pinFailures" + 1
     WHERE "id" = ${d.id} AND "pinFailures" < ${MAX_PIN_FAILURES}
 RETURNING "pinFailures"`;
  if (reserved.length !== 1) {
    await db.trustedDevice.deleteMany({ where: { id: d.id } });
    return { ok: false, reason: "removed" };
  }
  const used = reserved[0]!.pinFailures;

  if (!/^\d{4}$/.test(pin) || !(await verifyPassword(pin, d.user.pinHash!))) {
    if (used >= MAX_PIN_FAILURES) {
      await db.trustedDevice.deleteMany({ where: { id: d.id } });
      await audit(d.userId, "auth.device_removed_pin_failures", { label: d.label });
      return { ok: false, reason: "removed" };
    }
    return { ok: false, reason: "invalid", attemptsLeft: MAX_PIN_FAILURES - used };
  }

  await db.trustedDevice.update({ where: { id: d.id }, data: { pinFailures: 0, lastUsedAt: now, expiresAt: new Date(now.getTime() + DEVICE_TTL_MS) } });
  await audit(d.userId, "auth.pin_login", { label: d.label });
  return { ok: true, userId: d.userId, sessionVersion: d.user.sessionVersion };
}

export async function listDevices(userId: string) {
  return db.trustedDevice.findMany({
    where: { userId, expiresAt: { gt: new Date() } },
    orderBy: { lastUsedAt: "desc" },
    select: { id: true, label: true, createdAt: true, lastUsedAt: true },
  });
}

export async function revokeDevice(userId: string, deviceId: string): Promise<void> {
  const r = await db.trustedDevice.deleteMany({ where: { id: deviceId, userId } });
  if (r.count) await audit(userId, "auth.device_removed", { deviceId });
}

export async function revokeAllDevices(userId: string): Promise<void> {
  await db.trustedDevice.deleteMany({ where: { userId } });
}

/** Which of this owner's devices a cookie belongs to, if it is one of theirs and still valid. */
export async function deviceIdFor(userId: string, cookie: string | undefined, now = new Date()): Promise<string | null> {
  const d = await findDevice(cookie, now);
  return d && d.userId === userId ? d.id : null;
}
