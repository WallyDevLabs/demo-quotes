import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/server/auth/session";

/**
 * First gate: verifies the signed cookie (signature and expiry) before anything renders, and sends
 * visitors without one to sign in. It cannot reach the database from the edge, so it is NOT the
 * authority: every page, server action and route calls requireOwnerId, which also checks the database
 * (the user still exists, the session was not revoked, the second factor is enrolled).
 *
 * Because it cannot know whether a signed cookie is still good, it never bounces anyone AWAY from
 * the sign-in or setup pages: those pages ask the database and decide for themselves. Redirecting
 * "signed in" visitors from here would loop forever for a revoked session.
 */
const PUBLIC = new Set(["/login", "/setup", "/offline"]);

const json = (status: number, error: string) =>
  new NextResponse(JSON.stringify({ error }), { status, headers: { "content-type": "application/json" } });

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  // Demo mode: no sign-in. Send the sign-in and setup pages to the app; everything else passes through.
  if (process.env.DEMO_MODE === "true") {
    return pathname === "/login" || pathname.startsWith("/setup") ? NextResponse.redirect(new URL("/", req.url)) : NextResponse.next();
  }
  const claims = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  const isRead = req.method === "GET" || req.method === "HEAD";
  const go = (to: string) => NextResponse.redirect(new URL(to, req.url));

  if (PUBLIC.has(pathname)) return NextResponse.next();

  // The restricted enrolment session finishes setting up the second factor here. The page checks the stage.
  if (pathname === "/setup/2fa") return claims ? NextResponse.next() : go("/login");

  if (!claims) {
    if (!isRead) return json(401, "Your session has ended. Sign in again.");
    const next = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
    return go(`/login${next}`);
  }
  if (claims.stage === "enroll") {
    if (!isRead) return json(403, "Finish setting up two-factor authentication first.");
    return go("/setup/2fa");
  }
  return NextResponse.next();
}

export const config = {
  // Everything except Next's own assets and the files a browser must fetch before signing in.
  matcher: ["/((?!_next/static|_next/image|icons/|sw\\.js|manifest\\.webmanifest|favicon\\.ico|robots\\.txt).*)"],
};
