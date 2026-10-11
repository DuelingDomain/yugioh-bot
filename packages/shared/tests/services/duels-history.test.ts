import Database from "better-sqlite3";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { migrate } from "../../src/db/index.js";
import { createDuelService } from "../../src/services/duels.js";
import { seedIdentity } from "../helpers/identity.js";
import type { DuelFormat } from "../../src/duels/index.js";
import { duelHistoryQuery } from "../../src/services/duel-history.js";

let db: Database.Database;
let duels: ReturnType<typeof createDuelService>;
beforeEach(() => {
  db = new Database(":memory:"); migrate(db);
  seedIdentity(db, { guildId: "history-test", userId: 101, playerId: 1, name: "Owner" });
  seedIdentity(db, { guildId: "history-test", userId: 102, playerId: 2, name: "Kaiba" });
  seedIdentity(db, { guildId: "history-test", userId: 103, playerId: 3, name: "Member" });
  seedIdentity(db, { guildId: "other-test", userId: 104, playerId: 4 });
  vi.stubEnv("OWNER_USER_IDS", "101");
  duels = createDuelService(db);
});
afterEach(() => { db.close(); vi.unstubAllEnvs(); });

function finished(input: { name?: string; time?: string | null; created?: string; format?: DuelFormat; private?: boolean; player?: number } = {}) {
  const session = duels.create({ guildId: "history-test", organizerPlayerId: input.player ?? 2,
    name: input.name ?? "Test duel", mode: "normal", format: input.format,
    settings: { visibility: input.private ? "private" : "public" } });
  db.prepare("update duels set status='completed', ended_at=?, created_at=? where id=?")
    .run(input.time === undefined ? "2026-10-10 12:00:00" : input.time, input.created ?? "2026-10-09 12:00:00", session.id);
  return session;
}
const history = (options = {}, playerId = 1) => duels.listHistory("history-test", playerId, { scope: "all", ...options });

it("includes other players' private play duels only for the current owner, without grants", () => {
  const secret = finished({ private: true });
  expect(history()).toMatchObject({ duels: [{ slug: secret.slug, private: true, mySeat: null }], canSeeAll: true, nextCursor: null });
  expect(history({}, 3)).toEqual({ duels: [], canSeeAll: false, nextCursor: null });
  expect(history({}, 2).duels[0]?.private).toBe(true);
  expect(history({ scope: "mine" }).duels).toEqual([]);
  expect(duels.list("history-test", 1, { archived: true, scope: "all" })[0]?.slug).toBe(secret.slug);
  vi.stubEnv("OWNER_USER_IDS", "");
  expect(history()).toEqual({ duels: [], canSeeAll: false, nextCursor: null });
  expect(db.prepare("select * from duel_invite_grants").all()).toEqual([]);
});

it("filters inclusive timestamps across offsets, using created_at if ended_at is absent", () => {
  const first = finished({ time: "2026-10-10 12:00:00.125" });
  const second = finished({ time: null, created: "2026-10-10T13:00:00.125Z" });
  finished({ time: "2026-10-10 12:00:00.124" });
  finished({ time: "2026-10-10 13:00:00.126" });
  expect(history({ from: "2026-10-10T08:00:00.125-04:00", to: "2026-10-10T13:00:00.125Z" }).duels.map(d => d.id))
    .toEqual([second.id, first.id]);
});

it.each(["1v1", "tag", "ffa3", "ffa4"] as const)("filters stored format %s", format => {
  const expected = finished({ format });
  finished({ format: format === "1v1" ? "tag" : "1v1" });
  expect(history({ format }).duels.map(d => d.id)).toEqual([expected.id]);
});

it("searches names and every seat's display name without interpreting SQL wildcards", () => {
  const named = finished({ name: "Black Luster trials" });
  const seated = finished({ name: "Multiplayer", format: "ffa4", player: 3 });
  db.prepare("insert into duel_seats(duel_id,seat,player_id) values(?,3,2)").run(seated.id);
  expect(history({ q: "lUsTeR" }).duels.map(d => d.id)).toEqual([named.id]);
  expect(history({ q: "kAiBa" }).duels.map(d => d.id)).toEqual([seated.id, named.id]);
  expect(history({ q: "%" }).duels).toEqual([]);
  expect(history({ q: "' OR 1=1 --" }).duels).toEqual([]);
});
it("matches Unicode case in duel, player and card names", () => {
  const duel = finished({ name: "Élite duel" });
  db.prepare("update players set display_name='Élodie' where id=2").run();
  catalog(100, "Élite Soldier");
  db.prepare("update duel_seats set deck_json=? where duel_id=?").run(JSON.stringify({ main: [100], extra: [], side: [] }), duel.id);
  for (const filter of [{ q: "élite" }, { q: "élodie" }, { card: "élite" }]) {
    expect(history(filter).duels.map(d => d.id)).toEqual([duel.id]);
  }
});
it("matches Unicode sigma variants in duel, player and card names with literal punctuation", () => {
  const duel = finished({ name: "ΟΣ" });
  db.prepare("update players set display_name='Σ' where id=2").run();
  catalog(100, "ΟΣ");
  db.prepare("update duel_seats set deck_json=? where duel_id=?").run(JSON.stringify({ main: [100], extra: [], side: [] }), duel.id);
  for (const filter of [{ q: "σ" }, { q: "ς" }, { card: "σ" }, { card: "ς" }]) {
    expect(history(filter).duels.map(d => d.id)).toEqual([duel.id]);
  }
  expect(history({ q: ".*" }).duels).toEqual([]);
  expect(history({ card: "(" }).duels).toEqual([]);
});

function catalog(id: number, name: string) {
  db.prepare(`insert into card_catalog(ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at)
    values(?,?,'Effect Monster','effect','','','[]','2026-10-10')`).run(id, name);
}
it.each(["main", "extra", "side", "deckMaster"])("searches card names in %s on any seat including a bot", section => {
  catalog(100, "Black Luster Soldier");
  const duel = finished({ format: "ffa4" });
  const deck = { main: [200], extra: [], side: [], [section]: section === "deckMaster" ? 100 : [100] };
  db.prepare("insert into duel_seats(duel_id,seat,is_bot,deck_json) values(?,3,1,?)").run(duel.id, JSON.stringify(deck));
  finished();
  expect(history({ card: "lUsTeR sOlDiEr" }).duels.map(d => d.id)).toEqual([duel.id]);
  expect(history({ card: "100" }).duels).toEqual([]);
});
it("resolves artwork aliases and ignores missing or malformed seat decks", () => {
  catalog(100, "Black Luster Soldier"); catalog(101, "Alternate artwork");
  db.prepare("insert into card_artworks(card_id,artwork_id,image_url,image_url_small,is_main) values(100,101,'','',0)").run();
  const duel = finished();
  db.prepare("update duel_seats set deck_json=? where duel_id=?").run(JSON.stringify({ main: [101], extra: [], side: [] }), duel.id);
  const broken = finished();
  db.prepare("update duel_seats set deck_json='broken' where duel_id=?").run(broken.id);
  expect(history({ card: "black luster" }).duels.map(d => d.id)).toEqual([duel.id]);
  expect(history({ card: "%" }).duels).toEqual([]);
});
it("does not let member card filters reveal hidden opponent decks", () => {
  catalog(100, "Black Luster Soldier");
  const duel = finished();
  db.prepare("update duel_seats set deck_json=? where duel_id=?").run(JSON.stringify({ main: [100], extra: [], side: [] }), duel.id);
  for (const player of [2, 3]) {
    expect(history({ card: "not in any deck" }, player).duels.map(d => d.id)).toEqual([duel.id]);
    expect(history({ card: "Black Luster" }, player).duels.map(d => d.id)).toEqual([duel.id]);
    expect(history({ card: "%" }, player).duels.map(d => d.id)).toEqual([duel.id]);
  }
  expect(history({ card: "not in any deck" }).duels).toEqual([]);
});
it("matches catalog names once rather than once per saved deck entry", () => {
  catalog(100, "Wanted card"); catalog(101, "Artwork fixture"); catalog(200, "Other card");
  db.prepare("insert into card_artworks(card_id,artwork_id,image_url,image_url_small,is_main) values(100,101,'','',0)").run();
  for (let i = 0; i < 10; i++) {
    const duel = finished();
    db.prepare("update duel_seats set deck_json=? where duel_id=?")
      .run(JSON.stringify({ main: Array(40).fill(200), extra: [], side: [] }), duel.id);
  }
  const matches = vi.fn((value: string, query: string) => value.toLowerCase().includes(query.toLowerCase()) ? 1 : 0);
  db.function("duel_history_contains", { deterministic: true }, matches);
  expect(history({ card: "Wanted" }).duels).toEqual([]);
  expect(matches.mock.calls.length).toBeLessThanOrEqual(3);
  expect(matches).toHaveBeenCalledWith("Wanted card", "Wanted");
});
it("uses the canonical artwork name even when the artwork also has a catalog entry", () => {
  catalog(100, "Canonical card"); catalog(101, "Alias catalog name");
  db.prepare("insert into card_artworks(card_id,artwork_id,image_url,image_url_small,is_main) values(100,101,'','',0)").run();
  const duel = finished();
  db.prepare("update duel_seats set deck_json=? where duel_id=?")
    .run(JSON.stringify({ main: [101], extra: [], side: [], metadata: [100] }), duel.id);
  expect(history({ card: "Canonical" }).duels.map(d => d.id)).toEqual([duel.id]);
  expect(history({ card: "Alias catalog" }).duels).toEqual([]);
});
it("does not let member name searches find hidden private duels or their players", () => {
  finished({ private: true, name: "Hidden fixture" });
  const visible = finished({ player: 3, name: "Visible fixture" });
  for (const q of ["Hidden fixture", "Kaiba"]) expect(history({ q }, 3).duels).toEqual([]);
  expect(history({ q: "Visible fixture" }, 3).duels.map(d => d.id)).toEqual([visible.id]);
});
it("does not redefine the search function while a database iterator is open", () => {
  finished(); finished();
  const rows = db.prepare("select id from duels").iterate();
  try {
    expect(rows.next().done).toBe(false);
    expect(() => createDuelService(db)).not.toThrow();
    expect(rows.next().done).toBe(false);
  } finally { rows.return?.(); }
});
it.each(["q", "card"] as const)("limits %s to 100 characters and trims searches", field => {
  expect(() => history({ [field]: "x".repeat(101) })).toThrowError(expect.objectContaining({ status: 400 }));
  expect(() => history({ [field]: " ".repeat(101) }, 3)).toThrowError(expect.objectContaining({ status: 400 }));
  expect(() => history({ [field]: "x".repeat(100) })).not.toThrow();
  const duel = finished({ name: "Trimmed fixture" });
  catalog(100, "Trimmed fixture");
  db.prepare("update duel_seats set deck_json=? where duel_id=?")
    .run(JSON.stringify({ main: [100], extra: [], side: [] }), duel.id);
  expect(history({ [field]: "  Trimmed fixture  " }).duels.map(d => d.id)).toEqual([duel.id]);
});

it("pages every history row by timestamp and descending ID without duplicates", () => {
  const ids = Array.from({ length: 105 }, () => finished().id).reverse();
  const first = history(); expect(first.duels).toHaveLength(50); expect(first.nextCursor).toEqual(expect.any(String));
  const second = history({ cursor: first.nextCursor });
  const third = history({ cursor: second.nextCursor });
  expect([...first.duels, ...second.duels, ...third.duels].map(d => d.id)).toEqual(ids);
  expect(third.nextCursor).toBeNull();
  expect(history({ limit: 100 }).duels).toHaveLength(100);
  expect(history({ limit: 1000 }).duels).toHaveLength(100);
  expect(duels.list("history-test", 1, { archived: true, scope: "all" })).toHaveLength(100);
});
it("preserves fractional timestamp order and applies filters on later pages", () => {
  const earlier = finished({ time: "2026-10-10 12:00:00.100", format: "ffa4" });
  const later = finished({ time: "2026-10-10T12:00:00.200Z", format: "ffa4" });
  finished({ time: "2026-10-10 12:00:00.150", format: "tag" });
  const first = history({ limit: 1, format: "ffa4" });
  expect(first.duels.map(d => d.id)).toEqual([later.id]);
  expect(history({ limit: 1, format: "ffa4", cursor: first.nextCursor }).duels.map(d => d.id)).toEqual([earlier.id]);
});
it("sorts unreadable timestamps last and advances into and through them", () => {
  const invalidEnded = finished({ time: "unreadable" });
  const invalidCreated = finished({ time: null, created: "unreadable" });
  const valid = finished();
  const expected = [valid.id, invalidCreated.id, invalidEnded.id];
  expect(history().duels.map(d => d.id)).toEqual(expected);
  const pages = [history({ limit: 1 })];
  while (pages.at(-1)!.nextCursor && pages.length < 5) {
    pages.push(history({ limit: 1, cursor: pages.at(-1)!.nextCursor }));
  }
  expect(pages.flatMap(page => page.duels.map(d => d.id))).toEqual(expected);
  expect(pages.at(-1)!.nextCursor).toBeNull();
  expect(history({ from: "2026-10-01T00:00:00Z" }).duels.map(d => d.id)).toEqual([valid.id]);
});
it("excludes forks and live rows and other guilds even for owners", () => {
  const play = finished();
  db.prepare(`insert into duels(guild_id,web_slug,name,organizer_player_id,mode,status,kind)
    values('history-test','fork-history-test','Fork',1,'normal','completed','replay-fork')`).run();
  for (const status of ["active", "lobby"]) {
    db.prepare("update duels set status=? where id=?").run(status, finished().id);
  }
  db.prepare("update duels set guild_id='other-test' where id=?").run(finished().id);
  expect(history().duels.map(d => d.id)).toEqual([play.id]);
  expect(() => duels.listHistory("history-test", 4)).toThrow(/same guild/);
});
it("defaults admin all to every terminal status, with member and mine defaults unchanged", () => {
  const completed = finished(); const interrupted = finished(); const cancelled = finished({ private: true });
  db.prepare("update duels set status='interrupted' where id=?").run(interrupted.id);
  db.prepare("update duels set status='cancelled' where id=?").run(cancelled.id);
  expect(history().duels.map(d => d.id)).toEqual([cancelled.id, interrupted.id, completed.id]);
  for (const [status, id] of [["completed", completed.id], ["interrupted", interrupted.id], ["cancelled", cancelled.id]] as const) {
    expect(history({ status }).duels.map(d => d.id)).toEqual([id]);
  }
  expect(history({ status: "any" }).duels.map(d => d.id)).toEqual([cancelled.id, interrupted.id, completed.id]);
  for (const status of [undefined, "any", "cancelled"]) {
    expect(history({ status }, 2).duels.map(d => d.id)).toEqual([interrupted.id, completed.id]);
  }
  expect(history({ scope: "mine" }, 2).duels.map(d => d.id)).toEqual([interrupted.id, completed.id]);
});
it("returns UTC dates, recorded engine and turns, and every Tag seat's team and result", () => {
  const duel = finished({ format: "tag", private: true });
  for (const [seat, player] of [[1, 1], [2, 3]]) db.prepare("insert into duel_seats(duel_id,seat,player_id) values(?,?,?)").run(duel.id, seat, player);
  db.prepare("insert into duel_seats(duel_id,seat,is_bot) values(?,3,1)").run(duel.id);
  db.prepare("update duels set started_at='2026-10-10 11:59:00' where id=?").run(duel.id);
  db.prepare("update duels set winner_seat=1, result_reason='win', seed_json='[\"1\"]', bundle_version='test', turn_count=7, snapshot_public_json=? where id=?")
    .run(JSON.stringify({ turn: 7 }), duel.id);
  expect(history().duels[0]).toMatchObject({ slug: duel.slug, private: true, status: "completed",
    createdAt: "2026-10-09T12:00:00.000Z", startedAt: "2026-10-10T11:59:00.000Z", endedAt: "2026-10-10T12:00:00.000Z",
    durationMs: 60_000, turnCount: 7, engine: "multi",
    seats: [
      { seat: 0, displayName: "Kaiba", team: 0, result: "loss" },
      { seat: 1, displayName: "Owner", team: 1, result: "win" },
      { seat: 2, displayName: "Member", team: 0, result: "loss" },
      { seat: 3, displayName: "Practice Bot", team: 1, result: "win" },
    ] });
});
it("uses null for unknown metadata and results, and identifies draws only with a saved result", () => {
  const duel = finished({ time: null });
  expect(history().duels[0]).toMatchObject({ startedAt: null, endedAt: null, durationMs: null, turnCount: null, engine: null,
    seats: [{ team: null, result: null }] });
  db.prepare("update duels set result_reason='draw', setup_json=?, snapshot_public_json='broken' where id=?").run(JSON.stringify({ engine: "pinned" }), duel.id);
  expect(history().duels[0]).toMatchObject({ engine: "pinned", turnCount: null, seats: [{ result: "draw" }] });
});
it("records start time on activation without inventing start dates for older duels", () => {
  const duel = duels.create({ guildId: "history-test", organizerPlayerId: 2, name: "Start test", mode: "normal" });
  db.prepare("insert into duel_seats(duel_id,seat,player_id,ready) values(?,1,3,1)").run(duel.id);
  db.prepare("update duel_seats set ready=1 where duel_id=?").run(duel.id);
  const before = Date.now();
  duels.activate(duel.slug, "history-test", 2, ["1", "2", "3", "4"], "test-bundle", null, { engine: "pinned" });
  db.prepare("update duels set status='interrupted', ended_at=datetime('now') where id=?").run(duel.id);
  const item = history().duels[0];
  expect(item.startedAt).toEqual(expect.any(String));
  expect(Date.parse(item.startedAt!)).toBeGreaterThanOrEqual(before - 1000);
  expect(item.engine).toBe("pinned");
  expect(item.durationMs).toBe(Date.parse(item.endedAt!) - Date.parse(item.startedAt!));
});
it("reads the stored column without parsing old or malformed boards", () => {
  const duel = finished();
  db.prepare("update duels set snapshot_public_json=?,snapshot_seats_json=? where id=?")
    .run(JSON.stringify({ turn: 8, payload: "large board fixture".repeat(1000) }), "broken", duel.id);
  expect(history().duels[0].turnCount).toBeNull();
  db.prepare("update duels set turn_count=9 where id=?").run(duel.id);
  const query = duelHistoryQuery("history-test", 1, true, { scope: "all" });
  expect(query.sql).not.toMatch(/json_(extract|valid|type)\(snapshot/);
  const row = db.prepare(query.sql).get(query.params) as Record<string, unknown>;
  expect(row).toMatchObject({ id: duel.id, turn_count: 9 });
  for (const column of ["snapshot_public_json", "snapshot_seat0_json", "snapshot_seat1_json", "snapshot_seats_json", "seed_json", "clock_json"]) {
    expect(row).not.toHaveProperty(column);
  }
  expect(history().duels[0].turnCount).toBe(9);
  db.prepare("update duels set status='active' where id=?").run(duel.id);
  const parse = vi.spyOn(JSON, "parse");
  try {
    expect(duels.list("history-test", 2)[0].turnCount).toBe(9);
    expect(parse.mock.calls.some(([raw]) => raw.includes("large board fixture"))).toBe(false);
  } finally { parse.mockRestore(); }
});
it.each([false, true])("advances past invalid setup rows without stranding subsequent pages (unreadable time=%s)", unreadable => {
  const time = unreadable ? "unreadable" : undefined;
  const older = finished({ time }); const invalid = finished({ time }); const newest = finished();
  db.prepare("update duels set setup_json='broken' where id=?").run(invalid.id);
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    const first = history({ limit: 1 });
    expect(first.duels[0]?.id).toBe(newest.id);
    const next = history({ limit: 1, cursor: first.nextCursor });
    const last = history({ limit: 1, cursor: next.nextCursor });
    expect([...next.duels, ...last.duels].map(d => d.id)).toEqual([older.id]);
    expect(last.nextCursor).toBeNull();
  } finally { warning.mockRestore(); }
});
it.each([
  { from: "yesterday" }, { to: "2026-02-30T00:00:00Z" }, { from: "2026-10-10" },
  { from: "2026-10-11T00:00:00Z", to: "2026-10-10T00:00:00Z" }, { format: "invalid" },
  { cursor: "garbage" }, { cursor: "" }, { limit: 0 }, { limit: -1 }, { limit: 1.5 }, { limit: NaN }, { status: "active" }, { status: "" },
])("rejects invalid history options %j with a 400", options => {
  expect(() => history(options)).toThrowError(expect.objectContaining({ status: 400 }));
});
it("uses an idempotent history index for guild timestamp ordering", () => {
  for (let i = 0; i < 200; i++) finished({ time: `2026-10-${String(1 + i % 10).padStart(2, "0")} 12:00:00` });
  finished({ time: "unreadable" });
  migrate(db);
  db.exec("analyze");
  const indexes = db.prepare("pragma index_list(duels)").all() as { name: string }[];
  expect(indexes.some(index => index.name === "duels_play_history_idx")).toBe(true);
  const plan = db.prepare(`explain query plan select id from duels where guild_id='history-test'
    and kind='play' and status in ('completed','interrupted','cancelled')
    order by julianday(coalesce(ended_at,created_at)) desc,id desc limit 51`).all();
  expect(JSON.stringify(plan)).toContain("duels_play_history_idx");
  expect(JSON.stringify(plan)).not.toContain("TEMP B-TREE");
  for (const query of [
    duelHistoryQuery("history-test", 1, true, { scope: "all", limit: 1 }),
    duelHistoryQuery("history-test", 1, false, { scope: "all" }),
  ]) {
    const actualPlan = db.prepare(`explain query plan ${query.sql}`).all(query.params);
    expect(JSON.stringify(actualPlan)).toContain("duels_play_history_idx");
    expect(JSON.stringify(actualPlan)).not.toContain("TEMP B-TREE");
  }
  // A selective status can use the status index instead of scanning ordered history.
  const filtered = duelHistoryQuery("history-test", 1, true, { scope: "all", status: "cancelled" });
  const filteredPlan = JSON.stringify(db.prepare(`explain query plan ${filtered.sql}`).all(filtered.params));
  expect(filteredPlan).toMatch(/USING INDEX duels_(play_history|guild_status)_idx/);
  finished(); finished();
  const first = history({ limit: 1 });
  const query = duelHistoryQuery("history-test", 1, true, { scope: "all", cursor: first.nextCursor });
  const cursorPlan = JSON.stringify(db.prepare(`explain query plan ${query.sql}`).all(query.params));
  expect(cursorPlan).toContain("duels_play_history_idx");
  expect(cursorPlan).toMatch(/<expr>.*[<>]=?\?/);
  const nullTimePlan = JSON.stringify(db.prepare(`explain query plan ${query.nullTimeSql}`).all(query.params));
  expect(nullTimePlan).toContain("duels_play_history_idx");
  expect(nullTimePlan).toContain("<expr>=?");
  expect(nullTimePlan).not.toContain("TEMP B-TREE");
  finished({ time: "unreadable", name: "No timestamp" }); finished({ time: "unreadable", name: "No timestamp" });
  const nullPage = history({ q: "No timestamp", limit: 1 });
  const nullQuery = duelHistoryQuery("history-test", 1, true, { scope: "all", q: "No timestamp", cursor: nullPage.nextCursor });
  const nullCursorPlan = JSON.stringify(db.prepare(`explain query plan ${nullQuery.sql}`).all(nullQuery.params));
  expect(nullCursorPlan).toContain("duels_play_history_idx");
  expect(nullCursorPlan).toContain("<expr>=?");
  expect(nullCursorPlan).not.toContain("TEMP B-TREE");
});
