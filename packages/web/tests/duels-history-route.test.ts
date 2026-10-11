import Database from "better-sqlite3";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { createDuelService } from "@yugidraft/shared/services";
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
it("keeps member visibility and mine/live behavior", async () => {
  expect((await (await get("archived=1")).json()).duels).toEqual([]);
  state.auth.mockResolvedValue({ user: { id: "103", name: "Member" } });
  expect(await (await get()).json()).toEqual({ duels: [], canSeeAll: false, nextCursor: null });
  expect(await (await get("")).json()).toEqual({ duels: [] });
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
