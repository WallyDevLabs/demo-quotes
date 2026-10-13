import { describe, expect, it } from "vitest";
import {
  base32Decode,
  base32Encode,
  burnPasswordTime,
  decryptSecret,
  encryptSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  hashPassword,
  hashRecoveryCode,
  looksLikeRecoveryCode,
  normaliseRecoveryCode,
  otpauthUri,
  passwordProblem,
  totpCode,
  totpStepAt,
  verifyPassword,
  verifyTotp,
} from "@/server/auth/crypto";
import { signSession, verifySession } from "@/server/auth/session";

const SECRET = "test-only-secret-that-is-at-least-32-characters-long";

describe("TOTP (RFC 6238 test vectors, SHA-1, secret '12345678901234567890')", () => {
  const secret = Buffer.from("12345678901234567890");
  // RFC 6238 appendix B, last six of the eight digit codes.
  const vectors: [number, string][] = [
    [59, "287082"],
    [1111111109, "081804"],
    [1111111111, "050471"],
    [1234567890, "005924"],
    [2000000000, "279037"],
    [20000000000, "353130"],
  ];
  it.each(vectors)("at %i seconds the code is %s", (seconds, code) => {
    expect(totpCode(secret, totpStepAt(seconds * 1000))).toBe(code);
  });

  const b32 = base32Encode(secret);
  const T = 1_111_111_109 * 1000;
  it("accepts the current code and one step either side (clock drift)", () => {
    const step = totpStepAt(T);
    expect(verifyTotp(b32, "081804", T, null)).toBe(step);
    expect(verifyTotp(b32, totpCode(secret, step - 1), T, null)).toBe(step - 1);
    expect(verifyTotp(b32, totpCode(secret, step + 1), T, null)).toBe(step + 1);
  });
  it("rejects a code two steps away, and malformed input", () => {
    const step = totpStepAt(T);
    expect(verifyTotp(b32, totpCode(secret, step + 2), T, null)).toBeNull();
    expect(verifyTotp(b32, totpCode(secret, step - 2), T, null)).toBeNull();
    for (const bad of ["", "12345", "1234567", "abcdef", "08 18 04x"]) expect(verifyTotp(b32, bad, T, null)).toBeNull();
  });
  it("accepts a code typed with spaces", () => {
    expect(verifyTotp(b32, "081 804", T, null)).not.toBeNull();
  });
  it("refuses a code that was already used (replay protection)", () => {
    const step = totpStepAt(T);
    expect(verifyTotp(b32, "081804", T, step)).toBeNull(); // same step already consumed
    expect(verifyTotp(b32, "081804", T, step - 1)).toBe(step);
    expect(verifyTotp(b32, totpCode(secret, step - 1), T, step)).toBeNull(); // an older step cannot be replayed either
  });
  it("generates a fresh 160 bit secret and a standard otpauth URI", () => {
    const a = generateTotpSecret();
    expect(a).toMatch(/^[A-Z2-7]{32}$/);
    expect(generateTotpSecret()).not.toBe(a);
    const uri = otpauthUri(a, "me@example.com");
    expect(uri).toBe(`otpauth://totp/CodeQuote%3Ame%40example.com?secret=${a}&issuer=CodeQuote&algorithm=SHA1&digits=6&period=30`);
  });
});

describe("base32", () => {
  it("round trips and matches the RFC 4648 vector", () => {
    expect(base32Encode(Buffer.from("foobar"))).toBe("MZXW6YTBOI");
    expect(base32Decode("MZXW6YTBOI").toString()).toBe("foobar");
    for (const n of [1, 5, 20, 33]) {
      const b = Buffer.from(Array.from({ length: n }, (_, i) => (i * 37 + 11) & 255));
      expect(base32Decode(base32Encode(b)).equals(b)).toBe(true);
    }
  });
  it("tolerates spaces, dashes and lower case, and rejects junk", () => {
    expect(base32Decode("mzxw 6ytb-oi").toString()).toBe("foobar");
    expect(() => base32Decode("1!")).toThrow();
  });
});

describe("passwords", () => {
  it("hashes with a unique salt and verifies", async () => {
    const h1 = await hashPassword("correct horse battery staple");
    const h2 = await hashPassword("correct horse battery staple");
    expect(h1).not.toBe(h2);
    expect(h1).toMatch(/^scrypt\$32768\$8\$1\$/);
    expect(await verifyPassword("correct horse battery staple", h1)).toBe(true);
    expect(await verifyPassword("correct horse battery stapl", h1)).toBe(false);
    expect(await verifyPassword("", h1)).toBe(false);
  }, 20_000);
  it("normalises Unicode so the same password always matches", async () => {
    const h = await hashPassword("pässwörd-länger-als-12");
    expect(await verifyPassword("pässwörd-länger-als-12", h)).toBe(true);
  }, 20_000);
  it("refuses malformed or dangerous stored hashes instead of using them", async () => {
    expect(await verifyPassword("x", "")).toBe(false);
    expect(await verifyPassword("x", "!unset")).toBe(false);
    expect(await verifyPassword("x", "scrypt$1$1$1$AA==$AA==")).toBe(false);
    expect(await verifyPassword("x", "scrypt$999999999$8$1$AA==$AA==")).toBe(false);
    expect(await verifyPassword("x", "bcrypt$a$b$c$d$e")).toBe(false);
  });
  it("takes similar time for a throwaway hash (so an unknown email is not detectable)", async () => {
    await expect(burnPasswordTime("anything")).resolves.toBeUndefined();
  }, 20_000);
  it("enforces a sensible minimum", () => {
    expect(passwordProblem("short", "a@b.co")).toMatch(/at least 12/);
    expect(passwordProblem("a@b.co".repeat(3), "x@y.zz")).toBeNull();
    expect(passwordProblem("me@example.com", "ME@example.com")).toMatch(/email/);
    expect(passwordProblem("aaaaaaaaaaaaaaaa", "x@y.zz")).toMatch(/easy to guess/);
    expect(passwordProblem("x".repeat(201) + "y", "x@y.zz")).toMatch(/at most/);
    expect(passwordProblem("a perfectly fine passphrase", "x@y.zz")).toBeNull();
  });
});

describe("secrets at rest", () => {
  it("encrypts the authenticator secret and decrypts it with the same key only", () => {
    const enc = encryptSecret("JBSWY3DPEHPK3PXP", SECRET);
    expect(enc).not.toContain("JBSWY3DPEHPK3PXP");
    expect(decryptSecret(enc, SECRET)).toBe("JBSWY3DPEHPK3PXP");
    expect(encryptSecret("JBSWY3DPEHPK3PXP", SECRET)).not.toBe(enc); // fresh IV each time
    expect(() => decryptSecret(enc, SECRET + "x")).toThrow();
  });
  it("detects tampering", () => {
    const enc = encryptSecret("JBSWY3DPEHPK3PXP", SECRET);
    const parts = enc.split(":");
    parts[3] = Buffer.from("tampered").toString("base64");
    expect(() => decryptSecret(parts.join(":"), SECRET)).toThrow();
    expect(() => decryptSecret("garbage", SECRET)).toThrow();
  });
});

describe("recovery codes", () => {
  it("are random, readable, unique and stored only as hashes", () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(8);
    expect(new Set(codes).size).toBe(8);
    for (const c of codes) expect(c).toMatch(/^[A-Z2-7]{5}-[A-Z2-7]{5}$/);
    expect(hashRecoveryCode(codes[0]!)).toMatch(/^[0-9a-f]{64}$/);
  });
  it("match however they are typed", () => {
    expect(normaliseRecoveryCode("abcde-fgh23")).toBe("ABCDEFGH23");
    expect(hashRecoveryCode("abcde fgh23")).toBe(hashRecoveryCode("ABCDE-FGH23"));
    expect(hashRecoveryCode("ABCDE-FGH23")).not.toBe(hashRecoveryCode("ABCDE-FGH24"));
  });
  it("are told apart from a six digit authenticator code", () => {
    expect(looksLikeRecoveryCode("ABCDE-FGH23")).toBe(true);
    expect(looksLikeRecoveryCode("123456")).toBe(false);
    expect(looksLikeRecoveryCode("123 456")).toBe(false);
  });
});

describe("session tokens", () => {
  const claims = { sub: "user-1", stage: "full" as const, sv: 3 };
  it("round trip", async () => {
    const t = await signSession(claims, SECRET);
    expect(await verifySession(t, SECRET)).toEqual(claims);
  });
  it("reject a tampered token, a wrong secret, junk and nothing", async () => {
    const t = await signSession(claims, SECRET);
    const [h, p, s] = t.split(".");
    const forged = `${h}.${Buffer.from(JSON.stringify({ sub: "user-2", stage: "full", sv: 3, exp: 9999999999 })).toString("base64url")}.${s}`;
    expect(await verifySession(forged, SECRET)).toBeNull();
    expect(await verifySession(t, SECRET + "x")).toBeNull();
    expect(await verifySession("not.a.token", SECRET)).toBeNull();
    expect(await verifySession(undefined, SECRET)).toBeNull();
    expect(await verifySession(`${h}.${p}.`, SECRET)).toBeNull();
  });
  it("reject an unsigned token (alg none)", async () => {
    const none = `${Buffer.from('{"alg":"none"}').toString("base64url")}.${Buffer.from(JSON.stringify({ sub: "u", stage: "full", sv: 0, exp: 9999999999 })).toString("base64url")}.`;
    expect(await verifySession(none, SECRET)).toBeNull();
  });
  it("expire: 12 hours for a full session, 30 minutes for enrolment", async () => {
    const t0 = Date.parse("2026-10-13T08:00:00Z");
    const full = await signSession(claims, SECRET, t0);
    expect(await verifySession(full, SECRET, t0 + 11 * 3600_000)).not.toBeNull();
    expect(await verifySession(full, SECRET, t0 + 12 * 3600_000 + 1000)).toBeNull();
    const enroll = await signSession({ ...claims, stage: "enroll" }, SECRET, t0);
    expect(await verifySession(enroll, SECRET, t0 + 29 * 60_000)).not.toBeNull();
    expect(await verifySession(enroll, SECRET, t0 + 31 * 60_000)).toBeNull();
  });
  it("carry the stage so an enrolment session is never a full one", async () => {
    const t = await signSession({ ...claims, stage: "enroll" }, SECRET);
    expect((await verifySession(t, SECRET))!.stage).toBe("enroll");
  });
});
