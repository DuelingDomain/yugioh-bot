import Database from "better-sqlite3";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { createDuelService, createRemoteDuelService } from "@yugidraft/shared/services";
import { seedIdentity } from "../../shared/tests/helpers/identity";

const state = vi.hoisted(() => ({ db: null as Database.Database | null, auth: vi.fn() }));
vi.mock("@/lib/session-identity", async () => {
  const { sessionFixture } = await import("./fixtures/session"); return sessionFixture(state.auth);
});
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
afterEach(() => { state.db?.close(); vi.unstubAllEnvs(); });
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
it("paginates dense Remote history newest-first for members, admins and the Remote filter", async () => {
  vi.stubEnv("REMOTE_DUELS", "1"); vi.stubEnv("REMOTE_DUELS_USERS", "*");
  const db = state.db!, online = createDuelService(db), remote = createRemoteDuelService(db);
  const expected: { slug: string; time: number; remote: boolean; completed: boolean }[] = [];
  const base = Date.parse("2026-10-12T12:00:00Z");
  for (let i = 0; i < 60; i++) {
    const duel = online.create({ guildId: "history-test", organizerPlayerId: 2, name: "Online", mode: "normal" });
    const time = base - i * 60_000;
    db.prepare("update duels set status='completed', ended_at=? where id=?").run(i === 59 ? "unreadable" : new Date(time).toISOString(), duel.id);
    expected.push({ slug: duel.slug!, time: i === 59 ? -Infinity : time, remote: false, completed: true });
  }
  for (let i = 0; i < 122; i++) {
    const room = remote.create({ guildId: "history-test", userId: 102, displayName: "Member", gameId: "ygo", seatCount: 2, bestOf: 1, visibility: "private" });
    // The newest 75 have no winner; also cover timestamp ties and two rows older than every dated online row.
    const time = base + (i < 75 ? 120_000 : 0) - (i < 120 ? Math.floor(i / 2) * 1000 : 4_000_000 + i);
    db.prepare("update remote_tables set status='ended', started_at=?, ended_at=?, state_json=json_set(state_json,?,?) where slug=?")
      .run(time - 1000, time, i % 2 ? "$.match.winnerSeat" : "$.winnerSeat", i < 75 ? null : 0, room.slug);
    expected.push({ slug: room.slug, time, remote: true, completed: i >= 75 });
  }
  // Stable ties follow each source's descending id order.
  expected.reverse().sort((a, b) => b.time - a.time || Number(a.remote) - Number(b.remote));
  for (const [userId, scope] of [[102, "mine"], [101, "all"]] as const) {
    state.auth.mockResolvedValue({ user: { id: String(userId), name: "Viewer" } });
    for (const [type, status] of [["all", "any"], ["all", "completed"], ["remote", "any"], ["remote", "completed"]]) {
      const query = new URLSearchParams({ archived: "1", scope, type, status, format: "1v1", limit: "50" });
      const slugs: string[] = [];
      do {
        const response = await get(query.toString()); expect(response.status).toBe(200);
        const page = await response.json();
        expect(page.duels.length).toBeGreaterThan(0);
        expect(page.duels.length).toBeLessThanOrEqual(50);
        slugs.push(...page.duels.map((row: { slug: string }) => row.slug));
        if (!page.nextCursor) break;
        query.set("cursor", page.nextCursor);
        expect(slugs.length).toBeLessThan(expected.length);
      } while (true);
      expect(slugs).toEqual(expected.filter(row => (type === "all" || row.remote) && (status !== "completed" || row.completed)).map(row => row.slug));
    }
  }
});
it("keeps member visibility and mine/live behavior", async () => {
  expect((await (await get("archived=1")).json()).duels).toEqual([]);
  state.auth.mockResolvedValue({ user: { id: "103", name: "Member" } });
  expect(await (await get()).json()).toEqual({ duels: [], canSeeAll: false, nextCursor: null });
  expect(await (await get("")).json()).toEqual({ duels: [] });
});
it("does not expose a private duel through a member's name search", async () => {
  state.auth.mockResolvedValue({ user: { id: "103", name: "Member" } });
  for (const q of ["Black Luster trials", "Player 102"]) {
    const query = new URLSearchParams({ archived: "1", scope: "all", q });
    const response = await get(query.toString());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ duels: [], canSeeAll: false, nextCursor: null });
  }
});
it.each(["q", "card"])("rejects overlong %s for both owners and members", async field => {
  for (const id of [101, 103]) {
    state.auth.mockResolvedValue({ user: { id: String(id), name: "Test member" } });
    const query = new URLSearchParams({ archived: "1", scope: "all", [field]: "x".repeat(101) });
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
  const baseline = await (await get()).json();
  for (const card of ["Black Luster", "not in any deck"]) {
    expect(await (await get(`archived=1&scope=all&card=${encodeURIComponent(card)}`)).json()).toEqual(baseline);
  }
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
