import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { base32Decode, totpCode, totpStepAt } from "@/server/auth/crypto";
import {
  deviceIdFor,
  DEVICE_TTL_MS,
  hasPin,
  listDevices,
  loginWithPin,
  MAX_PIN_FAILURES,
  pinProblem,
  pinStatus,
  revokeAllDevices,
  revokeDevice,
  setPin,
  trustDevice,
} from "@/server/auth/pin";
import { beginEnrollment, changePassword, confirmEnrollment, setupOwner, signOutEverywhere } from "@/server/auth/service";
import { sessionTtl, TRUSTED_SESSION_TTL_SECONDS, SESSION_TTL_SECONDS } from "@/server/auth/session";

const dbName = new URL(process.env.DATABASE_URL!).pathname.replace(/^\//, "");
if (!/_test$/.test(dbName) && !process.env.CI) {
  throw new Error(`Refusing to run auth tests against "${dbName}". Run "npm run test:db" and set TEST_DATABASE_URL.`);
}

const T0 = new Date("2026-10-13T08:00:00Z");
const PASSWORD = "a perfectly fine passphrase";
const PIN = "2580";

beforeEach(async () => {
  await db.user.deleteMany({ where: { OR: [{ passwordHash: { startsWith: "scrypt$" } }, { passwordHash: { startsWith: "!" } }] } });
  await db.authAttempt.deleteMany({});
});

async function makeOwner() {
  const { userId } = await setupOwner({ email: "owner@example.com", password: PASSWORD }, { requireToken: false }, { now: T0 });
  const { secret } = await beginEnrollment(userId);
  await confirmEnrollment(userId, totpCode(base32Decode(secret), totpStepAt(T0.getTime())), { now: T0 });
  return userId;
}

/** An owner with a PIN and one trusted device; returns the device cookie value. */
async function trusted() {
  const userId = await makeOwner();
  await setPin(userId, { pin: PIN, password: PASSWORD }, { now: T0 });
  const cookie = await trustDevice(userId, "Chrome on Windows", { now: T0 });
  return { userId, cookie };
}

describe("choosing a PIN", () => {
  it("needs exactly four digits and refuses the obvious ones", () => {
    expect(pinProblem("2580")).toBeNull();
    for (const bad of ["123", "12345", "abcd", "12 4", "", "0000", "7777", "1234", "4321"]) expect(pinProblem(bad), bad).not.toBeNull();
  });

  it("is stored hashed, and needs the password", async () => {
    const userId = await makeOwner();
    await expect(setPin(userId, { pin: PIN, password: "wrong password here" })).rejects.toThrow(/Some fields need attention/);
    expect(await hasPin(userId)).toBe(false);
    await setPin(userId, { pin: PIN, password: PASSWORD });
    const u = await db.user.findUniqueOrThrow({ where: { id: userId } });
    expect(u.pinHash).toMatch(/^scrypt\$/);
    expect(u.pinHash).not.toContain(PIN);
  });

  it("rejects a bad PIN with a field error", async () => {
    const userId = await makeOwner();
    await expect(setPin(userId, { pin: "1111", password: PASSWORD })).rejects.toMatchObject({ issues: [{ path: "pin" }] });
  });
});

describe("signing in with the PIN on a trusted device", () => {
  it("works with the right PIN and no authenticator code", async () => {
    const { userId, cookie } = await trusted();
    expect(await pinStatus(cookie, { now: T0 })).toEqual({ email: "owner@example.com" });
    const r = await loginWithPin(cookie, PIN, { now: T0 });
    expect(r).toMatchObject({ ok: true, userId });
    expect(await db.auditLog.count({ where: { ownerId: userId, action: "auth.pin_login" } })).toBe(1);
  });

  it("stores only a hash of the device secret", async () => {
    const { cookie } = await trusted();
    const secret = cookie.split(".")[1]!;
    const d = await db.trustedDevice.findFirstOrThrow();
    expect(d.tokenHash).not.toContain(secret);
    expect(d.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is useless without a valid device cookie, whatever the PIN", async () => {
    const { cookie } = await trusted();
    expect(await loginWithPin(undefined, PIN, { now: T0 })).toEqual({ ok: false, reason: "removed" });
    expect(await loginWithPin("garbage", PIN, { now: T0 })).toEqual({ ok: false, reason: "removed" });
    const id = cookie.split(".")[0]!;
    expect(await loginWithPin(`${id}.${"x".repeat(43)}`, PIN, { now: T0 })).toEqual({ ok: false, reason: "removed" });
    expect(await pinStatus(`${id}.${"x".repeat(43)}`, { now: T0 })).toBeNull();
  });

  it("counts down the tries, then removes the device so the full form is needed", async () => {
    const { cookie } = await trusted();
    for (let i = 1; i < MAX_PIN_FAILURES; i++) {
      expect(await loginWithPin(cookie, "9999", { now: T0 })).toEqual({ ok: false, reason: "invalid", attemptsLeft: MAX_PIN_FAILURES - i });
    }
    expect(await loginWithPin(cookie, "9999", { now: T0 })).toEqual({ ok: false, reason: "removed" });
    // Even the right PIN no longer works: the device is gone.
    expect(await loginWithPin(cookie, PIN, { now: T0 })).toEqual({ ok: false, reason: "removed" });
    expect(await db.trustedDevice.count()).toBe(0);
  });

  it("a correct PIN resets the count", async () => {
    const { cookie } = await trusted();
    await loginWithPin(cookie, "9999", { now: T0 });
    await loginWithPin(cookie, "9999", { now: T0 });
    expect((await loginWithPin(cookie, PIN, { now: T0 })).ok).toBe(true);
    expect(await loginWithPin(cookie, "9999", { now: T0 })).toMatchObject({ attemptsLeft: MAX_PIN_FAILURES - 1 });
  });

  it("parallel guesses still only get five tries", async () => {
    const { cookie } = await trusted();
    const guesses = Array.from({ length: 12 }, (_, i) => String(1000 + i * 37).padStart(4, "0"));
    const results = await Promise.all(guesses.map((g) => loginWithPin(cookie, g, { now: T0 })));
    // At most four "wrong, N left" answers; the fifth wrong PIN and everything after it removes the device.
    expect(results.filter((r) => !r.ok && r.reason === "invalid").length).toBeLessThan(MAX_PIN_FAILURES);
    expect(results.filter((r) => r.ok)).toHaveLength(0);
    expect(await db.trustedDevice.count()).toBe(0);
    // Guess number thirteen with the right PIN is too late.
    expect(await loginWithPin(cookie, PIN, { now: T0 })).toEqual({ ok: false, reason: "removed" });
  }, 30_000);

  it("a device expires after 90 days unused, and use extends it", async () => {
    const { cookie } = await trusted();
    const later = new Date(T0.getTime() + DEVICE_TTL_MS - 1000);
    expect((await loginWithPin(cookie, PIN, { now: later })).ok).toBe(true); // renews to a fresh 90 days
    const muchLater = new Date(later.getTime() + DEVICE_TTL_MS - 1000);
    expect((await loginWithPin(cookie, PIN, { now: muchLater })).ok).toBe(true);
    expect(await loginWithPin(cookie, PIN, { now: new Date(muchLater.getTime() + DEVICE_TTL_MS + 1000) })).toEqual({ ok: false, reason: "removed" });
  });

  it("no PIN set means no PIN sign in", async () => {
    const userId = await makeOwner();
    const cookie = await trustDevice(userId, "Chrome on Windows", { now: T0 });
    expect(await pinStatus(cookie, { now: T0 })).toBeNull();
    expect(await loginWithPin(cookie, PIN, { now: T0 })).toEqual({ ok: false, reason: "removed" });
  });
});

describe("keeping devices under control", () => {
  it("lists devices and removes one", async () => {
    const { userId, cookie } = await trusted();
    const second = await trustDevice(userId, "Safari on iOS", { now: T0 });
    expect((await listDevices(userId)).map((d) => d.label).sort()).toEqual(["Chrome on Windows", "Safari on iOS"]);
    await revokeDevice(userId, second.split(".")[0]!);
    expect(await listDevices(userId)).toHaveLength(1);
    expect(await deviceIdFor(userId, cookie, T0)).toBe(cookie.split(".")[0]);
    expect(await loginWithPin(second, PIN, { now: T0 })).toEqual({ ok: false, reason: "removed" });
  });

  it("one owner cannot remove another's device", async () => {
    const { cookie } = await trusted();
    await revokeDevice("00000000-0000-0000-0000-000000000000", cookie.split(".")[0]!);
    expect(await db.trustedDevice.count()).toBe(1);
  });

  it("sign out everywhere and a password change untrust every device", async () => {
    const a = await trusted();
    await signOutEverywhere(a.userId);
    expect(await loginWithPin(a.cookie, PIN, { now: T0 })).toEqual({ ok: false, reason: "removed" });

    const cookie = await trustDevice(a.userId, "Chrome on Windows", { now: T0 });
    await changePassword(a.userId, { current: PASSWORD, next: "another fine long passphrase" });
    expect(await loginWithPin(cookie, PIN, { now: T0 })).toEqual({ ok: false, reason: "removed" });
  });

  it("revokeAllDevices clears the lot", async () => {
    const { userId } = await trusted();
    await trustDevice(userId, "x", { now: T0 });
    await revokeAllDevices(userId);
    expect(await db.trustedDevice.count()).toBe(0);
  });
});

describe("how long a session lasts", () => {
  it("a trusted device keeps you signed in for a month; anything else for 12 hours", () => {
    expect(sessionTtl("full", true)).toBe(TRUSTED_SESSION_TTL_SECONDS);
    expect(TRUSTED_SESSION_TTL_SECONDS).toBe(30 * 24 * 3600);
    expect(sessionTtl("full")).toBe(SESSION_TTL_SECONDS.full);
    expect(sessionTtl("enroll", true)).toBe(SESSION_TTL_SECONDS.enroll); // the restricted session is never extended
  });
});
