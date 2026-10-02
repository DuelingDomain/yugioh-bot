import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { mockDiscordAccess } from "./fixtures/discord-access";

const state = vi.hoisted(() => ({ config: null as any }));
vi.mock("next-auth", () => ({
  default: (config: unknown) => {
    state.config = config;
    return { handlers: { GET: vi.fn(), POST: vi.fn() }, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() };
  },
}));
vi.mock("next-auth/providers/discord", () => ({ default: () => ({}) }));

let discord: ReturnType<typeof mockDiscordAccess>;
async function callbacks() {
  await import("../src/lib/auth");
  return state.config.callbacks;
}
const request = (path: string) => ({
  auth: { user: { id: "member" } }, request: { nextUrl: new URL(`http://localhost${path}`) },
});

describe("web guild membership", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("DISCORD_CLIENT_ID", "id");
    vi.stubEnv("DISCORD_CLIENT_SECRET", "secret");
    vi.stubEnv("NEXTAUTH_SECRET", "secret");
    vi.stubEnv("DISCORD_GUILD_ID", "guild-1");
    discord = mockDiscordAccess();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("allows members to sign in", async () => {
    expect(await (await callbacks()).signIn({ user: { id: "member" }, profile: { id: "member" } })).toBe(true);
  });

  it("redirects outsiders at sign-in to a clear membership error", async () => {
    discord.memberStatus = 404;
    expect(await (await callbacks()).signIn({ user: { id: "member" }, profile: { id: "member" } })).toBe("/login?error=GuildMembershipRequired");
  });

  it("reports unavailable membership at sign-in", async () => {
    discord.memberStatus = 500;
    expect(await (await callbacks()).signIn({ user: { id: "member" }, profile: { id: "member" } })).toBe("/login?error=GuildMembershipUnavailable");
  });

  it.each(["POST", "GET", "PUT", "PATCH", "DELETE"])("denies non-member %s API requests with JSON 403", async (method) => {
    discord.memberStatus = 404;
    const args = request("/api/tournaments");
    const res = await (await callbacks()).authorized({ ...args, request: { ...args.request, method } });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: expect.stringMatching(/member/i) });
  });

  it("denies signed-out API requests with 401", async () => {
    const res = await (await callbacks()).authorized({ ...request("/api/settings"), auth: null });
    expect(res.status).toBe(401);
  });

  it.each(["discord", "token", "guild"])("denies API requests when %s is unavailable", async (cause) => {
    if (cause === "token") vi.stubEnv("DISCORD_TOKEN", "");
    else if (cause === "guild") vi.stubEnv("DISCORD_GUILD_ID", "");
    else discord.memberStatus = 500;
    const res = await (await callbacks()).authorized(request("/api/cards/resolve"));
    expect(res.status).toBe(503);
  });

  it("redirects denied pages to the error message without looping on login", async () => {
    discord.memberStatus = 404;
    const { authorized } = await callbacks();
    const res = await authorized(request("/dashboard"));
    expect(res.headers.get("location")).toBe("http://localhost/login?error=GuildMembershipRequired");
    expect(await authorized(request("/login?error=GuildMembershipRequired"))).toBe(true);
  });

  it("shows a page error when Discord is unavailable", async () => {
    discord.memberStatus = 500;
    const res = await (await callbacks()).authorized(request("/dashboard"));
    expect(res.headers.get("location")).toBe("http://localhost/login?error=GuildMembershipUnavailable");
  });

  it("revokes an existing session when the member is kicked after the TTL", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const { authorized } = await callbacks();
    expect(await authorized(request("/dashboard"))).toBe(true);
    discord.memberStatus = 404;
    vi.setSystemTime(60_999);
    expect(await authorized(request("/dashboard"))).toBe(true);
    vi.setSystemTime(61_000);
    const res = await authorized(request("/api/settings"));
    expect(res.status).toBe(403);
  });

  it.each([
    ["GuildMembershipRequired", /must be a member of the Discord server/i],
    ["GuildMembershipUnavailable", /cannot verify.*membership/i],
  ] as const)("renders the %s error", async (error, message) => {
    const { default: LoginPage } = await import("../app/(auth)/login/page");
    const markup = renderToStaticMarkup(await LoginPage({ searchParams: Promise.resolve({ error }) }));
    expect(markup).toMatch(message);
  });
});
