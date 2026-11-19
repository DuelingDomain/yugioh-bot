import { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ auth: vi.fn(), invoke: vi.fn() }));
vi.mock("@clerk/nextjs/server", () => ({
  clerkMiddleware: (handler: (auth: typeof state.auth, request: NextRequest) => unknown) => (request: NextRequest) => { state.invoke(); return handler(state.auth, request); },
  createRouteMatcher: (patterns: string[]) => (request: NextRequest) => patterns.some(pattern => new RegExp(`^${pattern}$`).test(request.nextUrl.pathname)),
}));
import proxy from "../proxy";
const base = "/api/tournament-bridge";
const run = (path: string, method = "GET") => proxy(new NextRequest(`https://app.test${path}`, { method }), {} as never);
beforeEach(() => {
  vi.clearAllMocks(); state.auth.mockResolvedValue({ userId: null });
  vi.stubEnv("E2E_AUTH", "0"); vi.stubEnv("TOURNAMENT_URL", "https://tournament.test");
});
afterEach(() => vi.unstubAllEnvs());

it.each(["0", "1"])("opens exactly the signed service methods before Clerk in E2E_AUTH=%s", async mode => {
  vi.stubEnv("E2E_AUTH", mode); vi.stubEnv("E2E_AUTH_SECRET", "x".repeat(32));
  for (const [path, method] of [[`${base}/users/search?q=ada`, "GET"], [`${base}/users/lookup`, "POST"], [`${base}/users/12/member-id`, "PUT"]]) {
    expect((await run(path, method))?.status).toBe(200);
  }
  expect(state.invoke).not.toHaveBeenCalled(); expect(state.auth).not.toHaveBeenCalled();
  for (const [path, method] of [[`${base}/users/search`, "POST"], [`${base}/users/lookup`, "GET"], [`${base}/users/12/member-id`, "GET"],
    [`${base}/users/12/member-id/extra`, "PUT"], [`${base}/users/search/extra`, "GET"], [`${base}/users/lookup/`, "POST"], [`${base}/users/searchx`, "GET"], [`${base}/other`, "GET"]]) {
    expect((await run(path, method))?.status).toBe(401);
  }
});

it("404s every disabled bridge path before initializing Clerk", async () => {
  vi.stubEnv("TOURNAMENT_URL", "");
  for (const path of [base, `${base}/start`, `${base}/users/search`, `${base}/users/lookup`, `${base}/users/1/member-id`, `${base}/other`]) {
    expect((await run(path))?.status).toBe(404);
  }
  expect(state.invoke).not.toHaveBeenCalled();
});

it("protects start with the existing sign-in redirect and preserves its query for sign-up too", async () => {
  const path = `${base}/start?return=%2Fevents%2Fone%3Fdesk%3D1`;
  const response = await run(path);
  const location = new URL(response!.headers.get("location")!);
  expect(location.pathname).toBe("/sign-in"); expect(location.searchParams.get("redirect_url")).toBe(path);
  expect((await run(`${base}/start`, "POST"))?.status).toBe(401);
  state.auth.mockResolvedValue({ userId: "clerk1" });
  expect((await run(path))?.status).toBe(200);
});
