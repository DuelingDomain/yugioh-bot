import { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ auth: vi.fn(), middleware: vi.fn(), invoke: vi.fn() }));
vi.mock("@clerk/nextjs/server", () => ({ clerkMiddleware: (handler: Function) => { state.middleware(); return (request: NextRequest) => { state.invoke(); return handler(state.auth, request); }; }, createRouteMatcher: (patterns: string[]) => (req: NextRequest) => patterns.some(p => new RegExp(`^${p}$`).test(req.nextUrl.pathname)) }));
import proxy from "../proxy";
import { signE2ESession } from "../src/lib/e2e-auth";
const request = (path: string, method = "GET") => new NextRequest(`https://example.com${path}`, { method });
beforeEach(() => { vi.stubEnv("E2E_AUTH", "0"); vi.stubEnv("DUEL_FX_LAB", "0"); state.auth.mockResolvedValue({ userId: null }); vi.clearAllMocks(); });
afterEach(() => vi.unstubAllEnvs());
it.each(["/sign-in", "/sign-in/factor", "/sign-up", "/sso-callback", "/access", "/login", "/favicon.ico", "/icon.svg", "/apple-icon.png", "/icons/spell.svg", "/api/auth/session"])("opens %s", async path => {
  expect((await proxy(request(path), {} as never))?.status ?? 200).toBe(200);
});
it("opens only POST to the exact waitlist route", async () => {
  expect((await proxy(request("/api/waitlist", "POST"), {} as never))?.status ?? 200).toBe(200);
  for (const path of ["/api/waitlist", "/api/waitlistx", "/api/waitlist/extra", "/api/drafts"]) {
    const res = await proxy(request(path), {} as never); expect(res?.status).toBe(401); expect(await res?.json()).toEqual({ error: "unauthorized" });
  }
});
it.each(["Clerk", "E2E"])("keeps all anonymous API proxy rejections private and uncached in %s mode", async mode => {
  if (mode === "E2E") { vi.stubEnv("E2E_AUTH", "1"); vi.stubEnv("E2E_AUTH_SECRET", "x".repeat(32)); }
  for (const path of ["/api/admin/duels/forks", "/api/drafts", "/api/duels/game-1/replay", "/api/admin/status"]) {
    const response = await proxy(request(path), {} as never);
    expect(response?.status).toBe(401); expect(await response?.json()).toEqual({ error: "unauthorized" });
    expect(response?.headers.get("cache-control")).toBe("private, no-store");
  }
});
it.each(["0", "1"])("opens only the exact Clerk webhook POST in E2E_AUTH=%s", async mode => {
  vi.stubEnv("E2E_AUTH", mode);
  vi.stubEnv("E2E_AUTH_SECRET", "x".repeat(32));
  expect((await proxy(request("/api/webhooks/clerk", "POST"), {} as never))?.status ?? 200).toBe(200);
  expect(state.auth).not.toHaveBeenCalled();
  expect(state.invoke).not.toHaveBeenCalled();
  for (const [path, method] of [["/api/webhooks/clerk", "GET"], ["/api/webhooks/clerk", "PUT"], ["/api/webhooks/clerk/", "POST"], ["/api/webhooks/clerk/extra", "POST"], ["/api/webhooks/clerkx", "POST"], ["/api/webhooks/other", "POST"]]) {
    expect((await proxy(request(path, method), {} as never))?.status).toBe(401);
  }
});
it("allows only the exact anonymous recovery routes and their methods", async () => {
  for (const [path, method] of [["/welcome-back", "GET"], ["/api/auth/existing-player/start", "GET"], ["/api/auth/callback/discord", "GET"], ["/api/auth/existing-player/complete", "POST"], ["/api/auth/existing-player/ticket", "POST"]]) {
    expect((await proxy(request(path, method), {} as never))?.status ?? 200).toBe(200);
  }
  for (const [path, method] of [["/api/auth/existing-player/start", "POST"], ["/api/auth/callback/discord", "POST"], ["/api/auth/existing-player/complete", "GET"], ["/api/auth/existing-player/ticket", "GET"], ["/api/auth/existing-player/other", "GET"], ["/api/auth/existing-player/start/extra", "GET"]]) {
    expect((await proxy(request(path, method), {} as never))?.status).toBe(401);
  }
});
it("preserves path and query in the sign-in redirect", async () => {
  const res = await proxy(request("/settings?tab=one"), {} as never);
  expect(new URL(res!.headers.get("location")!).searchParams.get("redirect_url")).toBe("/settings?tab=one");
});
it("lets an existing Clerk session reach the app root", async () => {
  state.auth.mockResolvedValue({ userId: "user_example" });
  expect((await proxy(request("/"), {} as never))?.status ?? 200).toBe(200);
});
it("404s disabled test-auth endpoints before Clerk middleware runs", async () => { expect((await proxy(request("/api/test-auth/session", "POST"), {} as never))?.status).toBe(404); expect(state.invoke).not.toHaveBeenCalled(); });
it("preserves FX lab rules", async () => {
  expect((await proxy(request("/dev/fx-lab"), {} as never))?.status).toBe(404);
  vi.stubEnv("DUEL_FX_LAB", "1");
  for (const path of ["/dev/fx-lab", "/dev/table-preview/tag", "/dev/solid-preview/domain", "/api/cards/1/image"]) expect((await proxy(request(path), {} as never))?.status ?? 200).toBe(200);
  expect((await proxy(request("/api/cards/1/image/extra"), {} as never))?.status).toBe(401);
});
it("never initializes Clerk in E2E mode and rechecks the gate", async () => {
  const secret = "x".repeat(32); vi.stubEnv("E2E_AUTH", "1"); vi.stubEnv("E2E_AUTH_SECRET", secret);
  const req = request("/dashboard"); req.cookies.set("dd_e2e_session", signE2ESession(42, secret));
  expect((await proxy(req, {} as never))?.status ?? 200).toBe(200); expect(state.middleware).not.toHaveBeenCalled(); expect(state.auth).not.toHaveBeenCalled();
  expect((await proxy(request("/api/drafts"), {} as never))?.status).toBe(401);
  vi.stubEnv("E2E_AUTH", "0"); expect((await proxy(req, {} as never))?.status).toBe(307);
});
it.each(["0", "1"])("opens only the ingest path and its descendants in E2E_AUTH=%s", async mode => {
  vi.stubEnv("E2E_AUTH", mode);
  vi.stubEnv("E2E_AUTH_SECRET", "x".repeat(32));
  for (const path of ["/ingest", "/ingest/", "/ingest/i/v0/e/", "/ingest/static/array.js"]) {
    expect((await proxy(request(path, "POST"), {} as never))?.status ?? 200).toBe(200);
  }
  for (const path of ["/ingestx", "/ingest-static/array.js", "/api/ingest"]) {
    expect((await proxy(request(path), {} as never))?.status).toBe(path.startsWith("/api/") ? 401 : 307);
  }
});
it("forwards ingestion without browser credentials or the original page URL", async () => {
  const req = new NextRequest("https://example.com/ingest/i/v0/e/", { method: "POST", headers: { cookie: "session=private", authorization: "Bearer private", referer: "https://example.com/draft/private-title?invite=private", "content-type": "application/json", "user-agent": "browser" } });
  const response = await proxy(req, {} as never);
  expect(response?.status).toBe(200);
  expect(response?.headers.get("x-middleware-override-headers")?.split(",")).toEqual(["content-type", "user-agent"]);
  expect(response?.headers.get("x-middleware-request-content-type")).toBe("application/json");
  expect(response?.headers.get("x-middleware-request-user-agent")).toBe("browser");
  for (const header of ["cookie", "authorization", "referer"]) expect(response?.headers.get(`x-middleware-request-${header}`)).toBeNull();
});
