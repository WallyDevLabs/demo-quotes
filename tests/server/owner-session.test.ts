import { beforeEach, describe, expect, it, vi } from "vitest";

// React's `cache` only de-duplicates inside a server render. Here it is replaced by the same idea (one answer
// per argument for the life of a "request"), so what is tested is OUR wrapper: one check per cookie value, and a
// fresh check when the cookie changes.
const authenticate = vi.fn(async (token: string | undefined) => (token ? { userId: `u-${token}`, email: "o@example.com", stage: "full" as const } : null));
let cookieValue: string | undefined;

vi.mock("react", async (orig) => {
  const actual = await orig<typeof import("react")>();
  return {
    ...actual,
    cache: <A, R>(fn: (a: A) => R) => {
      const memo = new Map<A, R>();
      return (a: A) => (memo.has(a) ? memo.get(a)! : (memo.set(a, fn(a)), memo.get(a)!));
    },
  };
});
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => (cookieValue ? { value: cookieValue } : undefined) }) }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`redirect:${to}`); } }));
vi.mock("@/server/auth/service", () => ({ authenticate }));

beforeEach(() => {
  authenticate.mockClear();
  cookieValue = "tok1";
});

describe("who is signed in, per request", () => {
  it("asks the database once however many places ask", async () => {
    const { getSession, requireOwnerId } = await import("@/server/owner");
    await Promise.all([getSession(), requireOwnerId(), getSession(), requireOwnerId()]);
    expect(authenticate).toHaveBeenCalledTimes(1);
  });

  it("checks again when the cookie changes mid-request (a new or ended session is never answered from the old one)", async () => {
    const { getSession } = await import("@/server/owner");
    cookieValue = "tokA";
    expect((await getSession())?.userId).toBe("u-tokA");
    cookieValue = "tokB";
    expect((await getSession())?.userId).toBe("u-tokB");
    cookieValue = undefined;
    expect(await getSession()).toBeNull();
    expect(authenticate).toHaveBeenCalledTimes(3);
  });

  it("still sends a signed-out visitor to sign in", async () => {
    const { requireOwnerId } = await import("@/server/owner");
    cookieValue = undefined;
    await expect(requireOwnerId()).rejects.toThrow("redirect:/login");
  });
});
