"use server";

import { cookies, headers } from "next/headers";
import { z } from "zod";
import { passwordProblem } from "@/server/auth/crypto";
import { deviceIdFor, hasPin, listDevices, loginWithPin, MAX_PIN_FAILURES, revokeDevice, setPin, trustDevice } from "@/server/auth/pin";
import {
  authenticate,
  changePassword,
  confirmEnrollment,
  finishEnrollment,
  GENERIC_LOGIN_ERROR,
  login,
  ownerExists,
  regenerateRecoveryCodes,
  setupOwner,
  signOutEverywhere,
} from "@/server/auth/service";
import { cookieOptions, DEVICE_COOKIE, deviceCookieOptions, SESSION_COOKIE, signSession, type SessionStage } from "@/server/auth/session";
import { db } from "@/server/db";
import { runAction, ServiceError, type ActionResult } from "@/server/errors";
import { requireOwnerId } from "@/server/owner";

/**
 * Sign-in, first-run setup and account actions. Each one validates its input, talks only to the auth
 * service, and sets or clears the session cookie. Nothing here logs an email, a password, a PIN or a code.
 */

async function clientIp(): Promise<string | undefined> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || undefined;
}

/** `persistent` is for trusted devices: the session lasts a month instead of 12 hours. */
async function startSession(userId: string, stage: SessionStage, sessionVersion?: number, persistent = false) {
  const sv = sessionVersion ?? (await db.user.findUniqueOrThrow({ where: { id: userId }, select: { sessionVersion: true } })).sessionVersion;
  const token = await signSession({ sub: userId, stage, sv }, undefined, Date.now(), persistent);
  (await cookies()).set(SESSION_COOKIE, token, cookieOptions(stage, persistent));
}

/** "Chrome on Windows": enough to recognise a device in the list, nothing that identifies a person. */
function deviceLabel(ua: string | null): string {
  const u = ua ?? "";
  const browser = /Edg\//.test(u) ? "Edge" : /OPR\/|Opera/.test(u) ? "Opera" : /Firefox\//.test(u) ? "Firefox" : /Chrome\//.test(u) ? "Chrome" : /Safari\//.test(u) ? "Safari" : "Browser";
  const os = /Windows/.test(u) ? "Windows" : /Android/.test(u) ? "Android" : /iPhone|iPad/.test(u) ? "iOS" : /Mac OS X/.test(u) ? "macOS" : /Linux/.test(u) ? "Linux" : "unknown device";
  return `${browser} on ${os}`;
}

/** Marks this browser as trusted (PIN sign-in from now on) and gives it the long session. */
async function trustThisBrowser(userId: string, sessionVersion?: number) {
  const value = await trustDevice(userId, deviceLabel((await headers()).get("user-agent")));
  (await cookies()).set(DEVICE_COOKIE, value, deviceCookieOptions());
  await startSession(userId, "full", sessionVersion, true);
}

/** Same attributes as when it was set: a "__Host-" cookie is Secure and a browser ignores a deletion that is not. */
async function clearDeviceCookie() {
  (await cookies()).set(DEVICE_COOKIE, "", { ...deviceCookieOptions(), maxAge: 0, expires: new Date(0) });
}

const currentDeviceId = async (userId: string) => deviceIdFor(userId, (await cookies()).get(DEVICE_COOKIE)?.value);

/** Only same-site paths: never a full URL, so a crafted link cannot bounce you to another site after signing in. */
function safeNext(next: string | undefined): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.includes("\\") ? next : "/";
}

export async function loginAction(input: { email: string; password: string; code: string; trust?: boolean; next?: string }): Promise<ActionResult<{ redirectTo: string }>> {
  return runAction(async () => {
    const r = await login({ email: String(input.email ?? ""), password: String(input.password ?? ""), code: String(input.code ?? "") }, { ip: await clientIp() });
    if (!r.ok && r.reason === "locked") {
      const mins = Math.max(1, Math.ceil(r.retryAfterSeconds / 60));
      throw new ServiceError(`Too many attempts. Try again in ${mins} minute${mins === 1 ? "" : "s"}.`);
    }
    if (!r.ok) throw new ServiceError(GENERIC_LOGIN_ERROR);
    if (r.stage === "enroll") {
      await startSession(r.userId, "enroll", r.sessionVersion);
      return { redirectTo: "/setup/2fa" };
    }
    const next = safeNext(input.next);
    if (input.trust === false) {
      await startSession(r.userId, "full", r.sessionVersion);
      return { redirectTo: next };
    }
    // Trusting this browser needs a PIN to sign in with next time: choose one now if there is none yet.
    if (await hasPin(r.userId)) {
      await trustThisBrowser(r.userId, r.sessionVersion);
      return { redirectTo: next };
    }
    await startSession(r.userId, "full", r.sessionVersion);
    return { redirectTo: `/setup/pin?next=${encodeURIComponent(next)}` };
  });
}

/** Signs in on a trusted device with the PIN alone. `redirectTo: null` means the device was removed: use the full form. */
export async function pinLoginAction(input: { pin: string; next?: string }): Promise<ActionResult<{ redirectTo: string | null; message?: string }>> {
  return runAction(async () => {
    const r = await loginWithPin((await cookies()).get(DEVICE_COOKIE)?.value, String(input.pin ?? ""));
    if (!r.ok && r.reason === "removed") {
      await clearDeviceCookie();
      return { redirectTo: null, message: "This device is no longer trusted. Sign in with your password and authenticator code." };
    }
    if (!r.ok) {
      throw new ServiceError(`That PIN is not correct. ${r.attemptsLeft} of ${MAX_PIN_FAILURES} tries left before this device needs your authenticator code.`);
    }
    await startSession(r.userId, "full", r.sessionVersion, true);
    return { redirectTo: safeNext(input.next) };
  });
}

/** Sets or changes the PIN. From the sign-in flow it also trusts this browser. */
export async function setPinAction(input: { pin: string; confirm: string; password: string; trust?: boolean }): Promise<ActionResult> {
  return runAction(async () => {
    const userId = await requireOwnerId();
    if (input.pin !== input.confirm) throw new ServiceError("Some fields need attention.", [{ path: "confirm", message: "The two PINs do not match" }]);
    await setPin(userId, { pin: String(input.pin ?? ""), password: String(input.password ?? "") });
    if (input.trust) await trustThisBrowser(userId);
  });
}

export async function removeDeviceAction(deviceId: string): Promise<ActionResult> {
  return runAction(async () => {
    const userId = await requireOwnerId();
    const mine = await currentDeviceId(userId);
    await revokeDevice(userId, String(deviceId ?? ""));
    if (mine === deviceId) await clearDeviceCookie();
  });
}

export async function listDevicesAction(): Promise<{ id: string; label: string; lastUsedAt: string; current: boolean }[]> {
  const userId = await requireOwnerId();
  const mine = await currentDeviceId(userId);
  return (await listDevices(userId)).map((d) => ({ id: d.id, label: d.label, lastUsedAt: d.lastUsedAt.toISOString(), current: d.id === mine }));
}

const setupSchema = z.object({ email: z.string(), password: z.string(), confirm: z.string(), setupToken: z.string().optional() });

export async function setupAction(input: z.input<typeof setupSchema>): Promise<ActionResult<{ redirectTo: string }>> {
  return runAction(async () => {
    const v = setupSchema.parse(input);
    if (await ownerExists()) throw new ServiceError("An owner account already exists. Sign in instead.");
    if (v.password !== v.confirm) throw new ServiceError("Some fields need attention.", [{ path: "confirm", message: "The two passwords do not match" }]);
    const { userId } = await setupOwner(
      { email: v.email, password: v.password, setupToken: v.setupToken },
      { requireToken: process.env.NODE_ENV === "production", expectedToken: process.env.SETUP_TOKEN, ip: await clientIp() },
    );
    await startSession(userId, "enroll");
    return { redirectTo: "/setup/2fa" };
  });
}

/** Confirms the first code. The restricted session stays in place until the owner has saved the recovery codes. */
export async function enrollConfirmAction(code: string): Promise<ActionResult<{ recoveryCodes: string[] }>> {
  return runAction(async () => {
    const store = await cookies();
    const s = await authenticate(store.get(SESSION_COOKIE)?.value);
    if (!s || s.stage !== "enroll") throw new ServiceError("Your setup session has ended. Sign in again.");
    return confirmEnrollment(s.userId, String(code ?? ""));
  });
}

/** The owner has saved the recovery codes: replace the restricted session with a full one. */
export async function finishEnrollmentAction(): Promise<ActionResult> {
  return runAction(async () => {
    const store = await cookies();
    const s = await authenticate(store.get(SESSION_COOKIE)?.value);
    if (!s || s.stage !== "enroll") throw new ServiceError("Your setup session has ended. Sign in again.");
    const sv = await finishEnrollment(s.userId);
    await startSession(s.userId, "full", sv);
  });
}

export async function regenerateRecoveryCodesAction(password: string): Promise<ActionResult<{ recoveryCodes: string[] }>> {
  return runAction(async () => regenerateRecoveryCodes(await requireOwnerId(), String(password ?? "")));
}

export async function logoutAction(): Promise<ActionResult> {
  return runAction(async () => {
    // Clear it with the SAME attributes it was set with. A "__Host-" cookie is Secure, and a browser ignores a
    // deletion that lacks Secure, so cookies().delete() would leave the user signed in (found by the end-to-end test).
    // The trusted-device cookie stays: signing out is not the same as forgetting this device.
    (await cookies()).set(SESSION_COOKIE, "", { ...cookieOptions("full"), maxAge: 0, expires: new Date(0) });
  });
}

/** After every other device has been untrusted, this browser keeps its trust (if it had any) with a fresh device record. */
async function renewThisBrowser(userId: string, sessionVersion: number, wasTrusted: boolean) {
  if (wasTrusted && (await hasPin(userId))) {
    await trustThisBrowser(userId, sessionVersion);
  } else {
    await clearDeviceCookie();
    await startSession(userId, "full", sessionVersion);
  }
}

export async function signOutEverywhereAction(): Promise<ActionResult> {
  return runAction(async () => {
    const userId = await requireOwnerId();
    const wasTrusted = !!(await currentDeviceId(userId));
    const sv = await signOutEverywhere(userId);
    await renewThisBrowser(userId, sv, wasTrusted);
  });
}

export async function changePasswordAction(input: { current: string; next: string; confirm: string }): Promise<ActionResult> {
  return runAction(async () => {
    const userId = await requireOwnerId();
    if (input.next !== input.confirm) throw new ServiceError("Some fields need attention.", [{ path: "confirm", message: "The two passwords do not match" }]);
    const wasTrusted = !!(await currentDeviceId(userId));
    const { sessionVersion } = await changePassword(userId, { current: String(input.current ?? ""), next: String(input.next ?? "") });
    await renewThisBrowser(userId, sessionVersion, wasTrusted);
  });
}

/** Used by the forms to give feedback as you type, without sending anything to the server. */
export async function passwordHint(password: string, email: string): Promise<string | null> {
  return passwordProblem(password, email);
}
