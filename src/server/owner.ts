import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { authenticate, type ActiveSession } from "./auth/service";
import { DEMO_EMAIL, demoOwnerId, isDemo } from "./demo";
import { SESSION_COOKIE } from "./auth/session";

/**
 * The signed-in owner, for every page, server action and route. It checks the signed cookie AND the
 * database (the user still exists, the session version is unchanged, the second factor is enrolled).
 * Without a valid full session the visitor is sent to sign in; nothing is served.
 */
export async function requireOwnerId(): Promise<string> {
  if (isDemo()) return demoOwnerId();
  const s = await getSession();
  if (!s || s.stage !== "full") redirect("/login");
  return s.userId;
}

/**
 * One database check per request, however many places ask who is signed in (the page, a child component,
 * a helper). Keyed on the cookie value, so a session that changes mid-request (sign in, sign out
 * everywhere, a password change) is checked again rather than served from the earlier answer.
 */
export const authenticateOnce = cache((token: string | undefined): Promise<ActiveSession | null> => authenticate(token));

export async function getSession(): Promise<ActiveSession | null> {
  if (isDemo()) return { userId: await demoOwnerId(), email: DEMO_EMAIL, stage: "full" };
  const store = await cookies();
  return authenticateOnce(store.get(SESSION_COOKIE)?.value);
}
