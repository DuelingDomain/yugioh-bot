import { NextRequest, type NextFetchEvent, type NextMiddleware } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Only replace the session read. The exported NextAuth handler, authorized
// callback, access policy and Discord membership helper all run normally.
const state = vi.hoisted(() => ({ session: null as { user: { id: string }; expires: string } | null }));
vi.mock("@auth/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@auth/core")>();
  return {
    ...actual,
    Auth: (request: Request, config: Parameters<typeof actual.Auth>[1]) =>
      new URL(request.url).pathname === "/api/auth/session"
        ? Promise.resolve(Response.json(state.session))
        : actual.Auth(request, config),
  };
});

let proxy: NextMiddleware;
let fetchMock: ReturnType<typeof vi.fn>;
async function request(path: string, method = "GET", headers?: HeadersInit) {
  const response = await proxy(new NextRequest(`http://localhost${path}`, { method, headers }), {} as NextFetchEvent);
  expect(response).toBeInstanceOf(Response);
  if (!(response instanceof Response)) throw new Error("Proxy did not return a response");
  return response;
}

describe("exported proxy enforces configured-guild membership", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv("DISCORD_CLIENT_ID", "client");
    vi.stubEnv("DISCORD_CLIENT_SECRET", "client-secret");
    vi.stubEnv("NEXTAUTH_SECRET", "session-secret");
    vi.stubEnv("DISCORD_GUILD_ID", "guild-1");
    vi.stubEnv("DISCORD_TOKEN", "bot-token");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DUEL_FX_LAB", "");
    state.session = { user: { id: "member" }, expires: "2099-01-01T00:00:00Z" };
    fetchMock = vi.fn().mockImplementation(async () => Response.json({ roles: [] }));
    vi.stubGlobal("fetch", fetchMock);
    // NextAuth supports inline proxy calls at runtime, but omits that overload.
    proxy = (await import("../proxy")).proxy as unknown as NextMiddleware;
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it.each(["/dashboard", "/api/tournaments"])("allows members on %s", async (path) => {
    const response = await request(path);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([404, 500])("denies page and API requests after Discord returns %s", async (status) => {
    fetchMock.mockImplementation(async () => new Response("{}", { status }));
    const page = await request("/dashboard");
    expect(page.headers.get("location")).toBe(`http://localhost/login?error=${status === 404 ? "GuildMembershipRequired" : "GuildMembershipUnavailable"}`);
    const api = await request("/api/tournaments");
    expect(api.status).toBe(status === 404 ? 403 : 503);
    expect(await api.json()).toHaveProperty("error");
  });

  it("requires a session for pages and APIs", async () => {
    state.session = null;
    expect((await request("/dashboard")).headers.get("location")).toBe("http://localhost/login");
    expect((await request("/api/tournaments")).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["/login", "/api/auth", "/api/auth/session", "/api/auth/callback/discord", "/api/auth/signout", "/_next/static/app.js", "/_next/image", "/favicon.ico", "/icons/spell.svg"])("passes public path %s without membership checks", async (path) => {
    state.session = null;
    expect((await request(path)).headers.get("x-middleware-next")).toBe("1");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([404, 500])("allows sign-out when membership verification returns %s, while gating page actions", async (status) => {
    fetchMock.mockImplementation(async () => new Response("{}", { status }));
    expect((await request("/dashboard", "POST", { "Next-Action": "arbitrary-action" })).headers.get("location")).toContain("GuildMembership");
    const calls = fetchMock.mock.calls.length;
    for (const path of ["/api/auth/csrf", "/api/auth/signout"]) {
      expect((await request(path, path.endsWith("signout") ? "POST" : "GET")).headers.get("x-middleware-next")).toBe("1");
    }
    expect(fetchMock).toHaveBeenCalledTimes(calls);

    // Exercise the real public NextAuth endpoint with its CSRF cookie and a JWT.
    const { GET, POST } = await import("../app/api/auth/[...nextauth]/route");
    const { encode } = await import("@auth/core/jwt");
    const token = await encode({ token: { sub: "member", discordId: "member" }, secret: "session-secret", salt: "authjs.session-token" });
    const csrf = await GET(new NextRequest("http://localhost/api/auth/csrf"));
    const { csrfToken } = await csrf.json();
    const cookies = csrf.headers.getSetCookie().map((cookie) => cookie.split(";")[0]);
    cookies.push(`authjs.session-token=${token}`);
    const response = await POST(new NextRequest("http://localhost/api/auth/signout", {
      method: "POST",
      headers: { cookie: cookies.join("; "), "content-type": "application/x-www-form-urlencoded", "X-Auth-Return-Redirect": "1" },
      body: new URLSearchParams({ csrfToken, callbackUrl: "http://localhost/login" }),
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ url: "http://localhost/login" });
    expect(response.headers.getSetCookie()).toContainEqual(expect.stringMatching(/authjs.session-token=;.*Max-Age=0/));
    expect(fetchMock).toHaveBeenCalledTimes(calls);
  });

  it.each(["/dev/fx-lab", "/api/cards/89631139/image"])("allows public FX preview %s when enabled", async (path) => {
    vi.stubEnv("DUEL_FX_LAB", "1");
    state.session = null;
    expect((await request(path)).headers.get("x-middleware-next")).toBe("1");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 404 for the disabled lab without requiring login", async () => {
    state.session = null;
    expect((await request("/dev/fx-lab")).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
