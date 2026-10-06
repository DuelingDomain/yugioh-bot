import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "@yugidraft/shared/db";
import { createUserService } from "@yugidraft/shared/services";
import { renderToStaticMarkup } from "react-dom/server";
import { mockDiscordAccess } from "./fixtures/discord-access";

const identityState = vi.hoisted(() => ({ db: null as Database.Database | null }));
vi.mock("@/lib/db", () => ({ getDb: () => identityState.db! }));

const state = vi.hoisted(() => ({ config: null as any }));
vi.mock("next-auth", () => ({
  default: (config: unknown) => {
    state.config = config;
    return { handlers: { GET: vi.fn(), POST: vi.fn() }, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() };
  },
}));
vi.mock("next-auth/providers/discord", () => ({ default: () => ({}) }));
vi.mock("next/font/local", () => ({ default: () => ({ variable: "font-local" }) }));

let discord: ReturnType<typeof mockDiscordAccess>;
async function callbacks() {
  await import("../src/lib/auth");
  return state.config.callbacks;
}
const request = (path: string) => ({
  auth: { user: { id: "101", discordUserId: "900000000000000101" } }, request: { nextUrl: new URL(`http://localhost${path}`) },
});

describe("web guild membership", () => {
  beforeEach(() => {
    vi.resetModules();
    identityState.db = new Database(":memory:");
    migrate(identityState.db);
    vi.stubEnv("DISCORD_CLIENT_ID", "id");
    vi.stubEnv("DISCORD_CLIENT_SECRET", "secret");
    vi.stubEnv("NEXTAUTH_SECRET", "secret");
    vi.stubEnv("DISCORD_GUILD_ID", "guild-1");
    discord = mockDiscordAccess();
  });
  afterEach(() => {
    identityState.db?.close();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("allows members to sign in", async () => {
    expect(await (await callbacks()).signIn({ user: { id: "900000000000000101" }, profile: { id: "900000000000000101" }, account: { provider: "discord" } })).toBe(true);
    expect(identityState.db!.prepare("select discord_user_id from users").get()).toEqual({ discord_user_id: "900000000000000101" });
  });

  it("redirects outsiders at sign-in to a clear membership error", async () => {
    discord.memberStatus = 404;
    expect(await (await callbacks()).signIn({ user: { id: "900000000000000101" }, profile: { id: "900000000000000101" } })).toBe("/login?error=GuildMembershipRequired");
    expect(identityState.db!.prepare("select count(*) as c from users").get()).toEqual({ c: 0 });
  });

  it("reports unavailable membership at sign-in", async () => {
    discord.memberStatus = 500;
    expect(await (await callbacks()).signIn({ user: { id: "900000000000000101" }, profile: { id: "900000000000000101" } })).toBe("/login?error=GuildMembershipUnavailable");
    expect(identityState.db!.prepare("select count(*) as c from users").get()).toEqual({ c: 0 });
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
    ["GuildMembershipRequired", /Access opens in waves/],
    ["GuildMembershipUnavailable", /check your access just now/],
  ] as const)("renders the %s error", async (error, message) => {
    const { default: LoginPage } = await import("../app/(auth)/login/page");
    const markup = renderToStaticMarkup(await LoginPage({ searchParams: Promise.resolve({ error }) }));
    expect(markup).toMatch(message);
  });
});


describe("NextAuth application identity callbacks", () => {
  beforeEach(() => {
    vi.resetModules();
    identityState.db = new Database(":memory:");
    migrate(identityState.db);
    vi.stubEnv("DISCORD_CLIENT_ID", "id");
    vi.stubEnv("DISCORD_CLIENT_SECRET", "secret");
    vi.stubEnv("NEXTAUTH_SECRET", "secret");
    vi.stubEnv("DISCORD_GUILD_ID", "guild-1");
    discord = mockDiscordAccess();
  });
  afterEach(() => {
    identityState.db?.close();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("lazily upgrades a signed old JWT and emits a string application ID", async () => {
    const imported = createUserService(identityState.db!).ensureDiscord({ discordUserId: "900000000000000101", displayName: "Imported Yugi" });
    const cb = await callbacks();
    const token = await cb.jwt({ token: { discordId: "900000000000000101", sub: "999", userId: 999 } });
    const session = await cb.session({ session: { user: { name: "Yugi" } }, token });
    expect(token.userId).toBe(imported.id);
    expect(session.user.id).toBe(String(imported.id));
    expect(session.user.id).not.toBe("999");
    expect(session.user.discordUserId).toBe("900000000000000101");
    expect(identityState.db!.prepare("select count(*) as c from users").get()).toEqual({ c: 1 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    { sub: "1" }, { sub: "101" }, { sub: "900000000000000101" },
    { id: "1" }, { id: "900000000000000101" }, { userId: 1 },
    { sub: "01", userId: 1 }, { sub: 1, userId: 1 },
    { discordId: 900000000000000101, userId: 1 }, { discordId: "fake_yugi", userId: 1 },
  ])("never authenticates from legacy sub/id/cached userId: %j", async (legacyToken) => {
    createUserService(identityState.db!).ensureDiscord({ discordUserId: "900000000000000101", displayName: "Real owner" });
    const cb = await callbacks();
    const token = await cb.jwt({ token: { ...legacyToken } });
    expect(token.userId).toBeUndefined();
    const session = await cb.session({ session: { user: { id: "1", discordUserId: "900000000000000101" } }, token });
    expect(session.user.id).toBe("");
    expect(session.user.discordUserId).toBeNull();
    expect(identityState.db!.prepare("select count(*) as c from users").get()).toEqual({ c: 1 });
  });

  it("rereads Discord identity rather than trusting a cached application ID in the session callback", async () => {
    const user = createUserService(identityState.db!).ensureDiscord({ discordUserId: "900000000000000101", displayName: "Yugi" });
    const cb = await callbacks();
    const session = await cb.session({ session: { user: { name: "Yugi", email: "display@example.com", image: "avatar" }, expires: "2099" }, token: { discordId: "900000000000000101", userId: 999, sub: "999" } });
    expect(session).toEqual({ user: { id: String(user.id), discordUserId: "900000000000000101", name: "Yugi", email: "display@example.com", image: "avatar" }, expires: "2099" });
  });

  it("ignores profile IDs from providers other than Discord and E2E", async () => {
    const cb = await callbacks();
    const token = await cb.jwt({ token: {}, account: { provider: "other" }, profile: { id: "900000000000000101" } });
    expect((await cb.session({ session: { user: {} }, token })).user.id).toBe("");
  });

  it("captures only Discord's profile email and explicit verification", async () => {
    const cb = await callbacks();
    const user = { id: "900000000000000101", name: "Yugi", email: "user-object@example.com" };
    const account = { provider: "discord" };
    expect(await cb.signIn({ user, account, profile: { id: user.id, email: " YUGI@Example.COM ", verified: true } })).toBe(true);
    expect(createUserService(identityState.db!).findByDiscordId(user.id)).toMatchObject({ email: "yugi@example.com", emailVerified: true });
    expect(await cb.signIn({ user, account, profile: { id: user.id, email: "other@example.com", verified: "true" } })).toBe(true);
    expect(createUserService(identityState.db!).findByDiscordId(user.id)).toMatchObject({ email: "other@example.com", emailVerified: false });
    expect(await cb.signIn({ user, account, profile: { id: user.id, verified: false } })).toBe(true);
    expect(createUserService(identityState.db!).findByDiscordId(user.id)).toMatchObject({ email: null, emailVerified: false });
  });

  it("does not verify email from an E2E credentials user", async () => {
    const cb = await callbacks();
    expect(await cb.signIn({ user: { id: "900000000000000101", name: "E2E", email: "fake@example.com" }, account: { provider: "e2e" }, profile: { email: "fake@example.com", verified: true } })).toBe(true);
    expect(createUserService(identityState.db!).findByDiscordId("900000000000000101"))
      .toMatchObject({ email: null, emailVerified: false });
  });

  it("uses the explicit Discord ID in proxy membership requests", async () => {
    expect(await (await callbacks()).authorized(request("/dashboard"))).toBe(true);
    expect(fetch).toHaveBeenCalledWith("https://discord.com/api/v10/guilds/guild-1/members/900000000000000101", expect.any(Object));
    expect(fetch).not.toHaveBeenCalledWith("https://discord.com/api/v10/guilds/guild-1/members/101", expect.any(Object));
  });

  it("denies a session missing its separate Discord identity", async () => {
    const response = await (await callbacks()).authorized({ ...request("/api/settings"), auth: { user: { id: "101" } } });
    expect(response.status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([101, "01", "1e3", "900000000000000101"])("denies a malformed application ID in proxy session: %s", async (id) => {
    const response = await (await callbacks()).authorized({ ...request("/api/settings"), auth: { user: { id, discordUserId: "900000000000000101" } } });
    expect(response.status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });
});
