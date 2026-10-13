import { jwtVerify, SignJWT } from "jose";

/**
 * Signed session tokens. This file imports only `jose`, so the edge middleware can verify the
 * signature and expiry. The authoritative check (user still exists, session version unchanged, second
 * factor enrolled) happens on the server in `authenticate`, on every action and route.
 */

export type SessionStage = "full" | "enroll";

export interface SessionClaims {
  sub: string;
  /** "enroll" is a restricted session that can only finish setting up the second factor. */
  stage: SessionStage;
  /** Must equal the user's current sessionVersion, so one change ends every session. */
  sv: number;
}

const prod = process.env.NODE_ENV === "production";

/** `__Host-` pins the cookie to this exact host, over HTTPS, with no Domain attribute. */
export const SESSION_COOKIE = prod ? "__Host-session" : "session";

export const SESSION_TTL_SECONDS: Record<SessionStage, number> = { full: 12 * 60 * 60, enroll: 30 * 60 };

/** A session started on a trusted device (password + code once, or the PIN) lasts a month. */
export const TRUSTED_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

export const sessionTtl = (stage: SessionStage, persistent = false) =>
  stage === "full" && persistent ? TRUSTED_SESSION_TTL_SECONDS : SESSION_TTL_SECONDS[stage];

export function authSecret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) {
    throw new Error("AUTH_SECRET is missing or too short. Generate one with: openssl rand -base64 32");
  }
  return s;
}

const keyOf = (secret: string) => new TextEncoder().encode(secret);

export async function signSession(claims: SessionClaims, secret = authSecret(), now = Date.now(), persistent = false): Promise<string> {
  const ttl = sessionTtl(claims.stage, persistent);
  return new SignJWT({ stage: claims.stage, sv: claims.sv })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuedAt(Math.floor(now / 1000))
    .setExpirationTime(Math.floor(now / 1000) + ttl)
    .sign(keyOf(secret));
}

export async function verifySession(token: string | undefined, secret = authSecret(), now = Date.now()): Promise<SessionClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, keyOf(secret), { algorithms: ["HS256"], currentDate: new Date(now) });
    if (typeof payload.sub !== "string" || (payload.stage !== "full" && payload.stage !== "enroll") || typeof payload.sv !== "number") return null;
    return { sub: payload.sub, stage: payload.stage, sv: payload.sv };
  } catch {
    return null;
  }
}

export function cookieOptions(stage: SessionStage, persistent = false) {
  return { httpOnly: true, secure: prod, sameSite: "lax" as const, path: "/", maxAge: sessionTtl(stage, persistent) };
}

/** The trusted-device cookie: same protections as the session, but it lives for months. */
export const DEVICE_COOKIE = prod ? "__Host-device" : "device";
export const DEVICE_TTL_SECONDS = 90 * 24 * 60 * 60;
export const deviceCookieOptions = () => ({ httpOnly: true, secure: prod, sameSite: "lax" as const, path: "/", maxAge: DEVICE_TTL_SECONDS });
