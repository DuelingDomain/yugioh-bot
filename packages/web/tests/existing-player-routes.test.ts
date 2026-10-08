import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { NextRequest, type NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { createUserService, type User } from "@yugidraft/shared/services";
import { sessionFixture } from "./fixtures/session";

const mock = vi.hoisted(() => ({ db: null as unknown as Database.Database, get: vi.fn(), metadata: vi.fn(), list: vi.fn(), create: vi.fn(), remove: vi.fn(), token: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: () => mock.db }));
vi.mock("@/lib/session-identity", () => sessionFixture(() => null));
vi.mock("@clerk/nextjs/server", () => ({ clerkClient: async () => ({ users: { getUser: mock.get, updateUserMetadata: mock.metadata, getUserList: mock.list, createUser: mock.create, deleteUser: mock.remove }, signInTokens: { createSignInToken: mock.token } }) }));
import { GET as start } from "../app/api/auth/existing-player/start/route";
import { GET as callback } from "../app/api/auth/callback/discord/route";
import { POST as complete } from "../app/api/auth/existing-player/complete/route";
import { POST as ticket } from "../app/api/auth/existing-player/ticket/route";
import { IDENTITY_COOKIE, OAUTH_COOKIE, TICKET_COOKIE, readIdentity, sealCookie, openCookie } from "../src/lib/existing-player";
import { syncClerkUser } from "../src/lib/clerk-sync";

const ORIGIN = "https://app.test";
const discordId = "900000000000000101";
const clerkUser = (id: string) => ({ id, banned: false, locked: false, externalAccounts: [], privateMetadata: {} });
let player: User;
let fetcher: ReturnType<typeof vi.fn>;
let ip = 0;
function request(path: string, options: { cookie?: string; method?: string; body?: unknown; origin?: string | null } = {}) {
  const method = options.method ?? "GET";
  return new NextRequest(`${ORIGIN}${path}`, { method, headers: {
    "x-forwarded-for": `192.0.2.${++ip}`, ...(options.cookie ? { cookie: options.cookie } : {}),
    ...(method === "POST" ? { "content-type": "application/json", ...(options.origin !== null ? { origin: options.origin ?? ORIGIN } : {}) } : {}),
  }, ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }) });
}
async function proof() {
  const res = await start(request("/api/auth/existing-player/start"));
  const url = new URL(res.headers.get("location")!);
  return { state: url.searchParams.get("state")!, cookie: `${OAUTH_COOKIE}=${res.cookies.get(OAUTH_COOKIE)!.value}` };
}
async function verifiedCallback(profile: Record<string, unknown> = {}) {
  const p = await proof();
  fetcher.mockResolvedValueOnce(Response.json({ access_token: "fake-discord-token", token_type: "Bearer" }))
    .mockResolvedValueOnce(Response.json({ id: discordId, username: "discord_yugi", email: "YUGI@test.dev", verified: true, ...profile }));
  return callback(request(`/api/auth/callback/discord?state=${p.state}&code=test-code`, { cookie: p.cookie }));
}
function completionCookie() {
  return `${IDENTITY_COOKIE}=${sealCookie("identity", { userId: player.id, discordId, email: "yugi@test.dev", discordUsername: "discord_yugi" })}`;
}
function expectCleared(res: NextResponse) {
  for (const name of [OAUTH_COOKIE, IDENTITY_COOKIE]) expect(res.cookies.get(name)?.value).toBe("");
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("WEB_URL", ORIGIN); vi.stubEnv("CLERK_SECRET_KEY", "test-only-clerk-secret");
  vi.stubEnv("DISCORD_CLIENT_ID", "test-client"); vi.stubEnv("DISCORD_CLIENT_SECRET", "test-only-discord-secret");
  mock.db = new Database(":memory:"); migrate(mock.db);
  player = createUserService(mock.db).ensureDiscord({ discordUserId: discordId, displayName: "Yugi" });
  mock.list.mockResolvedValue({ data: [], totalCount: 0 }); mock.create.mockResolvedValue({ id: "user_created" });
  mock.get.mockImplementation(async (id: string) => clerkUser(id)); mock.metadata.mockResolvedValue({});
  mock.remove.mockResolvedValue({}); mock.token.mockResolvedValue({ token: "fake-clerk-ticket" });
  fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => { mock.db.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("Discord recovery start and cookies", () => {
  it("uses the registered redirect, silent OAuth, state and S256 PKCE in an authenticated secure cookie", async () => {
    const res = await start(request("/api/auth/existing-player/start"));
    expect(res.status).toBe(303);
    const url = new URL(res.headers.get("location")!);
    expect(url.origin).toBe("https://discord.com");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ client_id: "test-client", redirect_uri: `${ORIGIN}/api/auth/callback/discord`, response_type: "code", scope: "identify email", prompt: "none", code_challenge_method: "S256" });
    const cookie = res.cookies.get(OAUTH_COOKIE)!;
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 600 });
    const claims = openCookie<{ state: string; verifier: string }>("oauth", cookie.value)!;
    expect(claims.state).toBe(url.searchParams.get("state"));
    expect(claims.verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(url.searchParams.get("code_challenge")).toBe(createHash("sha256").update(claims.verifier).digest("base64url"));
    expect(url.searchParams.has("code_verifier")).toBe(false);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
  it("rejects tampered, expired, and wrong-purpose cookies", () => {
    const value = sealCookie("identity", { userId: player.id, discordId, email: "a@test.dev", discordUsername: "yugi" });
    expect(readIdentity(value)).toMatchObject({ userId: player.id });
    expect(readIdentity(value.slice(0, -5) + "AAAAA")).toBeNull();
    expect(openCookie("oauth", value)).toBeNull();
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 600_001);
    expect(readIdentity(value)).toBeNull();
  });
  it("limits repeated starts for one client", async () => {
    for (let i = 0; i < 10; i++) {
      const req = request("/api/auth/existing-player/start"); req.headers.set("x-forwarded-for", "198.51.100.1");
      expect((await start(req)).status).toBe(303);
    }
    const req = request("/api/auth/existing-player/start"); req.headers.set("x-forwarded-for", "198.51.100.1");
    const res = await start(req); expect(res.status).toBe(429); expect(res.headers.has("retry-after")).toBe(true);
  });
});
describe("Discord recovery callback", () => {
  it.each(["access_denied", "cancelled"])("returns Discord error=%s to a friendly sign-in page", async error => {
    const p = await proof();
    const res = await callback(request(`/api/auth/callback/discord?state=${p.state}&error=${error}`, { cookie: p.cookie }));
    expect(res.status).toBe(303); expect(res.headers.get("location")).toBe(`${ORIGIN}/sign-in?error=discord_recovery_cancelled`);
    expect(fetcher).not.toHaveBeenCalled(); expect(mock.token).not.toHaveBeenCalled(); expectCleared(res);
  });
  it.each(["", "?state=untrusted&code=x"])("rejects missing proof before contacting Discord (%s)", async query => {
    const res = await callback(request(`/api/auth/callback/discord${query}`));
    expect(res.status).toBe(400); expect(fetcher).not.toHaveBeenCalled(); expectCleared(res);
  });
  it("rejects mismatched state and clears cookies", async () => {
    const p = await proof(); const res = await callback(request("/api/auth/callback/discord?state=wrong&code=x", { cookie: p.cookie }));
    expect(res.status).toBe(400); expect(fetcher).not.toHaveBeenCalled(); expectCleared(res);
  });
  it("rejects Unicode state of equal character length without an exception", async () => {
    const p = await proof(); const state = "é" + p.state.slice(1);
    const res = await callback(request(`/api/auth/callback/discord?state=${encodeURIComponent(state)}&code=x`, { cookie: p.cookie }));
    expect(res.status).toBe(400); expect(fetcher).not.toHaveBeenCalled();
  });
  it("never creates users for unknown Discord accounts", async () => {
    const res = await verifiedCallback({ id: "900000000000000999" });
    expect(res.headers.get("location")).toBe(`${ORIGIN}/access`); expect(mock.create).not.toHaveBeenCalled(); expectCleared(res);
    expect(mock.db.prepare("select count(*) as n from users").get()).toEqual({ n: 1 });
  });
  it.each([{ verified: false }, { verified: "true" }, { email: null }, { email: "" }])("refuses missing/unverified Discord email %j", async profile => {
    const res = await verifiedCallback(profile); expect(res.headers.get("location")).toBe(`${ORIGIN}/access`); expectCleared(res);
  });
  it("exchanges with the PKCE verifier and sets only an encrypted identity for the interstitial", async () => {
    const res = await verifiedCallback();
    expect(res.headers.get("location")).toBe(`${ORIGIN}/welcome-back`);
    const [url, init] = fetcher.mock.calls[0]; expect(url).toBe("https://discord.com/api/oauth2/token");
    expect(init.method).toBe("POST"); expect(init.body.get("code_verifier")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(init.body.get("redirect_uri")).toBe(`${ORIGIN}/api/auth/callback/discord`);
    expect(readIdentity(res.cookies.get(IDENTITY_COOKIE)?.value)).toEqual({ userId: player.id, discordId, email: "yugi@test.dev", discordUsername: "discord_yugi" });
    expect(res.cookies.get(IDENTITY_COOKIE)).toMatchObject({ httpOnly: true, secure: true, sameSite: "lax", maxAge: 600 });
    expect(res.cookies.get(IDENTITY_COOKIE)!.value).not.toContain("yugi");
    expect(res.cookies.get(OAUTH_COOKIE)?.value).toBe("");
  });
  it("signs a proven, already-linked Discord row into its stored Clerk ID", async () => {
    createUserService(mock.db).claimExistingDiscordUser(player.id, discordId, "user_stored");
    const res = await verifiedCallback(); expect(res.headers.get("location")).toBe(`${ORIGIN}/sign-in?existing_player=1`);
    expect(mock.token).toHaveBeenCalledWith({ userId: "user_stored", expiresInSeconds: 120 });
    expect(mock.list).not.toHaveBeenCalled(); expect(mock.create).not.toHaveBeenCalled(); expectCleared(res);
  });
  it.each([{ verified: false }, { email: null }, { email: "" }])("recovers an already-linked row without requiring Discord email %j", async profile => {
    createUserService(mock.db).claimExistingDiscordUser(player.id, discordId, "user_stored");
    const res = await verifiedCallback(profile);
    expect(res.headers.get("location")).toBe(`${ORIGIN}/sign-in?existing_player=1`);
    expect(mock.token).toHaveBeenCalledWith({ userId: "user_stored", expiresInSeconds: 120 });
  });
  it("preserves an already-linked Discord row through the real first web sync and second recovery", async () => {
    const users = createUserService(mock.db);
    users.claimExistingDiscordUser(player.id, discordId, "user_stored");
    const playerId = Number(mock.db.prepare("insert into players(guild_id,user_id,discord_user_id,display_name) values('g',?,?,?)").run(player.id, discordId, "Yugi").lastInsertRowid);
    const stored = { ...clerkUser("user_stored"), privateMetadata: { unrelated: "preserve" } as Record<string, unknown> };
    mock.get.mockResolvedValue(stored);
    mock.metadata.mockImplementation(async (id, params) => {
      expect(id).toBe("user_stored"); stored.privateMetadata = { ...stored.privateMetadata, ...params.privateMetadata }; return stored;
    });
    const first = await verifiedCallback();
    expect(first.headers.get("location")).toBe(`${ORIGIN}/sign-in?existing_player=1`);
    fetcher.mockResolvedValueOnce(Response.json({ id: stored.id, username: "yugi", first_name: null, last_name: null, image_url: null,
      external_id: String(player.id), private_metadata: stored.privateMetadata, primary_email_address_id: null, email_addresses: [], external_accounts: [] }));
    const result = await syncClerkUser("user_stored");
    expect(result.user).toMatchObject({ id: player.id, clerkUserId: "user_stored", discordUserId: discordId });
    expect(users.findByDiscordId(discordId)?.id).toBe(player.id);
    expect(mock.db.prepare("select id,user_id,discord_user_id from players").get()).toEqual({ id: playerId, user_id: player.id, discord_user_id: discordId });
    expect(stored.privateMetadata.unrelated).toBe("preserve");
    expect(mock.metadata.mock.invocationCallOrder[0]).toBeLessThan(mock.token.mock.invocationCallOrder[0]);
    const second = await verifiedCallback();
    expect(second.headers.get("location")).toBe(`${ORIGIN}/sign-in?existing_player=1`);
    expect(mock.token).toHaveBeenCalledTimes(2); expect(mock.metadata).toHaveBeenCalledTimes(1);
  });
  it.each(["banned", "locked", "deleted", "missing", "404"])("refuses a %s stored Clerk user with a support redirect", async status => {
    createUserService(mock.db).claimExistingDiscordUser(player.id, discordId, "user_stored");
    if (status === "404") mock.get.mockRejectedValue({ status: 404 });
    else mock.get.mockResolvedValue(status === "missing" ? null : { ...clerkUser("user_stored"), [status]: true });
    const res = await verifiedCallback();
    expect(res.status).toBe(303); expect(res.headers.get("location")).toBe(`${ORIGIN}/sign-in?error=discord_recovery_support`);
    expect(mock.get).toHaveBeenCalledWith("user_stored"); expect(mock.token).not.toHaveBeenCalled(); expect(mock.metadata).not.toHaveBeenCalled(); expectCleared(res);
    expect(createUserService(mock.db).findByDiscordId(discordId)?.id).toBe(player.id);
  });
  it("always redirects a refused callback even when the GET client accepts JSON", async () => {
    createUserService(mock.db).claimExistingDiscordUser(player.id, discordId, "user_stored");
    mock.get.mockResolvedValue({ ...clerkUser("user_stored"), banned: true });
    const p = await proof();
    fetcher.mockResolvedValueOnce(Response.json({ access_token: "fake-discord-token" }))
      .mockResolvedValueOnce(Response.json({ id: discordId, email: "yugi@test.dev", verified: true }));
    const req = request(`/api/auth/callback/discord?state=${p.state}&code=test-code`, { cookie: p.cookie });
    req.headers.set("accept", "application/json");
    const res = await callback(req);
    expect(res.status).toBe(303); expect(res.headers.get("location")).toBe(`${ORIGIN}/sign-in?error=discord_recovery_support`);
    expect(mock.token).not.toHaveBeenCalled();
  });
  it.each(["external", "metadata"])("refuses a stored Clerk user claiming another Discord ID via %s", async claim => {
    createUserService(mock.db).claimExistingDiscordUser(player.id, discordId, "user_stored");
    mock.get.mockResolvedValue({ ...clerkUser("user_stored"), ...(claim === "external"
      ? { externalAccounts: [{ provider: "oauth_discord", providerUserId: "900000000000000999", verification: { status: "verified" } }], privateMetadata: { existingPlayerDiscordId: discordId } }
      : { privateMetadata: { existingPlayerDiscordId: "900000000000000999" } }) });
    const res = await verifiedCallback();
    expect(res.headers.get("location")).toBe(`${ORIGIN}/sign-in?error=discord_recovery_support`);
    expect(mock.token).not.toHaveBeenCalled(); expect(mock.metadata).not.toHaveBeenCalled();
  });
  it.each(["external", "metadata"])("accepts a matching %s Discord claim without rewriting metadata", async claim => {
    createUserService(mock.db).claimExistingDiscordUser(player.id, discordId, "user_stored");
    mock.get.mockResolvedValue({ ...clerkUser("user_stored"), ...(claim === "external"
      ? { externalAccounts: [{ provider: "oauth_discord", providerUserId: discordId, verification: { status: "verified" } }] }
      : { privateMetadata: { existingPlayerDiscordId: discordId } }) });
    const res = await verifiedCallback();
    expect(res.headers.get("location")).toBe(`${ORIGIN}/sign-in?existing_player=1`); expect(mock.metadata).not.toHaveBeenCalled();
  });
  it("never issues a recovery ticket if saving the bootstrap Discord proof fails", async () => {
    createUserService(mock.db).claimExistingDiscordUser(player.id, discordId, "user_stored");
    mock.metadata.mockRejectedValue(new Error("private provider failure"));
    const res = await verifiedCallback();
    expect(res.status).toBe(503); expect(mock.token).not.toHaveBeenCalled();
    expect(await res.text()).not.toContain("private provider failure"); expectCleared(res);
  });
  it("handles Discord provider failure without exposing upstream credentials", async () => {
    const p = await proof(); fetcher.mockRejectedValue(new Error("sensitive provider error"));
    const res = await callback(request(`/api/auth/callback/discord?state=${p.state}&code=x`, { cookie: p.cookie }));
    expect(res.status).toBe(503); expect(await res.text()).not.toContain("sensitive"); expectCleared(res);
  });
});
describe("recovery completion", () => {
  it.each([false, "true", undefined])("requires literal consent=true (%s)", async consent => {
    const res = await complete(request("/api/auth/existing-player/complete", { method: "POST", cookie: completionCookie(), body: { consent } }));
    expect(res.status).toBe(400); expect(mock.create).not.toHaveBeenCalled();
  });
  it.each(["https://evil.test", null])("requires same-origin (%s)", async origin => {
    const res = await complete(request("/api/auth/existing-player/complete", { method: "POST", origin, cookie: completionCookie(), body: { consent: true } }));
    expect(res.status).toBe(403); expect(mock.create).not.toHaveBeenCalled();
  });
  it("accepts the public Origin behind a reverse proxy using an internal request URL", async () => {
    const req = new NextRequest("http://web:3000/api/auth/existing-player/complete", { method: "POST", headers: {
      origin: ORIGIN, "content-type": "application/json", cookie: completionCookie(), "x-forwarded-for": `192.0.2.${++ip}`,
    }, body: JSON.stringify({ consent: true }) });
    expect((await complete(req)).status).toBe(303);
  });
  it("bounds bodies without trusting Content-Length", async () => {
    const req = request("/api/auth/existing-player/complete", { method: "POST", cookie: completionCookie(), body: { consent: true, padding: "x".repeat(2048) } });
    expect((await complete(req)).status).toBe(413); expect(mock.create).not.toHaveBeenCalled();
  });
  it("requires valid proof and refuses a replaced Discord identity", async () => {
    let res = await complete(request("/api/auth/existing-player/complete", { method: "POST", body: { consent: true } }));
    expect(res.status).toBe(400);
    const cookie = completionCookie(); mock.db.prepare("update users set discord_user_id=null where id=?").run(player.id);
    res = await complete(request("/api/auth/existing-player/complete", { method: "POST", cookie, body: { consent: true } }));
    expect(res.status).toBe(409); expect(mock.create).not.toHaveBeenCalled();
  });
  it("refuses an email-only Clerk match with a support error", async () => {
    mock.list.mockResolvedValue({ data: [{ id: "user_other" }], totalCount: 1 });
    const res = await complete(request("/api/auth/existing-player/complete", { method: "POST", cookie: completionCookie(), body: { consent: true } }));
    expect(res.status).toBe(409); expect((await res.json()).error).toContain("support@duelingdomain.com");
    expect(mock.create).not.toHaveBeenCalled(); expect(mock.token).not.toHaveBeenCalled(); expectCleared(res);
  });
  it("creates with legal acceptance, claims the original row and returns a cookie ticket", async () => {
    const res = await complete(request("/api/auth/existing-player/complete", { method: "POST", cookie: completionCookie(), body: { consent: true } }));
    expect(mock.list).toHaveBeenCalledWith({ emailAddress: ["yugi@test.dev"], limit: 1 });
    expect(mock.create).toHaveBeenCalledWith({ emailAddress: ["yugi@test.dev"], username: player.username, skipPasswordRequirement: true, legalAcceptedAt: expect.any(Date), externalId: String(player.id), privateMetadata: { existingPlayerDiscordId: discordId } });
    expect(createUserService(mock.db).findById(player.id)?.clerkUserId).toBe("user_created");
    expect(mock.db.prepare("select count(*) as n from users").get()).toEqual({ n: 1 });
    expect(mock.token).toHaveBeenCalledWith({ userId: "user_created", expiresInSeconds: 120 });
    expect(res.status).toBe(303); expect(res.headers.get("location")).toBe(`${ORIGIN}/sign-in?existing_player=1`); expectCleared(res);
    expect(res.cookies.get(TICKET_COOKIE)).toMatchObject({ httpOnly: true, secure: true, sameSite: "lax", maxAge: 120 });
    expect(res.headers.get("location")).not.toContain("fake-clerk-ticket");
    expect(console.info).toHaveBeenCalledWith(`[existing-player] users.id=${player.id} linked clerk user`);
  });
  it.each(["banned", "locked", "deleted"])("refuses a newly created Clerk user that is %s before ticket issuance", async status => {
    if (status === "deleted") mock.get.mockRejectedValue({ status: 404 });
    else mock.get.mockResolvedValue({ ...clerkUser("user_created"), [status]: true });
    const res = await complete(request("/api/auth/existing-player/complete", { method: "POST", cookie: completionCookie(), body: { consent: true } }));
    expect(res.status).toBe(303); expect(res.headers.get("location")).toBe(`${ORIGIN}/sign-in?error=discord_recovery_support`);
    expect(mock.get).toHaveBeenCalledWith("user_created"); expect(mock.token).not.toHaveBeenCalled(); expectCleared(res);
  });
  it.each(["banned", "deleted"])("returns a support message to the consent form when the created Clerk user is %s", async status => {
    if (status === "deleted") mock.get.mockRejectedValue({ status: 404 });
    else mock.get.mockResolvedValue({ ...clerkUser("user_created"), banned: true });
    const req = request("/api/auth/existing-player/complete", { method: "POST", cookie: completionCookie(), body: { consent: true } });
    req.headers.set("accept", "application/json");
    const res = await complete(req);
    expect(res.status).toBe(409); expect((await res.json()).error).toContain("support@duelingdomain.com");
    expect(mock.token).not.toHaveBeenCalled(); expect(res.cookies.get(TICKET_COOKIE)?.value).toBe(""); expectCleared(res);
  });
  it("retries a username collision with a valid unique suffix", async () => {
    mock.db.prepare("update users set username='A name! 💫' where id=?").run(player.id);
    mock.create.mockRejectedValueOnce({ errors: [{ code: "form_identifier_exists", meta: { paramName: "username" } }] }).mockResolvedValueOnce({ id: "user_created" });
    const res = await complete(request("/api/auth/existing-player/complete", { method: "POST", cookie: completionCookie(), body: { consent: true } }));
    expect(res.status).toBe(303); expect(mock.create).toHaveBeenCalledTimes(2);
    const names = mock.create.mock.calls.map(([params]) => params.username);
    expect(names[0]).toMatch(/^[a-zA-Z0-9_-]{4,64}$/); expect(names[1]).toMatch(/^[a-zA-Z0-9_-]{4,64}$/); expect(names[0]).not.toBe(names[1]);
  });
  it("does not retry an email collision that raced the lookup", async () => {
    mock.create.mockRejectedValue({ errors: [{ code: "form_identifier_exists", meta: { paramName: "email_address" } }] });
    const res = await complete(request("/api/auth/existing-player/complete", { method: "POST", cookie: completionCookie(), body: { consent: true } }));
    expect(res.status).toBe(409); expect(mock.create).toHaveBeenCalledTimes(1); expect(mock.token).not.toHaveBeenCalled();
  });
  it("deletes the new Clerk user when the DB row was claimed while creation awaited", async () => {
    mock.create.mockImplementation(async () => { createUserService(mock.db).claimExistingDiscordUser(player.id, discordId, "user_racer"); return { id: "user_created" }; });
    const res = await complete(request("/api/auth/existing-player/complete", { method: "POST", cookie: completionCookie(), body: { consent: true } }));
    expect(res.status).toBe(409); expect(mock.remove).toHaveBeenCalledWith("user_created"); expect(mock.token).not.toHaveBeenCalled(); expectCleared(res);
    expect(createUserService(mock.db).findById(player.id)?.clerkUserId).toBe("user_racer");
  });
  it("keeps a successful claim if ticket creation fails and permits a fresh Discord recovery", async () => {
    mock.token.mockRejectedValueOnce(new Error("sensitive token failure"));
    const res = await complete(request("/api/auth/existing-player/complete", { method: "POST", cookie: completionCookie(), body: { consent: true } }));
    expect(res.status).toBe(503); expect(await res.text()).not.toContain("sensitive"); expectCleared(res);
    expect(createUserService(mock.db).findById(player.id)?.clerkUserId).toBe("user_created"); expect(mock.remove).not.toHaveBeenCalled();
    const retry = await verifiedCallback(); expect(retry.status).toBe(303); expect(mock.create).toHaveBeenCalledTimes(1);
    expect(mock.token).toHaveBeenLastCalledWith({ userId: "user_created", expiresInSeconds: 120 });
  });
  it("refuses a completion proof already claimed before the request", async () => {
    createUserService(mock.db).claimExistingDiscordUser(player.id, discordId, "user_racer");
    const res = await complete(request("/api/auth/existing-player/complete", { method: "POST", cookie: completionCookie(), body: { consent: true } }));
    expect(res.status).toBe(409); expect(mock.create).not.toHaveBeenCalled(); expect(mock.token).not.toHaveBeenCalled();
  });
  it("consumes the HttpOnly ticket only via same-origin POST and clears it", async () => {
    const res = await complete(request("/api/auth/existing-player/complete", { method: "POST", cookie: completionCookie(), body: { consent: true } }));
    const cookie = `${TICKET_COOKIE}=${res.cookies.get(TICKET_COOKIE)!.value}`;
    expect((await ticket(request("/api/auth/existing-player/ticket", { method: "POST", cookie, origin: "https://evil.test" }))).status).toBe(403);
    const consumed = await ticket(request("/api/auth/existing-player/ticket", { method: "POST", cookie }));
    expect(await consumed.json()).toEqual({ ticket: "fake-clerk-ticket" }); expect(consumed.cookies.get(TICKET_COOKIE)?.value).toBe("");
    expect(consumed.headers.get("cache-control")).toBe("no-store");
  });
});
