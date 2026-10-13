import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { authenticate, type ActiveSession } from "./auth/service";
import { SESSION_COOKIE } from "./auth/session";

/**
 * The signed-in owner, for every page, server action and route. It checks the signed cookie AND the
 * database (the user still exists, the session version is unchanged, the second factor is enrolled).
 * Without a valid full session the visitor is sent to sign in; nothing is served.
 */
export async function requireOwnerId(): Promise<string> {
  const s = await getSession();
  if (!s || s.stage !== "full") redirect("/login");
  return s.userId;
}

export async function getSession(): Promise<ActiveSession | null> {
  const store = await cookies();
  return authenticate(store.get(SESSION_COOKIE)?.value);
}
