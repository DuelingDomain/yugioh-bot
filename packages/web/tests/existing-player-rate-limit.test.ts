import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDENTITY_COOKIE, OAUTH_COOKIE, TICKET_COOKIE, recoveryRateLimit, sealCookie } from "../src/lib/existing-player";

const ORIGIN = "https://app.test";
let now = 0;
const request = (method = "GET", cookie?: string, ip = "198.51.100.1") => new NextRequest(`${ORIGIN}/api/auth/existing-player/start`, {
  method, headers: { "x-forwarded-for": ip, ...(cookie ? { cookie } : {}) },
});
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(now += 600_001);
  vi.stubEnv("WEB_URL", ORIGIN); vi.stubEnv("CLERK_SECRET_KEY", "test-only-clerk-secret");
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("recovery rate limits", () => {
  it("allows thirty starts behind one venue IP, then redirects with a retry delay", () => {
    const req = request();
    for (let i = 0; i < 30; i++) expect(recoveryRateLimit(req, "start")).toBeNull();
    const limited = recoveryRateLimit(req, "start")!;
    expect(limited.status).toBe(303); expect(limited.headers.get("location")).toBe(`${ORIGIN}/sign-in?error=discord_recovery_busy`);
    expect(limited.headers.get("retry-after")).toBe("600");
    vi.advanceTimersByTime(600_000);
    expect(recoveryRateLimit(req, "start")).toBeNull();
  });
  it.each([
    ["callback", "GET", OAUTH_COOKIE, "oauth"],
    ["complete", "POST", IDENTITY_COOKIE, "identity"],
    ["ticket", "POST", TICKET_COOKIE, "ticket"],
  ] as const)("separates %s recovery cookies on the same IP while bounding each flow", (stage, method, name, purpose) => {
    const cookie = `${name}=${sealCookie(purpose, { test: "same-player" })}`;
    const req = request(method, cookie);
    for (let i = 0; i < 10; i++) expect(recoveryRateLimit(req, stage)).toBeNull();
    expect(recoveryRateLimit(request(method, cookie), stage)?.status).toBe(method === "GET" ? 303 : 429);
    const another = `${name}=${sealCookie(purpose, { test: "another-player" })}`;
    expect(recoveryRateLimit(request(method, another), stage)).toBeNull();
    expect(recoveryRateLimit(request(method, cookie, "198.51.100.2"), stage)).toBeNull();
  });
  it.each([
    ["callback", "GET", OAUTH_COOKIE], ["complete", "POST", IDENTITY_COOKIE], ["ticket", "POST", TICKET_COOKIE],
  ] as const)("falls back to the IP for %s without the stage's cookie", (stage, method, name) => {
    const req = request(method);
    for (let i = 0; i < 10; i++) expect(recoveryRateLimit(req, stage)).toBeNull();
    expect(recoveryRateLimit(request(method, `${name}=`), stage)?.status).toBe(method === "GET" ? 303 : 429);
    expect(recoveryRateLimit(request(method, "unrelated=value"), stage)?.status).toBe(method === "GET" ? 303 : 429);
  });
  it("ignores cookies on start and keeps each stage's budget separate", () => {
    for (let i = 0; i < 30; i++) expect(recoveryRateLimit(request("GET", `${OAUTH_COOKIE}=flow-${i}`), "start")).toBeNull();
    expect(recoveryRateLimit(request("GET", `${OAUTH_COOKIE}=another-flow`), "start")?.status).toBe(303);
    expect(recoveryRateLimit(request(), "callback")).toBeNull();
  });
  it("trusts the first X-Forwarded-For IP, ignoring later entries", () => {
    for (let i = 0; i < 30; i++) expect(recoveryRateLimit(request("GET", undefined, `198.51.100.1, 192.0.2.${i}`), "start")).toBeNull();
    expect(recoveryRateLimit(request("GET", undefined, "198.51.100.1, 192.0.2.99"), "start")?.status).toBe(303);
    expect(recoveryRateLimit(request("GET", undefined, "198.51.100.2, 192.0.2.99"), "start")).toBeNull();
  });
  it("keeps forged cookies in the IP bucket so they cannot fill the map", () => {
    for (let i = 0; i < 10; i++) expect(recoveryRateLimit(request("GET", `${OAUTH_COOKIE}=forged-${i}`), "callback")).toBeNull();
    expect(recoveryRateLimit(request("GET", `${OAUTH_COOKIE}=forged-next`), "callback")?.status).toBe(303);
    // Another player's real flow on a different IP is unaffected.
    const real = `${OAUTH_COOKIE}=${sealCookie("oauth", { test: "real" })}`;
    expect(recoveryRateLimit(request("GET", real, "198.51.100.9"), "callback")).toBeNull();
  });
  it("bounds distinct buckets and frees them after ten minutes", () => {
    const ip = (i: number) => `10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`;
    for (let i = 0; i < 10_000; i++) expect(recoveryRateLimit(request("POST", undefined, ip(i)), "complete")).toBeNull();
    expect(recoveryRateLimit(request("POST", undefined, "198.51.100.200"), "complete")?.status).toBe(429);
    // A full map still allows existing buckets within their own budget.
    expect(recoveryRateLimit(request("POST", undefined, ip(0)), "complete")).toBeNull();
    vi.advanceTimersByTime(600_000);
    expect(recoveryRateLimit(request("POST", undefined, "198.51.100.200"), "complete")).toBeNull();
  });
});
