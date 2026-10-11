import Database from "better-sqlite3";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { createDuelService } from "@yugidraft/shared/services";
import { verifyDuelConnectionToken } from "@yugidraft/shared/ws";
import { seedIdentity } from "../../shared/tests/helpers/identity";

const state = vi.hoisted(() => ({ db: null as Database.Database | null, auth: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: state.auth }));
vi.mock("@/lib/discord-guild-membership", () => ({ verifyDiscordGuildMembership: async () => ({ ok: true }) }));
vi.mock("@/lib/db", () => ({ getDb: () => state.db! }));
let privateSlug: string;
beforeEach(() => {
  vi.resetModules(); state.auth.mockReset();
  state.db = new Database(":memory:"); migrate(state.db);
  for (const userId of [101, 102, 103]) seedIdentity(state.db, { guildId: "history-test", userId, playerId: userId - 100, name: `Player ${userId}` });
  vi.stubEnv("DISCORD_GUILD_ID", "history-test"); vi.stubEnv("OWNER_USER_IDS", "101");
  state.auth.mockResolvedValue({ user: { id: "101", name: "Owner" } });
  const duels = createDuelService(state.db);
  privateSlug = duels.create({ guildId: "history-test", organizerPlayerId: 2, name: "Black Luster trials", mode: "normal", format: "ffa4", settings: { visibility: "private" } }).slug;
  state.db.prepare("update duels set status='interrupted', ended_at='2026-10-10 12:00:00' where web_slug=?").run(privateSlug);
  state.db.prepare(`insert into card_catalog(ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at)
    values(100,'Black Luster Soldier','Effect Monster','effect','','','[]','2026-10-10')`).run();
  state.db.prepare("update duel_seats set deck_json=?").run(JSON.stringify({ main: [100], extra: [], side: [] }));
});
afterEach(() => { state.db?.close(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
async function get(query = "archived=1&scope=all") {
  const { GET } = await import("../app/api/duels/route");
  return GET(new NextRequest(`http://localhost/api/duels?${query}`));
}
it("returns the exact history contract and private flag for the current admin", async () => {
  const response = await get(); expect(response.status).toBe(200);
  const body = await response.json();
  expect(Object.keys(body).sort()).toEqual(["canSeeAll", "duels", "nextCursor"]);
  expect(body).toMatchObject({ duels: [{ slug: privateSlug, private: true }], canSeeAll: true, nextCursor: null });
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});
it("passes all filters together with inclusive date bounds", async () => {
  const query = new URLSearchParams({ archived: "1", scope: "all", from: "2026-10-10T08:00:00-04:00", to: "2026-10-10T12:00:00Z", format: "ffa4", status: "interrupted", q: "lUsTeR", card: "lUsTeR sOlDiEr", limit: "1" });
  expect((await (await get(query.toString())).json()).duels[0]?.slug).toBe(privateSlug);
  query.set("format", "tag"); expect((await (await get(query.toString())).json()).duels).toEqual([]);
});
it("includes cancelled duels by default for admins and forwards status filters", async () => {
  state.db!.prepare("update duels set status='cancelled' where web_slug=?").run(privateSlug);
  expect((await (await get()).json()).duels[0]?.slug).toBe(privateSlug);
  expect((await (await get("archived=1&scope=all&status=cancelled")).json()).duels[0]?.slug).toBe(privateSlug);
  expect((await (await get("archived=1&scope=all&status=completed")).json()).duels).toEqual([]);
});
it("returns and accepts an opaque cursor", async () => {
  const next = createDuelService(state.db!).create({ guildId: "history-test", organizerPlayerId: 2, name: "Next duel", mode: "normal" });
  state.db!.prepare("update duels set status='completed', ended_at='2026-10-11 12:00:00' where id=?").run(next.id);
  const first = await (await get("archived=1&scope=all&limit=1")).json();
  expect(first.duels[0].slug).toBe(next.slug); expect(first.nextCursor).toEqual(expect.any(String));
  const second = await (await get(`archived=1&scope=all&limit=1&cursor=${encodeURIComponent(first.nextCursor)}`)).json();
  expect(second.duels[0].slug).toBe(privateSlug); expect(second.nextCursor).toBeNull();
});
it("keeps member visibility and mine/live behavior", async () => {
  expect((await (await get("archived=1")).json()).duels).toEqual([]);
  state.auth.mockResolvedValue({ user: { id: "103", name: "Member" } });
  expect((await get()).status).toBe(403);
  expect(await (await get("archived=1&scope=mine")).json()).toEqual({ duels: [], canSeeAll: false, nextCursor: null });
  expect(await (await get("")).json()).toEqual({ duels: [] });
});
it("does not expose a private duel through a member's name search", async () => {
  state.auth.mockResolvedValue({ user: { id: "103", name: "Member" } });
  for (const q of ["Black Luster trials", "Player 102"]) {
    const query = new URLSearchParams({ archived: "1", scope: "all", q });
    const response = await get(query.toString());
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: expect.any(String) });
  }
});
it.each(["q", "card"])("rejects overlong %s for both owners and members", async field => {
  for (const id of [101, 103]) {
    state.auth.mockResolvedValue({ user: { id: String(id), name: "Test member" } });
    const query = new URLSearchParams({ archived: "1", scope: id === 101 ? "all" : "mine", [field]: "x".repeat(101) });
    const response = await get(query.toString());
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: expect.any(String) });
    query.set(field, "x".repeat(100));
    expect((await get(query.toString())).status).toBe(200);
  }
});
it("trims name and card searches", async () => {
  const query = new URLSearchParams({ archived: "1", scope: "all", q: "  Luster  ", card: "  Soldier  " });
  expect((await (await get(query.toString())).json()).duels[0]?.slug).toBe(privateSlug);
});
it("ignores member card filters so hidden opponent decks cannot be probed", async () => {
  state.auth.mockResolvedValue({ user: { id: "103", name: "Member" } });
  state.db!.prepare("update duels set settings_json=json_set(settings_json,'$.visibility','public') where web_slug=?").run(privateSlug);
  state.db!.prepare("insert into duel_seats(duel_id,seat,player_id) select id,1,3 from duels where web_slug=?").run(privateSlug);
  const baseline = await (await get("archived=1&scope=mine")).json();
  for (const card of ["Black Luster", "not in any deck"]) {
    expect(await (await get(`archived=1&scope=mine&card=${encodeURIComponent(card)}`)).json()).toEqual(baseline);
  }
});
it.each([undefined, "", "103"])("refuses All history when the session owner does not match %s", async owners => {
  vi.stubEnv("OWNER_USER_IDS", owners);
  state.db!.prepare("update duels set settings_json=json_set(settings_json,'$.visibility','public') where web_slug=?").run(privateSlug);
  const response = await get("archived=1&scope=all&isOwner=true");
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ error: expect.any(String) });
  expect((await get("archived=1&scope=mine")).status).toBe(200);
});
it.each([
  "from=yesterday", "to=2026-02-30T00%3A00%3A00Z", "format=invalid", "scope=invalid", "cursor=broken",
  "limit=0", "limit=-1", "limit=1.5", "limit=NaN", "limit=", "from=", "cursor=", "format=", "status=active", "status=", "status=any&status=completed",
  "from=2026-10-11T00%3A00%3A00Z&to=2026-10-10T00%3A00%3A00Z",
])("returns 400 {error} for invalid query %s", async query => {
  const response = await get(`archived=1&scope=all&${query}`);
  expect(response.status).toBe(400); expect(await response.json()).toEqual({ error: expect.any(String) });
});
it("requires authentication", async () => {
  state.auth.mockResolvedValue(null); expect((await get()).status).toBe(401);
});

const mutationRoutes = {
  actions: async () => (await import("../app/api/duels/[slug]/actions/route")).POST,
  surrender: async () => (await import("../app/api/duels/[slug]/surrender/route")).POST,
  cancel: async () => (await import("../app/api/duels/[slug]/cancel/route")).POST,
  archive: async () => (await import("../app/api/duels/[slug]/archive/route")).POST,
  "chain-mode": async () => (await import("../app/api/duels/[slug]/chain-mode/route")).POST,
  report: async () => (await import("../app/api/duels/[slug]/report/route")).POST,
};
it.each(Object.keys(mutationRoutes) as (keyof typeof mutationRoutes)[])("refuses the owner read grant before forwarding %s", async op => {
  vi.stubEnv("DUEL_SCENARIOS", "1");
  vi.stubEnv("DUEL_INTERNAL_URL", "http://fixture-host");
  vi.stubEnv("DUEL_INTERNAL_SECRET", "fixture-secret");
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({ path: "/fixture-report" }));
  const post = await mutationRoutes[op]();
  const response = await post(new NextRequest(`http://localhost/duels/${privateSlug}/${op}`, {
    method: "POST", body: JSON.stringify({ mode: "always", note: "Fixture note", promptId: "fixture", revision: 1, answer: { choice: "pass" } }),
  }), { params: Promise.resolve({ slug: privateSlug }) });
  expect(response.status).toBe(403);
  expect(fetch).not.toHaveBeenCalled();
  expect(state.db!.prepare("select * from duel_invite_grants").all()).toEqual([]);
});
it("does not turn the owner read grant into an invite grant", async () => {
  const { POST } = await import("../app/api/duels/[slug]/invite/route");
  const response = await POST(new NextRequest("http://localhost/invite", {
    method: "POST", body: JSON.stringify({ inviteCode: "fixture-invalid-code" }),
  }), { params: Promise.resolve({ slug: privateSlug }) });
  expect(response.status).toBe(403);
  expect(state.db!.prepare("select * from duel_invite_grants").all()).toEqual([]);
});
it("keeps the owner's connection identity at spectator even when a seat is requested", async () => {
  vi.stubEnv("WS_INTERNAL_SECRET", "fixture-ws-secret");
  const { GET } = await import("../app/api/duels/[slug]/connection/route");
  const response = await GET(new NextRequest("http://localhost/connection?seat=0"), { params: Promise.resolve({ slug: privateSlug }) });
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(verifyDuelConnectionToken(body.token, "fixture-ws-secret")).toMatchObject({ playerId: 1, seat: null });
  expect(state.db!.prepare("select seat from duel_seats where player_id=1").all()).toEqual([]);
});
