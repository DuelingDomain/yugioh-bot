import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import type Database from "better-sqlite3";
import { openDatabase, migrate } from "@yugidraft/shared/db";
import { deleteUserAccount } from "@yugidraft/shared/services";
import { signTournamentRequest } from "@yugidraft/shared/tournament-bridge";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ access: vi.fn(), currentUser: vi.fn(), getDb: vi.fn() }));
vi.mock("@/lib/web-access", () => ({ requireWebAccess: state.access }));
vi.mock("@clerk/nextjs/server", () => ({ currentUser: state.currentUser }));
vi.mock("@/lib/db", () => ({ getDb: state.getDb }));
import { GET as start } from "../app/api/tournament-bridge/start/route";
import { GET as search } from "../app/api/tournament-bridge/users/search/route";
import { POST as lookup } from "../app/api/tournament-bridge/users/lookup/route";
import { PUT as member } from "../app/api/tournament-bridge/users/[id]/member-id/route";

let db: Database.Database;
const secret = "tournament-bridge-test-secret-32-chars";
const base = "/api/tournament-bridge";
const marker = "__Host-dd_tournament_return=1";
const expiredMarker = /^__Host-dd_tournament_return=;.*Max-Age=0;.*Secure;.*HttpOnly;.*SameSite=lax/i;
const expectedUser = { id: 1, username: "Ada_Name", displayName: "Ada Example", discordUserId: "123456", discordUsername: "ada.discord", memberId: "1234567895" };
function signed(path: string, method = "GET", body?: unknown, raw = false): Request {
  const rawBody = body === undefined ? "" : raw ? String(body) : JSON.stringify(body);
  return new Request(`https://app.test${path}`, { method, headers: { "x-bridge-signature": signTournamentRequest({ secret, method, pathWithQuery: path, rawBody }) },
    ...(method === "GET" ? {} : { body: rawBody }) });
}
const lookupIds = (ids: unknown) => lookup(signed(`${base}/users/lookup`, "POST", { ids }));
const searchExact = (q: string) => search(signed(`${base}/users/search?q=${encodeURIComponent(q)}&exact=1`));
const setMember = (id: string, memberId: unknown) => member(signed(`${base}/users/${id}/member-id`, "PUT", { memberId }), { params: Promise.resolve({ id }) });
const startRequest = (path = "/events/one?desk=1", cookie?: string) =>
  new NextRequest(`https://app.test${base}/start?return=${encodeURIComponent(path)}`, { headers: cookie ? { cookie } : undefined });
beforeEach(() => {
  db = openDatabase(":memory:");
  db.exec(`insert into users(id,clerk_user_id,username,display_name,discord_user_id,email) values
    (1,'clerk1','Ada_Name','Ada Example','123456','private@example.test'),
    (2,'clerk2','bea','Bea Example',null,'bea@example.test');
    insert into user_profile_ids(user_id,member_id,discord_username,updated_at) values (1,'1234567895','ada.discord','2026-01-01');`);
  vi.clearAllMocks();
  state.getDb.mockReturnValue(db);
  state.access.mockResolvedValue({ ok: true, userId: 1, discordUserId: "123456", userName: "Ada Example" });
  state.currentUser.mockResolvedValue({ externalAccounts: [{ provider: "oauth_discord", providerUserId: "123456", username: "refreshed.discord" }] });
  vi.stubEnv("TOURNAMENT_URL", "https://tournament.test"); vi.stubEnv("TOURNAMENT_BRIDGE_SECRET", secret);
});
afterEach(() => { db.close(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

it("redirects to the separate callback with a signed identity assertion and refreshes Discord once", async () => {
  const response = await start(startRequest(undefined, marker));
  expect(response.status).toBe(302);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(response.headers.get("set-cookie")).toMatch(expiredMarker);
  const callback = new URL(response.headers.get("location")!);
  expect(callback.origin + callback.pathname).toBe("https://tournament.test/auth/callback");
  const [payload, signature] = callback.searchParams.get("assertion")!.split(".");
  expect(signature).toBe(createHmac("sha256", secret).update(`dd-tournament-assertion.v1.${payload}`).digest("hex"));
  const claims = JSON.parse(Buffer.from(payload!, "base64url").toString("utf8"));
  expect(claims.user).toEqual({ ...expectedUser, discordUsername: "refreshed.discord" });
  expect(claims.return).toBe("/events/one?desk=1");
  expect(state.currentUser).toHaveBeenCalledOnce();
  expect(db.prepare("select discord_username, member_id from user_profile_ids where user_id=1").get()).toEqual({ discord_username: "refreshed.discord", member_id: "1234567895" });
});

it("preserves the return through normal anonymous sign-in and propagates identity outages", async () => {
  state.access.mockResolvedValue({ ok: false, response: Response.json({ error: "unauthorized" }, { status: 401 }) });
  const response = await start(startRequest());
  const signIn = new URL(response.headers.get("location")!);
  expect(signIn.pathname).toBe("/sign-in");
  expect(signIn.searchParams.get("redirect_url")).toBe(new URL(startRequest().url).pathname + new URL(startRequest().url).search);
  expect(state.currentUser).not.toHaveBeenCalled(); expect(state.getDb).not.toHaveBeenCalled();
  state.access.mockResolvedValue({ ok: false, response: Response.json({ error: "session_unavailable" }, { status: 503 }) });
  expect((await start(startRequest())).status).toBe(503);
  const failedHandoff = await start(startRequest(undefined, marker));
  expect(failedHandoff.status).toBe(302);
  expect(failedHandoff.headers.get("location")).toBe("https://app.test/dashboard");
  expect(failedHandoff.headers.get("set-cookie")).toMatch(expiredMarker);
});

it.each(["//outside.test", "/\\outside.test", "https://outside.test", "", "/\n/outside.test", "/" + "x".repeat(512)])("rejects unsafe return %j before identity access", async path => {
  expect((await start(startRequest(path))).status).toBe(400);
  expect(state.access).not.toHaveBeenCalled();
});
it("accepts a 512 character relative return and defaults a missing return to /", async () => {
  expect((await start(startRequest("/" + "x".repeat(511)))) .status).toBe(302);
  const response = await start(new NextRequest(`https://app.test${base}/start`));
  const assertion = new URL(response.headers.get("location")!).searchParams.get("assertion")!;
  expect(JSON.parse(Buffer.from(assertion.split(".")[0]!, "base64url").toString()).return).toBe("/");
});

it.each(["unavailable", "unlinked", "mismatched"])("handles an optional Discord refresh that is %s", async kind => {
  if (kind === "unavailable") state.currentUser.mockRejectedValue(new Error("provider unavailable"));
  else state.currentUser.mockResolvedValue({ externalAccounts: kind === "unlinked" ? [] : [{ provider: "oauth_discord", providerUserId: "another-id", username: "another-user" }] });
  expect((await start(startRequest())).status).toBe(302);
  expect(db.prepare("select discord_username from user_profile_ids where user_id=1").get()).toEqual({ discord_username: kind === "unavailable" ? "ada.discord" : null });
  expect(state.currentUser).toHaveBeenCalledOnce();
});

it("does not restore a profile when account deletion completes during the Clerk refresh", async () => {
  state.currentUser.mockImplementationOnce(async () => {
    deleteUserAccount(db, 1);
    return { externalAccounts: [{ provider: "oauth_discord", providerUserId: "123456", username: "refreshed.discord" }] };
  });
  expect((await start(startRequest())).status).toBe(404);
  expect(db.prepare("select * from user_profile_ids").all()).toEqual([]);
});

it("404s all disabled handlers and rejects incomplete enabled configuration without touching identities", async () => {
  vi.stubEnv("TOURNAMENT_URL", "");
  for (const response of [await start(startRequest()), await search(signed(`${base}/users/search?q=ada`)), await lookupIds([1]), await setMember("1", "12345")]) {
    expect(response.status).toBe(404);
  }
  vi.stubEnv("TOURNAMENT_URL", "https://tournament.test"); vi.stubEnv("TOURNAMENT_BRIDGE_SECRET", "short");
  expect((await start(startRequest())).status).toBe(503);
  const failedHandoff = await start(startRequest(undefined, marker));
  expect(failedHandoff.status).toBe(302);
  expect(failedHandoff.headers.get("location")).toBe("https://app.test/dashboard");
  expect(failedHandoff.headers.get("set-cookie")).toMatch(expiredMarker);
  expect((await lookupIds([1])).status).toBe(503);
  expect(state.access).not.toHaveBeenCalled(); expect(state.getDb).not.toHaveBeenCalled();
});

it.each(["invalid return", "missing user"])("returns home and clears the marker for a signed-in user with %s", async failure => {
  if (failure === "missing user") db.prepare("delete from users where id=1").run();
  const response = await start(startRequest(failure === "invalid return" ? "//outside.test" : undefined, marker));
  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toBe("https://app.test/dashboard");
  expect(response.headers.get("set-cookie")).toMatch(expiredMarker);
});

it("verifies every service signature before parsing JSON, params, Clerk or database access", async () => {
  for (const response of [
    await search(new Request(`https://app.test${base}/users/search?q=ada`)),
    await lookup(new Request(`https://app.test${base}/users/lookup`, { method: "POST", body: "{broken" })),
    await member(new Request(`https://app.test${base}/users/1/member-id`, { method: "PUT", body: '{"memberId":"12345"}' }), { get params(): never { throw new Error("params read before authentication"); } }),
  ]) expect(response.status).toBe(401);
  const tampered = signed(`${base}/users/search?q=ada`);
  expect((await search(new Request(tampered.url.replace("q=ada", "q=bea"), { headers: tampered.headers }))).status).toBe(401);
  const exact = signed(`${base}/users/search?q=ada&exact=1`);
  expect((await search(new Request(tampered.url, { headers: exact.headers }))).status).toBe(401);
  expect(state.access).not.toHaveBeenCalled(); expect(state.currentUser).not.toHaveBeenCalled(); expect(state.getDb).not.toHaveBeenCalled();
});

it.each(["123456", "000-1234567895", "ADA_", "example", "A.DISCORD"])("searches global identities by %s without email", async q => {
  const response = await search(signed(`${base}/users/search?q=${encodeURIComponent(q)}`));
  expect(response.status).toBe(200);
  expect((await response.json()).users).toContainEqual(expectedUser);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(state.access).not.toHaveBeenCalled(); expect(state.currentUser).not.toHaveBeenCalled();
});
it("escapes literal LIKE wildcards and backslashes, caps search at 20, and puts exact IDs first", async () => {
  for (const q of ["%", "\\", ""]) expect(await (await search(signed(`${base}/users/search?q=${encodeURIComponent(q)}`))).json()).toEqual({ users: [] });
  expect((await (await search(signed(`${base}/users/search?q=_`))).json()).users).toEqual([expectedUser]);
  for (let id = 3; id <= 28; id++) db.prepare("insert into users(id,username,display_name) values (?,?,?)").run(id, `aaa${id}`, "1234567895");
  const result = await (await search(signed(`${base}/users/search?q=1234567895`))).json();
  expect(result.users).toHaveLength(20); expect(result.users[0]).toEqual(expectedUser);
  db.prepare("update users set email_verified = 1 where id = 1").run();
  expect(await (await search(signed(`${base}/users/search?q=private%40example.test`))).json()).toEqual({ users: [] });
});

it.each(["  aDA_nAME  ", "ADA.DISCORD", "000-1234567895", "PRIVATE+PLAY@EXAMPLE.TEST"])("finds an exact identifier %j without exposing email", async q => {
  db.prepare("update users set email = ?, email_verified = 1 where id = 1").run("private+play@example.test");
  const response = await searchExact(q);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ users: [expectedUser] });
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(state.currentUser).not.toHaveBeenCalled();
});

it.each(["Ada", "Ada Example", "ada.dis", "123456", "123456789", "private@example.test", "play@example.test", "_", "  "])("returns no exact matches for %j", async q => {
  db.prepare("update users set email = ?, email_verified = 1 where id = 2").run("bea+play@example.test");
  expect(await (await searchExact(q)).json()).toEqual({ users: [] });
});

it("returns one stable result when multiple accounts match the same exact identifier", async () => {
  db.prepare("update users set username = ? where id = 2").run("ADA_NAME");
  expect(await (await searchExact("Ada_Name")).json()).toEqual({ users: [expectedUser] });
});

it("looks up at most 500 IDs with stable de-duplication and identifies unknown/deleted users", async () => {
  expect(await (await lookupIds([2, 1, 99, 1])).json()).toEqual({ users: [
    { id: 2, username: "bea", displayName: "Bea Example", discordUserId: null, discordUsername: null, memberId: null }, expectedUser,
  ], missing: [99] });
  expect((await lookupIds(Array.from({ length: 500 }, (_, i) => i + 1))).status).toBe(200);
  expect(await (await lookupIds([])).json()).toEqual({ users: [], missing: [] });
});
it.each([[1, "2"], [0], [-1], [1.5], [Number.MAX_SAFE_INTEGER + 1], Array(501).fill(1)])("rejects invalid lookup IDs %j", async ids => {
  expect((await lookupIds(ids)).status).toBe(400);
  expect(state.getDb).not.toHaveBeenCalled();
});
it("rejects signed malformed JSON and signed oversized bodies", async () => {
  expect((await lookup(signed(`${base}/users/lookup`, "POST", "{broken", true))).status).toBe(400);
  expect((await lookup(signed(`${base}/users/lookup`, "POST", " ".repeat(65537), true))).status).toBe(401);
  expect(state.getDb).not.toHaveBeenCalled();
});

it("normalizes member IDs, enforces uniqueness, warns on checksum only, and clears with null", async () => {
  expect(await (await setMember("1", "00 001-2345")).json()).toEqual({ memberId: "12345", checkDigitOk: false });
  const taken = await setMember("2", "00012345"); expect(taken.status).toBe(409); expect(await taken.json()).toEqual({ error: "member_id_taken" });
  expect(await (await setMember("1", "1234567895")).json()).toEqual({ memberId: "1234567895", checkDigitOk: true });
  expect(db.prepare("select discord_username from user_profile_ids where user_id=1").get()).toEqual({ discord_username: "ada.discord" });
  expect(await (await setMember("1", null)).json()).toEqual({ memberId: null, checkDigitOk: false });
  expect((await setMember("2", "1234567895")).status).toBe(200);
  expect((await setMember("99", "12345")).status).toBe(404);
});
it.each(["", "- ", "abc", "12345678901", 123, {}, "1.2"])("rejects invalid member ID %j", async value => {
  expect((await setMember("1", value)).status).toBe(400);
  expect(state.getDb).not.toHaveBeenCalled();
});

it("keeps migration idempotent and cleans profiles on both hard deletion and anonymisation", async () => {
  migrate(db);
  expect(await (await lookupIds([1])).json()).toEqual({ users: [expectedUser], missing: [] });
  db.exec("insert into user_profile_ids(user_id,member_id,updated_at) values (2,'54321','2026-01-01')");
  expect(deleteUserAccount(db, 2).mode).toBe("removed");
  expect(db.prepare("select 1 from user_profile_ids where user_id=2").get()).toBeUndefined();
  db.exec(`insert into players(id,guild_id,user_id,display_name) values (1,'other-guild',1,'Ada');
    insert into matches(guild_id,player_one_id,player_two_id,reporter_id,status,source) values ('other-guild',1,1,1,'pending','casual');`);
  expect(deleteUserAccount(db, 1).mode).toBe("anonymised");
  expect(db.prepare("select id from users where id=1").get()).toEqual({ id: 1 });
  expect(db.prepare("select * from user_profile_ids").all()).toEqual([]);
  expect(await (await lookupIds([1, 2, 99])).json()).toEqual({ users: [], missing: [1, 2, 99] });
  expect(await (await search(signed(`${base}/users/search?q=deleted`))).json()).toEqual({ users: [] });
  expect(await (await searchExact("deleted-1")).json()).toEqual({ users: [] });
  expect((await setMember("1", "12345")).status).toBe(404);
});
