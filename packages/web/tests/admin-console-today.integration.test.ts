import Database from "better-sqlite3";
import { migrate } from "@yugidraft/shared/db";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { auth, getDb } = vi.hoisted(() => ({ auth: vi.fn(), getDb: vi.fn() }));
vi.mock("@/lib/session-identity", async () => {
  const { sessionFixture } = await import("./fixtures/session");
  return sessionFixture(auth);
});
vi.mock("@/lib/db", () => ({ getDb }));

// 03:30 UTC on Oct 20 is 23:30 on Oct 19 in UTC-4: the two "todays" differ.
const NOW = Date.parse("2026-10-20T03:30:00.000Z");
let db: Database.Database;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.resetModules(); auth.mockReset(); getDb.mockReset();
  auth.mockResolvedValue({ user: { id: "1", name: "Operator" } });
  vi.stubEnv("OWNER_USER_IDS", "1"); vi.stubEnv("DISCORD_GUILD_ID", "g");
  db = new Database(":memory:"); migrate(db); getDb.mockReturnValue(db);
  db.exec(`
    insert into users(id,username,display_name,image_url) values (1,'op','Operator',null), (2,'ann','Ann','https://img.clerk.com/ann.png'), (3,'bo','Bo',null), (4,'cy','Cy',null);
    insert into players(id,guild_id,discord_user_id,display_name,user_id) values (12,'g','d2','Ann',2),(13,'g','d3','Bo',3),(14,'g','d4','Cy',4);`);
});
afterEach(() => { db.close(); vi.unstubAllEnvs(); vi.useRealTimers(); });

async function today(query = "") {
  const { GET } = await import("../app/api/admin/console/today/route");
  return GET(new Request(`https://internal/api/admin/console/today${query}`));
}
type Seat = number | "bot";
function duel(id: number, slug: string, p: { status: string; format?: string; ranked?: number; created?: string; started?: string | null; ended?: string | null;
  activity?: string | null; winner?: number | null; turns?: number | null; clock?: string | null; guild?: string; kind?: string; seats?: Seat[] }) {
  db.prepare(`insert into duels(id,guild_id,web_slug,name,organizer_player_id,mode,status,format,ranked,created_at,started_at,ended_at,last_activity_at,
      winner_seat,turn_count,clock_json,kind) values (?,?,?,?,12,'domain',?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, p.guild ?? "g", slug, `Table ${slug}`, p.status, p.format ?? "1v1", p.ranked ?? 0, p.created ?? p.started ?? "2026-10-20 00:00:00",
      p.started ?? null, p.ended ?? null, p.activity ?? null, p.winner ?? null, p.turns ?? null, p.clock ?? null, p.kind ?? "play");
  (p.seats ?? [12, 13]).forEach((who, seat) => who === "bot"
    ? db.prepare("insert into duel_seats(duel_id,seat,player_id,is_bot) values (?,?,null,1)").run(id, seat)
    : db.prepare("insert into duel_seats(duel_id,seat,player_id) values (?,?,?)").run(id, seat, who));
}
function seed() {
  duel(1, "t1", { status: "completed", ranked: 1, started: "2026-10-20 01:00:00", ended: "2026-10-20 01:30:00", winner: 0, turns: 14 });
  duel(2, "t2", { status: "completed", format: "tag", started: "2026-10-19 22:00:00", ended: "2026-10-19 23:00:00", winner: 1, turns: 9, seats: [12, 13, 14, "bot"] });
  duel(3, "t3", { status: "interrupted", format: "ffa3", started: "2026-10-19T05:00:00.000Z", ended: "2026-10-19T06:00:00.000Z", seats: [12, 13, 14] });
  duel(4, "t4", { status: "active", format: "ffa4", started: "2026-10-20 03:20:00", activity: "2026-10-20 03:29:00", clock: '{"turn":3,"activeSeat":1}', seats: [12, 13, 14, "bot"] });
  duel(5, "t5", { status: "active", started: "2026-10-20 02:30:00", activity: "2026-10-20 03:00:00", clock: '{"turn":7}' });
  duel(6, "t6", { status: "completed", started: "2026-10-20 00:10:00", ended: "2026-10-20 00:50:00", turns: 30 });
  // Opened before midnight, started after it, still running: ended_at is empty, so the index key is the creation time.
  duel(7, "t7", { status: "active", format: "tag", created: "2026-10-19 23:58:00", started: "2026-10-20 00:01:00", activity: "2026-10-20 03:28:00", seats: [12, 13, 14, "bot"] });
  duel(8, "t8", { status: "cancelled", started: "2026-10-20 02:00:00", ended: "2026-10-20 02:05:00" });
  // Never shown: another guild, a replay fork, a lobby that never started, a duel that started before both midnights.
  duel(9, "x-guild", { status: "completed", guild: "other", started: "2026-10-20 01:00:00", ended: "2026-10-20 01:10:00" });
  duel(10, "x-fork", { status: "active", kind: "replay-fork", started: "2026-10-20 01:00:00", activity: "2026-10-20 03:29:00" });
  duel(11, "x-lobby", { status: "lobby", created: "2026-10-20 03:00:00", started: null });
  duel(12, "x-old", { status: "completed", started: "2026-10-19 03:00:00", ended: "2026-10-20 00:30:00", winner: 0 });
}

it("lists every duel that started today (UTC without tz), newest first, with seats, results, turns and links", async () => {
  seed();
  const response = await today();
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  const { state, data } = await response.json();
  expect(state).toBe("ok");
  expect(data).toMatchObject({ tzOffsetMinutes: 0, dayStart: Date.parse("2026-10-20T00:00:00Z"), limit: 200,
    counts: { all: 6, oneVsOne: 4, multi: 2, ranked: 1 } });
  expect(data.duels.map((d: { slug: string; result: string }) => [d.slug, d.result])).toEqual([
    ["t4", "live"], ["t5", "idle"], ["t8", "cancelled"], ["t1", "won"], ["t6", "draw"], ["t7", "live"]]);
  const bySlug = Object.fromEntries(data.duels.map((d: { slug: string }) => [d.slug, d]));
  expect(bySlug.t1).toEqual({
    slug: "t1", name: "Table t1", format: "1v1", formatLabel: "1v1 duel", ranked: true, genesys: false, result: "won", turns: 14,
    startedAt: Date.parse("2026-10-20T01:00:00Z"), endedAt: Date.parse("2026-10-20T01:30:00Z"), href: "/duels/t1/replay",
    seats: [
      { name: "Ann", avatarUrl: "https://img.clerk.com/ann.png", bot: false, userId: 2, outcome: "won" },
      { name: "Bo", avatarUrl: null, bot: false, userId: 3, outcome: "lost" },
    ],
  });
  // A running duel links to the table and shows the clock turn; no end time, no outcome yet.
  expect(bySlug.t4).toMatchObject({ formatLabel: "4-way duel", turns: 3, endedAt: null, href: "/duels/t4" });
  expect(bySlug.t4.seats.map((s: { name: string; outcome: unknown }) => [s.name, s.outcome])).toEqual([["Ann", null], ["Bo", null], ["Cy", null], ["Practice Bot", null]]);
  expect(bySlug.t5).toMatchObject({ result: "idle", href: "/duels/t5", turns: 7 });
  expect(bySlug.t6.seats.map((s: { outcome: unknown }) => s.outcome)).toEqual(["draw", "draw"]);
  expect(bySlug.t8).toMatchObject({ href: "/duels/t8/replay", endedAt: Date.parse("2026-10-20T02:05:00Z") });
  // Only internal paths.
  for (const d of data.duels) expect(d.href).toMatch(/^\/duels\/[a-z0-9-]+(\/replay)?$/);
});

it("uses the browser day from ?tz= (minutes east of UTC): Tag partners win together, an interrupted duel has no winner", async () => {
  seed();
  const { data } = await (await today("?tz=-240")).json();
  expect(data).toMatchObject({ tzOffsetMinutes: -240, dayStart: Date.parse("2026-10-19T04:00:00Z"), counts: { all: 8, oneVsOne: 4, multi: 4, ranked: 1 } });
  expect(data.duels.map((d: { slug: string }) => d.slug)).toEqual(["t4", "t5", "t8", "t1", "t6", "t7", "t2", "t3"]);
  const tag = data.duels.find((d: { slug: string }) => d.slug === "t2");
  expect(tag.seats.map((s: { name: string; outcome: string }) => [s.name, s.outcome])).toEqual([["Ann", "lost"], ["Bo", "won"], ["Cy", "lost"], ["Practice Bot", "won"]]);
  const cut = data.duels.find((d: { slug: string }) => d.slug === "t3");
  expect(cut).toMatchObject({ result: "interrupted", href: "/duels/t3/replay", turns: null });
  expect(cut.seats.every((s: { outcome: unknown }) => s.outcome === null)).toBe(true);
});

it.each([["?tz=abc", 0], ["?tz=1.5", 0], ["?tz=-9999", -840], ["?tz=1000", 840], ["?tz=330", 330], ["?tz=", 0]])("reads tz %s as %i minutes", async (query, minutes) => {
  const { data } = await (await today(query)).json();
  expect(data.tzOffsetMinutes).toBe(minutes);
  expect(data.counts.all).toBe(0);
  expect(data.duels).toEqual([]);
});

it("sends at most 200 rows but counts the whole day", async () => {
  const insert = db.prepare(`insert into duels(guild_id,web_slug,name,organizer_player_id,mode,status,format,ranked,created_at,started_at,ended_at,winner_seat)
    values ('g',?,?,12,'domain','completed',?,?,?,?,?,0)`);
  const seat = db.prepare("insert into duel_seats(duel_id,seat,player_id) values (?,?,?)");
  db.transaction(() => {
    for (let i = 0; i < 230; i++) {
      const at = new Date(Date.parse("2026-10-20T00:00:00Z") + i * 50_000).toISOString();
      const id = Number(insert.run(`bulk-${i}`, `Bulk ${i}`, i % 3 === 0 ? "ffa3" : "1v1", i % 2, at, at, at).lastInsertRowid);
      seat.run(id, 0, 12); seat.run(id, 1, 13);
    }
  })();
  const { data } = await (await today()).json();
  expect(data.duels).toHaveLength(200);
  expect(data.counts).toEqual({ all: 230, oneVsOne: 153, multi: 77, ranked: 115 });
  expect(data.duels[0].slug).toBe("bulk-229");
  expect(data.duels[0].seats).toHaveLength(2);
});

it("asks for DISCORD_GUILD_ID when it is missing", async () => {
  vi.stubEnv("DISCORD_GUILD_ID", "");
  expect(await (await today()).json()).toMatchObject({ state: "not-configured", message: expect.stringContaining("DISCORD_GUILD_ID") });
});
it("answers 404 to a non-owner and 401 without a session, and hides a database error", async () => {
  auth.mockResolvedValue({ user: { id: "2", name: "Ann" } });
  expect((await today()).status).toBe(404);
  auth.mockResolvedValue(null);
  expect((await today()).status).toBe(401);
  auth.mockResolvedValue({ user: { id: "1", name: "Operator" } });
  getDb.mockImplementation(() => { throw new Error("disk full at /secret/path"); });
  const body = await (await today()).json();
  expect(body).toMatchObject({ state: "error", message: "The duels of today could not be read from the database." });
  expect(JSON.stringify(body)).not.toContain("secret");
});
