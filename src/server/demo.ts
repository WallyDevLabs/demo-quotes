import { db } from "./db";

/**
 * Portfolio demo mode (DEMO_MODE=true): no sign-in, every visitor works as one shared demo owner.
 * The real authentication code stays in place, unused, so switching the variable off restores it.
 * The demo user's password hash is not a real hash, so nobody can ever sign in as it.
 */
export const isDemo = () => process.env.DEMO_MODE === "true";

export const DEMO_EMAIL = "demo@codequote.local";

export async function demoOwnerId(): Promise<string> {
  const u = await db.user.upsert({
    where: { email: DEMO_EMAIL },
    update: {},
    create: { email: DEMO_EMAIL, passwordHash: "demo-no-login" },
    select: { id: true },
  });
  return u.id;
}
