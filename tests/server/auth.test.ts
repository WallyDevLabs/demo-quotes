import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { base32Decode, hashPassword, totpCode, totpStepAt } from "@/server/auth/crypto";
import {
  authenticate,
  beginEnrollment,
  changePassword,
  confirmEnrollment,
  finishEnrollment,
  GENERIC_LOGIN_ERROR,
  login,
  MAX_ACCOUNT_FAILURES,
  MAX_IP_FAILURES,
  ownerExists,
  regenerateRecoveryCodes,
  setupOwner,
  signOutEverywhere,
  WINDOW_MS,
} from "@/server/auth/service";
import { signSession } from "@/server/auth/session";

// These tests create and delete real owners. They run only against a database whose name ends in
// "_test" (npm run test:db) or in CI, never against your working database.
const dbName = new URL(process.env.DATABASE_URL!).pathname.replace(/^\//, "");
if (!/_test$/.test(dbName) && !process.env.CI) {
  throw new Error(`Refusing to run auth tests against "${dbName}". Run "npm run test:db" and set TEST_DATABASE_URL.`);
}

const SECRET = process.env.AUTH_SECRET!;
const T0 = new Date("2026-10-13T08:00:00Z");
const at = (secondsAfter: number) => new Date(T0.getTime() + secondsAfter * 1000);
const PASSWORD = "a perfectly fine passphrase";
const EMAIL = "owner@example.com";
const dev = { requireToken: false } as const;

beforeEach(async () => {
  await db.user.deleteMany({ where: { OR: [{ passwordHash: { startsWith: "scrypt$" } }, { passwordHash: { startsWith: "!" } }] } });
  await db.authAttempt.deleteMany({});
});

/** A fully enrolled owner. `secret` lets a test compute valid authenticator codes. */
async function makeOwner(email = EMAIL) {
  const { userId } = await setupOwner({ email, password: PASSWORD }, dev, { now: T0 });
  const { secret } = await beginEnrollment(userId);
  const buf = base32Decode(secret);
  const codeAt = (d: Date) => totpCode(buf, totpStepAt(d.getTime()));
  const { recoveryCodes } = await confirmEnrollment(userId, codeAt(T0), { now: T0 });
  return { userId, secret, buf, recoveryCodes, codeAt };
}

describe("first run setup", () => {
  it("creates the one owner, and only once", async () => {
    expect(await ownerExists()).toBe(false);
    const { userId } = await setupOwner({ email: " Owner@Example.com ", password: PASSWORD }, dev);
    expect(await ownerExists()).toBe(true);
    const u = await db.user.findUniqueOrThrow({ where: { id: userId } });
    expect(u.email).toBe("owner@example.com");
    expect(u.passwordHash).toMatch(/^scrypt\$/);
    expect(u.passwordHash).not.toContain(PASSWORD);
    await expect(setupOwner({ email: "second@example.com", password: PASSWORD }, dev)).rejects.toThrow(/already exists/);
  });

  it("two setups at the same moment: exactly one succeeds", async () => {
    const results = await Promise.allSettled([
      setupOwner({ email: "a@example.com", password: PASSWORD }, dev),
      setupOwner({ email: "b@example.com", password: PASSWORD }, dev),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.user.count({ where: { passwordHash: { startsWith: "scrypt$" } } })).toBe(1);
  }, 30_000);

  it("claims the placeholder owner from before sign-in existed, keeping its data", async () => {
    const ph = await db.user.create({ data: { email: "owner@local.invalid", passwordHash: "!unset" } });
    await db.businessSettings.create({ data: { ownerId: ph.id, legalName: "Katlego Barayi" } });
    const { userId } = await setupOwner({ email: EMAIL, password: PASSWORD }, dev);
    expect(userId).toBe(ph.id);
    expect((await db.businessSettings.findUniqueOrThrow({ where: { ownerId: ph.id } })).legalName).toBe("Katlego Barayi");
    expect(await db.user.count({ where: { id: ph.id, email: EMAIL } })).toBe(1);
  });

  it("rejects a weak password and a bad email with the field named", async () => {
    await expect(setupOwner({ email: EMAIL, password: "short" }, dev)).rejects.toMatchObject({ issues: [{ path: "password" }] });
    await expect(setupOwner({ email: "nope", password: PASSWORD }, dev)).rejects.toMatchObject({ issues: [{ path: "email" }] });
    expect(await ownerExists()).toBe(false);
  });

  it("in production needs the setup token, so the first visitor to a new deployment cannot claim it", async () => {
    const prod = (token?: string) => setupOwner({ email: EMAIL, password: PASSWORD, setupToken: token }, { requireToken: true, expectedToken: "s3cret-token" });
    await expect(setupOwner({ email: EMAIL, password: PASSWORD }, { requireToken: true })).rejects.toThrow(/SETUP_TOKEN/);
    await expect(prod(undefined)).rejects.toMatchObject({ issues: [{ path: "setupToken" }] });
    await expect(prod("wrong-token")).rejects.toMatchObject({ issues: [{ path: "setupToken" }] });
    expect(await ownerExists()).toBe(false);
    await expect(prod("s3cret-token")).resolves.toBeDefined();
  });

  it("limits repeated wrong setup tokens", async () => {
    const bad = () => setupOwner({ email: EMAIL, password: PASSWORD, setupToken: "x" }, { requireToken: true, expectedToken: "right", ip: "9.9.9.9" }, { now: T0 });
    for (let i = 0; i < 10; i++) await expect(bad()).rejects.toThrow();
    await expect(setupOwner({ email: EMAIL, password: PASSWORD, setupToken: "right" }, { requireToken: true, expectedToken: "right", ip: "9.9.9.9" }, { now: T0 })).rejects.toThrow(/Too many/);
  }, 30_000);
});

describe("second factor enrolment (required)", () => {
  it("keeps the same secret until confirmed, stores it encrypted, and refuses a wrong code", async () => {
    const { userId } = await setupOwner({ email: EMAIL, password: PASSWORD }, dev);
    const a = await beginEnrollment(userId);
    const b = await beginEnrollment(userId);
    expect(b.secret).toBe(a.secret);
    expect(a.uri).toContain(`secret=${a.secret}`);
    const row = await db.user.findUniqueOrThrow({ where: { id: userId } });
    expect(row.totpSecretEnc).not.toContain(a.secret);
    expect(row.totpEnabledAt).toBeNull();
    await expect(confirmEnrollment(userId, "000000", { now: T0 })).rejects.toMatchObject({ issues: [{ path: "code" }] });
    expect((await db.user.findUniqueOrThrow({ where: { id: userId } })).totpEnabledAt).toBeNull();
  });

  it("switches the second factor on with a correct code and returns eight recovery codes once, stored only as hashes", async () => {
    const o = await makeOwner();
    expect(o.recoveryCodes).toHaveLength(8);
    const row = await db.user.findUniqueOrThrow({ where: { id: o.userId } });
    expect(row.totpEnabledAt).not.toBeNull();
    expect(row.recoveryCodeHashes).toHaveLength(8);
    for (const c of o.recoveryCodes) expect(JSON.stringify(row)).not.toContain(c);
    await expect(beginEnrollment(o.userId)).rejects.toThrow(/already set up/);
    expect(await db.auditLog.count({ where: { ownerId: o.userId, action: "auth.enroll_2fa" } })).toBe(1);
  });

  it("limits repeated wrong enrolment codes", async () => {
    const { userId } = await setupOwner({ email: EMAIL, password: PASSWORD }, dev);
    await beginEnrollment(userId);
    for (let i = 0; i < MAX_ACCOUNT_FAILURES; i++) await expect(confirmEnrollment(userId, "000000", { now: T0 })).rejects.toThrow(/not correct/);
    await expect(confirmEnrollment(userId, "000000", { now: T0 })).rejects.toThrow(/Too many/);
  });
});

describe("signing in", () => {
  it("needs the password AND a valid authenticator code", async () => {
    const o = await makeOwner();
    const now = at(60);
    const r = await login({ email: EMAIL, password: PASSWORD, code: o.codeAt(now) }, {}, { now });
    expect(r).toMatchObject({ ok: true, userId: o.userId, stage: "full" });
  });

  it("gives the same answer for a wrong password, a wrong code, and an unknown email", async () => {
    const o = await makeOwner();
    const now = at(60);
    const wrongPassword = await login({ email: EMAIL, password: "not the password", code: o.codeAt(now) }, {}, { now });
    const wrongCode = await login({ email: EMAIL, password: PASSWORD, code: "000000" }, {}, { now });
    const unknown = await login({ email: "nobody@example.com", password: PASSWORD, code: o.codeAt(now) }, {}, { now });
    expect(wrongPassword).toEqual({ ok: false, reason: "invalid" });
    expect(wrongCode).toEqual(wrongPassword);
    expect(unknown).toEqual(wrongPassword);
    // The message never singles out which part was wrong: it names all three.
    for (const part of ["email", "password", "code"]) expect(GENERIC_LOGIN_ERROR).toContain(part);
  });

  it("does not accept the same authenticator code twice (replay)", async () => {
    const o = await makeOwner();
    const now = at(60);
    const code = o.codeAt(now);
    expect(await login({ email: EMAIL, password: PASSWORD, code }, {}, { now })).toMatchObject({ ok: true });
    expect(await login({ email: EMAIL, password: PASSWORD, code }, {}, { now })).toEqual({ ok: false, reason: "invalid" });
    // The code used to confirm enrolment cannot be replayed to sign in either.
    expect(await login({ email: EMAIL, password: PASSWORD, code: o.codeAt(T0) }, {}, { now: T0 })).toEqual({ ok: false, reason: "invalid" });
  });

  it("two simultaneous sign-ins with one code: only one gets in", async () => {
    const o = await makeOwner();
    const now = at(90);
    const code = o.codeAt(now);
    const results = await Promise.all([1, 2, 3].map(() => login({ email: EMAIL, password: PASSWORD, code }, {}, { now })));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });

  it("accepts each recovery code once", async () => {
    const o = await makeOwner();
    const code = o.recoveryCodes[0]!;
    const now = at(60);
    expect(await login({ email: EMAIL, password: PASSWORD, code: code.toLowerCase() }, {}, { now })).toMatchObject({ ok: true, stage: "full" });
    expect(await login({ email: EMAIL, password: PASSWORD, code }, {}, { now })).toEqual({ ok: false, reason: "invalid" });
    expect((await db.user.findUniqueOrThrow({ where: { id: o.userId } })).recoveryCodeHashes).toHaveLength(7);
    expect(await login({ email: EMAIL, password: PASSWORD, code: o.recoveryCodes[1]! }, {}, { now })).toMatchObject({ ok: true });
    expect(await db.auditLog.count({ where: { ownerId: o.userId, action: "auth.recovery_code_used" } })).toBe(2);
  });

  it("a correct password without a second factor only earns the restricted enrolment session", async () => {
    const { userId } = await setupOwner({ email: EMAIL, password: PASSWORD }, dev);
    const r = await login({ email: EMAIL, password: PASSWORD, code: "" }, {}, { now: T0 });
    expect(r).toMatchObject({ ok: true, userId, stage: "enroll" });
  });

  it("locks an account after repeated failures, even for the right credentials, then recovers after the window", async () => {
    const o = await makeOwner();
    const now = at(60);
    for (let i = 0; i < MAX_ACCOUNT_FAILURES; i++) {
      expect(await login({ email: EMAIL, password: "wrong password here", code: "000000" }, { ip: "1.1.1.1" }, { now })).toEqual({ ok: false, reason: "invalid" });
    }
    const locked = await login({ email: EMAIL, password: PASSWORD, code: o.codeAt(now) }, { ip: "1.1.1.1" }, { now });
    expect(locked).toMatchObject({ ok: false, reason: "locked" });
    expect((locked as { retryAfterSeconds: number }).retryAfterSeconds).toBeGreaterThan(0);
    expect((locked as { retryAfterSeconds: number }).retryAfterSeconds).toBeLessThanOrEqual(WINDOW_MS / 1000);

    const later = new Date(now.getTime() + WINDOW_MS + 1000);
    expect(await login({ email: EMAIL, password: PASSWORD, code: o.codeAt(later) }, { ip: "1.1.1.1" }, { now: later })).toMatchObject({ ok: true });
  }, 30_000);

  it("locks the same way for an unknown email, so nothing reveals which accounts exist", async () => {
    const now = at(60);
    for (let i = 0; i < MAX_ACCOUNT_FAILURES; i++) await login({ email: "ghost@example.com", password: "whatever password", code: "000000" }, {}, { now });
    expect(await login({ email: "ghost@example.com", password: "whatever password", code: "000000" }, {}, { now })).toMatchObject({ ok: false, reason: "locked" });
  }, 30_000);

  it("limits one address that tries many different accounts", async () => {
    const now = at(60);
    for (let i = 0; i < MAX_IP_FAILURES; i++) await login({ email: `user${i}@example.com`, password: "whatever password", code: "000000" }, { ip: "6.6.6.6" }, { now });
    expect(await login({ email: "fresh@example.com", password: "whatever password", code: "000000" }, { ip: "6.6.6.6" }, { now })).toMatchObject({ ok: false, reason: "locked" });
    expect(await login({ email: "fresh@example.com", password: "whatever password", code: "000000" }, { ip: "7.7.7.7" }, { now })).toEqual({ ok: false, reason: "invalid" });
  }, 60_000);

  it("a successful sign in clears that account's failures", async () => {
    const o = await makeOwner();
    const now = at(60);
    for (let i = 0; i < MAX_ACCOUNT_FAILURES - 1; i++) await login({ email: EMAIL, password: "wrong password here", code: "000000" }, {}, { now });
    expect(await login({ email: EMAIL, password: PASSWORD, code: o.codeAt(now) }, {}, { now })).toMatchObject({ ok: true });
    expect(await db.authAttempt.count({ where: { key: `acct:${EMAIL}` } })).toBe(0);
  }, 30_000);

  it("logs sign ins to the audit log without any email, password or code in it", async () => {
    const o = await makeOwner();
    const now = at(60);
    await login({ email: EMAIL, password: PASSWORD, code: o.codeAt(now) }, {}, { now });
    const logs = await db.auditLog.findMany({ where: { ownerId: o.userId, entity: "auth" } });
    expect(logs.map((l) => l.action)).toEqual(expect.arrayContaining(["auth.setup", "auth.enroll_2fa", "auth.login"]));
    const text = JSON.stringify(logs);
    for (const secret of [EMAIL, PASSWORD, o.secret, o.codeAt(now)]) expect(text).not.toContain(secret);
  });
});

describe("sessions", () => {
  const token = (sub: string, stage: "full" | "enroll", sv: number, when = T0) => signSession({ sub, stage, sv }, SECRET, when.getTime());

  it("a valid token resolves to the owner", async () => {
    const o = await makeOwner();
    const sv = (await db.user.findUniqueOrThrow({ where: { id: o.userId } })).sessionVersion;
    expect(await authenticate(await token(o.userId, "full", sv), { now: at(60) })).toEqual({ userId: o.userId, email: EMAIL, stage: "full" });
  });

  it("rejects an expired, tampered or missing token", async () => {
    const o = await makeOwner();
    const sv = (await db.user.findUniqueOrThrow({ where: { id: o.userId } })).sessionVersion;
    const t = await token(o.userId, "full", sv);
    expect(await authenticate(t, { now: at(13 * 3600) })).toBeNull();
    expect(await authenticate(t.slice(0, -3) + "abc", { now: at(60) })).toBeNull();
    expect(await authenticate(undefined, { now: at(60) })).toBeNull();
  });

  it("signing out everywhere ends every session at once", async () => {
    const o = await makeOwner();
    const sv = (await db.user.findUniqueOrThrow({ where: { id: o.userId } })).sessionVersion;
    const t = await token(o.userId, "full", sv);
    expect(await authenticate(t, { now: at(60) })).not.toBeNull();
    await signOutEverywhere(o.userId);
    expect(await authenticate(t, { now: at(60) })).toBeNull();
  });

  it("stops working when the account is gone", async () => {
    const o = await makeOwner();
    const sv = (await db.user.findUniqueOrThrow({ where: { id: o.userId } })).sessionVersion;
    const t = await token(o.userId, "full", sv);
    await db.user.delete({ where: { id: o.userId } });
    expect(await authenticate(t, { now: at(60) })).toBeNull();
  });

  it("a full session is impossible without an enrolled second factor", async () => {
    const { userId } = await setupOwner({ email: EMAIL, password: PASSWORD }, dev);
    const sv = (await db.user.findUniqueOrThrow({ where: { id: userId } })).sessionVersion;
    expect(await authenticate(await token(userId, "full", sv), { now: at(60) })).toBeNull();
    expect(await authenticate(await token(userId, "enroll", sv), { now: at(60) })).toMatchObject({ stage: "enroll" });
  });

  it("the placeholder account cannot hold a session", async () => {
    const ph = await db.user.create({ data: { email: "owner@local.invalid", passwordHash: "!unset" } });
    expect(await authenticate(await token(ph.id, "full", 0), { now: at(60) })).toBeNull();
  });

  it("changing the password needs the current one, ends other sessions, and the new one works", async () => {
    const o = await makeOwner();
    const sv0 = (await db.user.findUniqueOrThrow({ where: { id: o.userId } })).sessionVersion;
    const old = await token(o.userId, "full", sv0);

    await expect(changePassword(o.userId, { current: "wrong current password", next: "a brand new passphrase" }, { now: at(60) })).rejects.toMatchObject({ issues: [{ path: "current" }] });
    await expect(changePassword(o.userId, { current: PASSWORD, next: "short" }, { now: at(60) })).rejects.toMatchObject({ issues: [{ path: "next" }] });

    const { sessionVersion } = await changePassword(o.userId, { current: PASSWORD, next: "a brand new passphrase" }, { now: at(60) });
    expect(sessionVersion).toBe(sv0 + 1);
    expect(await authenticate(old, { now: at(61) })).toBeNull();
    expect(await authenticate(await token(o.userId, "full", sessionVersion), { now: at(61) })).not.toBeNull();

    const now = at(120);
    expect(await login({ email: EMAIL, password: PASSWORD, code: o.codeAt(now) }, {}, { now })).toEqual({ ok: false, reason: "invalid" });
    expect(await login({ email: EMAIL, password: "a brand new passphrase", code: o.codeAt(at(150)) }, {}, { now: at(150) })).toMatchObject({ ok: true });
    expect(await db.auditLog.count({ where: { ownerId: o.userId, action: "auth.password_change" } })).toBe(1);
  }, 30_000);

  it("limits repeated wrong current passwords", async () => {
    const o = await makeOwner();
    for (let i = 0; i < MAX_ACCOUNT_FAILURES; i++) await expect(changePassword(o.userId, { current: "wrong current password", next: "another new passphrase" }, { now: at(60) })).rejects.toThrow();
    await expect(changePassword(o.userId, { current: PASSWORD, next: "another new passphrase" }, { now: at(60) })).rejects.toThrow(/Too many/);
  }, 30_000);
});

describe("finishing enrolment and recovery codes", () => {
  const tok = (sub: string, stage: "full" | "enroll", sv: number) => signSession({ sub, stage, sv }, SECRET, T0.getTime());

  it("confirming does not end the restricted session, so the recovery codes can be shown before the owner continues", async () => {
    const { userId } = await setupOwner({ email: EMAIL, password: PASSWORD }, dev);
    const { secret } = await beginEnrollment(userId);
    const sv = (await db.user.findUniqueOrThrow({ where: { id: userId } })).sessionVersion;
    const enrollToken = await tok(userId, "enroll", sv);
    await confirmEnrollment(userId, totpCode(base32Decode(secret), totpStepAt(T0.getTime())), { now: T0 });
    expect((await db.user.findUniqueOrThrow({ where: { id: userId } })).sessionVersion).toBe(sv);
    expect(await authenticate(enrollToken, { now: at(60) })).toMatchObject({ stage: "enroll" });
  });

  it("finishing ends every earlier session, including the restricted one, and returns the new version", async () => {
    const { userId } = await setupOwner({ email: EMAIL, password: PASSWORD }, dev);
    const { secret } = await beginEnrollment(userId);
    await confirmEnrollment(userId, totpCode(base32Decode(secret), totpStepAt(T0.getTime())), { now: T0 });
    const sv = (await db.user.findUniqueOrThrow({ where: { id: userId } })).sessionVersion;
    const enrollToken = await tok(userId, "enroll", sv);
    const next = await finishEnrollment(userId);
    expect(next).toBe(sv + 1);
    expect(await authenticate(enrollToken, { now: at(60) })).toBeNull();
    expect(await authenticate(await tok(userId, "full", next), { now: at(60) })).toMatchObject({ stage: "full" });
  });

  it("cannot finish before the authenticator code has been confirmed", async () => {
    const { userId } = await setupOwner({ email: EMAIL, password: PASSWORD }, dev);
    await expect(finishEnrollment(userId)).rejects.toThrow(/Confirm the code/);
  });

  it("regenerating recovery codes needs the password, replaces every old code, and is audited", async () => {
    const o = await makeOwner();
    await expect(regenerateRecoveryCodes(o.userId, "not my password", { now: at(60) })).rejects.toMatchObject({ issues: [{ path: "password" }] });
    const { recoveryCodes } = await regenerateRecoveryCodes(o.userId, PASSWORD, { now: at(60) });
    expect(recoveryCodes).toHaveLength(8);
    const now = at(120);
    expect(await login({ email: EMAIL, password: PASSWORD, code: o.recoveryCodes[0]! }, {}, { now })).toEqual({ ok: false, reason: "invalid" });
    expect(await login({ email: EMAIL, password: PASSWORD, code: recoveryCodes[0]! }, {}, { now })).toMatchObject({ ok: true });
    const text = JSON.stringify(await db.auditLog.findMany({ where: { ownerId: o.userId } }));
    expect(text).toContain("auth.recovery_codes_regenerated");
    for (const c of recoveryCodes) expect(text).not.toContain(c);
  }, 30_000);

  it("limits repeated wrong passwords when regenerating", async () => {
    const o = await makeOwner();
    for (let i = 0; i < MAX_ACCOUNT_FAILURES; i++) await expect(regenerateRecoveryCodes(o.userId, "wrong password here", { now: at(60) })).rejects.toThrow();
    await expect(regenerateRecoveryCodes(o.userId, PASSWORD, { now: at(60) })).rejects.toThrow(/Too many/);
  }, 30_000);
});

// Silence "unused" for helpers kept for readability.
void hashPassword;
