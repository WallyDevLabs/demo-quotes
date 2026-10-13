import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { middleware } from "@/middleware";
import { SESSION_COOKIE, signSession } from "@/server/auth/session";

const SECRET = process.env.AUTH_SECRET!;

async function call(path: string, opts: { method?: string; cookie?: string | null } = {}) {
  const headers = new Headers();
  if (opts.cookie) headers.set("cookie", `${SESSION_COOKIE}=${opts.cookie}`);
  const res = await middleware(new NextRequest(`http://localhost:3000${path}`, { method: opts.method ?? "GET", headers }));
  const location = res.headers.get("location");
  return { status: res.status, location: location ? new URL(location).pathname + new URL(location).search : null, next: res.headers.get("x-middleware-next") === "1" };
}

const full = () => signSession({ sub: "u", stage: "full", sv: 0 }, SECRET);
const enroll = () => signSession({ sub: "u", stage: "enroll", sv: 0 }, SECRET);

describe("middleware: the first gate", () => {
  it("sends a visitor with no session to sign in, remembering where they were going", async () => {
    expect(await call("/")).toMatchObject({ status: 307, location: "/login" });
    expect(await call("/invoices")).toMatchObject({ status: 307, location: "/login?next=%2Finvoices" });
    expect(await call("/quotations/abc/pdf?x=1")).toMatchObject({ status: 307, location: "/login?next=%2Fquotations%2Fabc%2Fpdf%3Fx%3D1" });
  });

  it("refuses writes outright without a session (no redirect for a server action)", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect((await call("/settings", { method })).status).toBe(401);
    }
  });

  it("lets the sign-in, setup and offline pages through with or without a session", async () => {
    for (const p of ["/login", "/setup", "/offline"]) {
      expect((await call(p)).next).toBe(true);
      expect((await call(p, { cookie: await full() })).next).toBe(true);
    }
  });

  it("never bounces a signed-in visitor away from sign-in or setup (that would loop for a revoked session)", async () => {
    expect((await call("/login", { cookie: await full() })).status).toBe(200);
    expect((await call("/setup", { cookie: await full() })).status).toBe(200);
  });

  it("lets a valid full session through everywhere", async () => {
    const cookie = await full();
    for (const p of ["/", "/invoices", "/settings", "/audit", "/quotations/abc/pdf"]) expect((await call(p, { cookie })).next).toBe(true);
    expect((await call("/settings", { method: "POST", cookie })).next).toBe(true);
  });

  it("confines the restricted enrolment session to the authenticator page", async () => {
    const cookie = await enroll();
    expect((await call("/setup/2fa", { cookie })).next).toBe(true);
    expect(await call("/", { cookie })).toMatchObject({ status: 307, location: "/setup/2fa" });
    expect(await call("/invoices", { cookie })).toMatchObject({ status: 307, location: "/setup/2fa" });
    expect((await call("/invoices", { method: "POST", cookie })).status).toBe(403);
  });

  it("the authenticator page needs some session", async () => {
    expect(await call("/setup/2fa")).toMatchObject({ status: 307, location: "/login" });
  });

  it("treats a forged, tampered or expired cookie as no session", async () => {
    const good = await full();
    const forged = good.slice(0, -4) + "AAAA";
    expect(await call("/invoices", { cookie: forged })).toMatchObject({ status: 307 });
    expect(await call("/invoices", { cookie: "not.a.jwt" })).toMatchObject({ status: 307 });
    const old = await signSession({ sub: "u", stage: "full", sv: 0 }, SECRET, Date.now() - 13 * 3600_000);
    expect(await call("/invoices", { cookie: old })).toMatchObject({ status: 307, location: "/login?next=%2Finvoices" });
    const other = await signSession({ sub: "u", stage: "full", sv: 0 }, "a-different-secret-that-is-also-32-chars-long!!");
    expect((await call("/invoices", { cookie: other })).status).toBe(307);
  });
});
