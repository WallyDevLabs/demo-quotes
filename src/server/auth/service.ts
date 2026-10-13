import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { db } from "../db";
import { ServiceError } from "../errors";
import {
  burnPasswordTime,
  decryptSecret,
  encryptSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  hashPassword,
  hashRecoveryCode,
  looksLikeRecoveryCode,
  otpauthUri,
  passwordProblem,
  verifyPassword,
  verifyTotp,
} from "./crypto";
import { authSecret, verifySession, type SessionStage } from "./session";

/**
 * One owner, no roles, and a required second factor. Everything that decides who is signed in lives
 * here so it can be tested without a browser. Messages never say whether the email, the password or the
 * code was wrong, and nothing here logs an email, a password or a code.
 */

export const WINDOW_MS = 15 * 60 * 1000;
export const MAX_ACCOUNT_FAILURES = 5;
export const MAX_IP_FAILURES = 20;
export const GENERIC_LOGIN_ERROR = "That email, password or code is not correct.";

export interface AuthDeps {
  now?: Date;
  secret?: string;
}

const emailSchema = z.string().trim().toLowerCase().email("Enter a valid email address").max(200);
const isRealHash = (h: string) => h.startsWith("scrypt$");

async function audit(ownerId: string, action: string, detail?: object) {
  await db.auditLog.create({ data: { ownerId, entity: "auth", entityId: ownerId, action, detail: detail as never } });
}

// ---------------------------------------------------------------------------------------------
// Rate limiting (kept in the database so it holds across serverless instances)
// ---------------------------------------------------------------------------------------------

export interface Limit {
  key: string;
  max: number;
}

/** When the oldest counted failure drops out of the window, if the key is currently locked. */
export async function lockedUntil(limits: Limit[], now: Date): Promise<Date | null> {
  let until: Date | null = null;
  for (const l of limits) {
    const recent = await db.authAttempt.findMany({
      where: { key: l.key, createdAt: { gt: new Date(now.getTime() - WINDOW_MS) } },
      orderBy: { createdAt: "desc" },
      take: l.max,
    });
    if (recent.length >= l.max) {
      const t = new Date(recent[l.max - 1]!.createdAt.getTime() + WINDOW_MS);
      if (!until || t > until) until = t;
    }
  }
  return until;
}

export async function recordFailure(limits: Limit[], now: Date) {
  await db.authAttempt.createMany({ data: limits.map((l) => ({ key: l.key, createdAt: now })) });
  // Housekeeping: attempts older than a day are of no use.
  await db.authAttempt.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 24 * 60 * 60 * 1000) } } });
}

const limitsFor = (email: string, ip: string | undefined): Limit[] => [
  { key: `acct:${email}`, max: MAX_ACCOUNT_FAILURES },
  { key: `ip:${ip ?? "unknown"}`, max: MAX_IP_FAILURES },
];

// ---------------------------------------------------------------------------------------------
// First-run setup
// ---------------------------------------------------------------------------------------------

export async function ownerExists(): Promise<boolean> {
  const n = await db.user.count({ where: { passwordHash: { startsWith: "scrypt$" } } });
  return n > 0;
}

export interface SetupOptions {
  /** In production a setup token is required, so the first visitor to a new deployment cannot claim it. */
  requireToken: boolean;
  expectedToken?: string;
  ip?: string;
}

function tokenMatches(given: string | undefined, expected: string | undefined): boolean {
  if (!given || !expected) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Creates the one owner account. If this machine already holds data from before sign-in existed (the
 * placeholder owner), that account is claimed so nothing is lost. Setup is possible exactly once.
 */
export async function setupOwner(
  input: { email: string; password: string; setupToken?: string },
  opts: SetupOptions,
  deps: AuthDeps = {},
): Promise<{ userId: string }> {
  const now = deps.now ?? new Date();
  const ipLimit: Limit[] = [{ key: `setup:${opts.ip ?? "unknown"}`, max: 10 }];
  if (await lockedUntil(ipLimit, now)) throw new ServiceError("Too many attempts. Try again later.");

  if (opts.requireToken) {
    if (!opts.expectedToken) {
      throw new ServiceError("Setup is disabled: set SETUP_TOKEN on the server to create the owner account.");
    }
    if (!tokenMatches(input.setupToken, opts.expectedToken)) {
      await recordFailure(ipLimit, now);
      throw new ServiceError("The setup token is not correct.", [{ path: "setupToken", message: "That setup token is not correct" }]);
    }
  }

  const email = emailSchema.safeParse(input.email);
  if (!email.success) throw new ServiceError("Some fields need attention.", [{ path: "email", message: email.error.issues[0]!.message }]);
  const problem = passwordProblem(input.password, email.data);
  if (problem) throw new ServiceError("Some fields need attention.", [{ path: "password", message: problem }]);

  const passwordHash = await hashPassword(input.password);
  return db.$transaction(async (tx) => {
    // Two setups at the same moment: only one can pass this lock and the check below.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(724001)`;
    const existing = await tx.user.count({ where: { passwordHash: { startsWith: "scrypt$" } } });
    if (existing > 0) throw new ServiceError("An owner account already exists. Sign in instead.");

    const placeholder = await tx.user.findFirst({ where: { passwordHash: { startsWith: "!" } }, orderBy: { createdAt: "asc" } });
    const user = placeholder
      ? await tx.user.update({ where: { id: placeholder.id }, data: { email: email.data, passwordHash, totpSecretEnc: null, totpEnabledAt: null, totpLastStep: null, recoveryCodeHashes: [] } })
      : await tx.user.create({ data: { email: email.data, passwordHash } });
    await tx.auditLog.create({ data: { ownerId: user.id, entity: "auth", entityId: user.id, action: "auth.setup", detail: { claimedExistingData: !!placeholder } } });
    return { userId: user.id };
  });
}

// ---------------------------------------------------------------------------------------------
// Second factor enrolment (required before a full session is possible)
// ---------------------------------------------------------------------------------------------

/** The secret stays the same until it is confirmed, so reloading the page does not invalidate the QR code. */
export async function beginEnrollment(userId: string, deps: AuthDeps = {}): Promise<{ secret: string; uri: string; email: string }> {
  const secret = deps.secret ?? authSecret();
  const u = await db.user.findUnique({ where: { id: userId } });
  if (!u) throw new ServiceError("Account not found.");
  if (u.totpEnabledAt) throw new ServiceError("Two-factor authentication is already set up.");
  let b32: string;
  if (u.totpSecretEnc) {
    b32 = decryptSecret(u.totpSecretEnc, secret);
  } else {
    b32 = generateTotpSecret();
    await db.user.update({ where: { id: userId }, data: { totpSecretEnc: encryptSecret(b32, secret) } });
  }
  return { secret: b32, uri: otpauthUri(b32, u.email), email: u.email };
}

/** Confirms the first code from the authenticator app, switches the second factor on, and returns the recovery codes ONCE. */
export async function confirmEnrollment(userId: string, code: string, deps: AuthDeps = {}): Promise<{ recoveryCodes: string[] }> {
  const now = deps.now ?? new Date();
  const secret = deps.secret ?? authSecret();
  const limits: Limit[] = [{ key: `enroll:${userId}`, max: MAX_ACCOUNT_FAILURES }];
  if (await lockedUntil(limits, now)) throw new ServiceError("Too many attempts. Wait a few minutes and try again.");

  const u = await db.user.findUnique({ where: { id: userId } });
  if (!u || !u.totpSecretEnc) throw new ServiceError("Start the setup again.");
  if (u.totpEnabledAt) throw new ServiceError("Two-factor authentication is already set up.");

  const step = verifyTotp(decryptSecret(u.totpSecretEnc, secret), code, now.getTime(), null);
  if (step === null) {
    await recordFailure(limits, now);
    throw new ServiceError("That code is not correct. Check the time on your phone and try the next code.", [{ path: "code", message: "That code is not correct" }]);
  }
  const recoveryCodes = generateRecoveryCodes();
  await db.user.update({
    where: { id: userId },
    data: { totpEnabledAt: now, totpLastStep: step, recoveryCodeHashes: recoveryCodes.map(hashRecoveryCode) },
  });
  await audit(userId, "auth.enroll_2fa");
  return { recoveryCodes };
}

export async function isEnrolled(userId: string): Promise<boolean> {
  const u = await db.user.findUnique({ where: { id: userId }, select: { totpEnabledAt: true } });
  return !!u?.totpEnabledAt;
}

/**
 * Called when the owner has seen and saved the recovery codes. Ends every earlier session (including the
 * restricted enrolment one) and returns the version for the new full session.
 */
export async function finishEnrollment(userId: string): Promise<number> {
  if (!(await isEnrolled(userId))) throw new ServiceError("Confirm the code from your authenticator app first.");
  const u = await db.user.update({ where: { id: userId }, data: { sessionVersion: { increment: 1 } }, select: { sessionVersion: true } });
  return u.sessionVersion;
}

/** Replaces all recovery codes with a fresh set (shown once). The old ones stop working. Needs the password. */
export async function regenerateRecoveryCodes(userId: string, password: string, deps: AuthDeps = {}): Promise<{ recoveryCodes: string[] }> {
  const now = deps.now ?? new Date();
  const limits: Limit[] = [{ key: `pw:${userId}`, max: MAX_ACCOUNT_FAILURES }];
  if (await lockedUntil(limits, now)) throw new ServiceError("Too many attempts. Wait a few minutes and try again.");
  const u = await db.user.findUnique({ where: { id: userId } });
  if (!u || !u.totpEnabledAt) throw new ServiceError("Two-factor authentication is not set up.");
  if (!(await verifyPassword(password, u.passwordHash))) {
    await recordFailure(limits, now);
    throw new ServiceError("Some fields need attention.", [{ path: "password", message: "That is not your password" }]);
  }
  const recoveryCodes = generateRecoveryCodes();
  await db.user.update({ where: { id: userId }, data: { recoveryCodeHashes: recoveryCodes.map(hashRecoveryCode) } });
  await audit(userId, "auth.recovery_codes_regenerated");
  return { recoveryCodes };
}

// ---------------------------------------------------------------------------------------------
// Sign in
// ---------------------------------------------------------------------------------------------

export type LoginResult =
  | { ok: true; userId: string; stage: SessionStage; sessionVersion: number }
  | { ok: false; reason: "invalid" }
  | { ok: false; reason: "locked"; retryAfterSeconds: number };

async function consumeRecoveryCode(userId: string, code: string): Promise<boolean> {
  const hash = hashRecoveryCode(code);
  // One statement: removes the code only if it is still there, so a code works once even if tried twice at once.
  const n = await db.$executeRaw`
    UPDATE "User" SET "recoveryCodeHashes" = array_remove("recoveryCodeHashes", ${hash})
     WHERE "id" = ${userId} AND ${hash} = ANY("recoveryCodeHashes")`;
  return n === 1;
}

export async function login(
  input: { email: string; password: string; code: string },
  ctx: { ip?: string } = {},
  deps: AuthDeps = {},
): Promise<LoginResult> {
  const now = deps.now ?? new Date();
  const secret = deps.secret ?? authSecret();
  const email = input.email.trim().toLowerCase().slice(0, 200);
  const limits = limitsFor(email, ctx.ip);

  const locked = await lockedUntil(limits, now);
  if (locked) return { ok: false, reason: "locked", retryAfterSeconds: Math.max(1, Math.ceil((locked.getTime() - now.getTime()) / 1000)) };

  const fail = async (): Promise<LoginResult> => {
    await recordFailure(limits, now);
    return { ok: false, reason: "invalid" };
  };

  const user = await db.user.findUnique({ where: { email } });
  if (!user || !isRealHash(user.passwordHash)) {
    await burnPasswordTime(input.password);
    return fail();
  }
  if (!(await verifyPassword(input.password, user.passwordHash))) return fail();

  // A correct password with no second factor yet only earns the restricted enrolment session.
  if (!user.totpEnabledAt || !user.totpSecretEnc) {
    return { ok: true, userId: user.id, stage: "enroll", sessionVersion: user.sessionVersion };
  }

  if (looksLikeRecoveryCode(input.code)) {
    if (!(await consumeRecoveryCode(user.id, input.code))) return fail();
    await audit(user.id, "auth.recovery_code_used");
  } else {
    const step = verifyTotp(decryptSecret(user.totpSecretEnc, secret), input.code, now.getTime(), user.totpLastStep);
    if (step === null) return fail();
    // Record the step atomically: a second request carrying the same code finds it already used.
    const claimed = await db.user.updateMany({
      where: { id: user.id, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] },
      data: { totpLastStep: step },
    });
    if (claimed.count !== 1) return fail();
  }

  await db.authAttempt.deleteMany({ where: { key: `acct:${email}` } });
  await audit(user.id, "auth.login");
  return { ok: true, userId: user.id, stage: "full", sessionVersion: user.sessionVersion };
}

// ---------------------------------------------------------------------------------------------
// Session checks (every action and route)
// ---------------------------------------------------------------------------------------------

export interface ActiveSession {
  userId: string;
  email: string;
  stage: SessionStage;
}

/**
 * The authoritative check behind the signed cookie: the signature and expiry, then the database. A token
 * stops working the moment the user is gone, the session version changes, or (for a full session) the
 * second factor is not enrolled.
 */
export async function authenticate(token: string | undefined, deps: AuthDeps = {}): Promise<ActiveSession | null> {
  const claims = await verifySession(token, deps.secret ?? authSecret(), (deps.now ?? new Date()).getTime());
  if (!claims) return null;
  const u = await db.user.findUnique({ where: { id: claims.sub }, select: { id: true, email: true, sessionVersion: true, totpEnabledAt: true, passwordHash: true } });
  if (!u || !isRealHash(u.passwordHash) || u.sessionVersion !== claims.sv) return null;
  if (claims.stage === "full" && !u.totpEnabledAt) return null;
  return { userId: u.id, email: u.email, stage: claims.stage };
}

/** Ends every session at once. */
export async function signOutEverywhere(userId: string): Promise<number> {
  const u = await db.user.update({ where: { id: userId }, data: { sessionVersion: { increment: 1 } }, select: { sessionVersion: true } });
  // Trusted devices go too: a lost phone must not be able to sign back in with the PIN.
  await db.trustedDevice.deleteMany({ where: { userId } });
  await audit(userId, "auth.sign_out_everywhere");
  return u.sessionVersion;
}

export async function changePassword(
  userId: string,
  input: { current: string; next: string },
  deps: AuthDeps = {},
): Promise<{ sessionVersion: number }> {
  const now = deps.now ?? new Date();
  const limits: Limit[] = [{ key: `pw:${userId}`, max: MAX_ACCOUNT_FAILURES }];
  if (await lockedUntil(limits, now)) throw new ServiceError("Too many attempts. Wait a few minutes and try again.");
  const u = await db.user.findUnique({ where: { id: userId } });
  if (!u) throw new ServiceError("Account not found.");
  if (!(await verifyPassword(input.current, u.passwordHash))) {
    await recordFailure(limits, now);
    throw new ServiceError("Some fields need attention.", [{ path: "current", message: "That is not your current password" }]);
  }
  const problem = passwordProblem(input.next, u.email);
  if (problem) throw new ServiceError("Some fields need attention.", [{ path: "next", message: problem }]);
  const updated = await db.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(input.next), sessionVersion: { increment: 1 } },
    select: { sessionVersion: true },
  });
  await db.trustedDevice.deleteMany({ where: { userId } });
  await audit(userId, "auth.password_change");
  return { sessionVersion: updated.sessionVersion };
}
