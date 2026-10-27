import Database from "better-sqlite3";
import { migrate } from "@yugidraft/shared/db";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { auth, getDb } = vi.hoisted(() => ({ auth: vi.fn(), getDb: vi.fn() }));
vi.mock("@/lib/session-identity", async () => {
  const { sessionFixture } = await import("./fixtures/session");
  return sessionFixture(auth);
});
vi.mock("@/lib/db", () => ({ getDb }));

const NOW = Date.parse("2026-10-19T12:00:00.000Z");
let db: Database.Database;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.resetModules(); auth.mockReset(); getDb.mockReset();
  auth.mockResolvedValue({ user: { id: "1", name: "Operator" } });
  vi.stubEnv("OWNER_USER_IDS", "1"); vi.stubEnv("DISCORD_GUILD_ID", "g");
  db = new Database(":memory:"); migrate(db); getDb.mockReturnValue(db);
  db.exec(`
    insert into users(id,username,display_name,created_at) values
      (1,'op','Operator','2026-10-19 08:00:00'), (2,'ann','Ann','2026-10-19 09:00:00'),
      (3,'bo','Bo','2026-10-18T23:59:00.000Z'), (4,'cy','Cy','2026-10-10 10:00:00');
    insert into players(id,guild_id,discord_user_id,display_name,user_id) values (12,'g','d2','Ann',2),(13,'g','d3','Bo',3),(14,'g','d4','Cy',4);`);
});
afterEach(() => { db.close(); vi.unstubAllEnvs(); vi.useRealTimers(); });

async function section(id: "live" | "stats") {
  const { GET } = id === "live" ? await import("../app/api/admin/console/live/route") : await import("../app/api/admin/console/stats/route");
  return GET();
}
function duel(id: number, slug: string, p: { status: string; format?: string; ranked?: number; created: string; started?: string | null; ended?: string | null;
  activity?: string | null; guild?: string; kind?: string; settings?: string | null; seats?: (number | "bot")[] }) {
  db.prepare(`insert into duels(id,guild_id,web_slug,name,organizer_player_id,mode,status,format,ranked,created_at,started_at,ended_at,last_activity_at,kind,settings_json)
    values (?,?,?,?,?,'domain',?,?,?,?,?,?,?,?,?)`).run(id, p.guild ?? "g", slug, `Table ${slug}`, 12, p.status, p.format ?? "1v1", p.ranked ?? 0,
    p.created, p.started ?? null, p.ended ?? null, p.activity ?? null, p.kind ?? "play", p.settings ?? null);
  (p.seats ?? []).forEach((who, seat) => who === "bot"
    ? db.prepare("insert into duel_seats(duel_id,seat,player_id,is_bot) values (?,?,null,1)").run(id, seat)
    : db.prepare("insert into duel_seats(duel_id,seat,player_id) values (?,?,?)").run(id, seat, who));
}
function draft(id: number, slug: string, p: { status: string; created: string; started?: string | null; ended?: string | null; wave?: number; step?: number; players?: number[] }) {
  db.prepare(`insert into drafts(id,guild_id,channel_id,name,status,created_by_user_id,created_at,started_at,ended_at,current_wave_number,current_pick_step,web_slug)
    values (?,'g','c',?,?,'2',?,?,?,?,?,?)`).run(id, `Draft ${slug}`, p.status, p.created, p.started ?? null, p.ended ?? null, p.wave ?? 0, p.step ?? 0, slug);
  (p.players ?? []).forEach((playerId, seat) => db.prepare("insert into draft_players(draft_id,player_id,seat_index) values (?,?,?)").run(id, playerId, seat));
}
function seed() {
  duel(1, "d1", { status: "active", ranked: 1, created: "2026-10-19 11:50:00", started: "2026-10-19 11:55:00", activity: "2026-10-19 11:58:00",
    settings: '{"genesys":{"pointCap":100}}', seats: [12, 13] });
  duel(2, "d2", { status: "active", format: "ffa4", created: "2026-10-19 10:00:00", started: "2026-10-19 10:05:00", activity: "2026-10-19 10:30:00", seats: [14, 12, "bot"] });
  duel(3, "d3", { status: "lobby", format: "tag", created: "2026-10-19 11:57:00", activity: "2026-10-19 11:57:00", seats: [12] });
  duel(4, "d4", { status: "completed", created: "2026-10-18 19:50:00", started: "2026-10-18 20:00:00", ended: "2026-10-18 21:00:00", seats: [13, 14] });
  duel(5, "d5", { status: "active", kind: "replay-fork", created: "2026-10-19 11:50:00", started: "2026-10-19 11:55:00", activity: "2026-10-19 11:58:00", seats: [12] });
  duel(6, "d6", { status: "cancelled", created: "2026-10-19 09:00:00", ended: "2026-10-19 09:30:00", seats: [12] });
  duel(7, "d7", { status: "completed", created: "2026-10-09 09:00:00", started: "2026-10-09 09:05:00", ended: "2026-10-09 10:00:00", seats: [12, 13] });
  duel(8, "d8", { status: "active", guild: "other", created: "2026-10-19 11:50:00", started: "2026-10-19 11:55:00", activity: "2026-10-19 11:58:00", seats: [12] });
  draft(1, "dr1", { status: "active", created: "2026-10-19 10:50:00", started: "2026-10-19T11:00:00.000Z", wave: 2, step: 3, players: [13, 12] });
  draft(2, "dr2", { status: "pending", created: "2026-10-19 11:30:00", players: [12] });
  draft(3, "dr3", { status: "pending", created: "2026-10-10 11:30:00" });
  draft(4, "dr4", { status: "completed", created: "2026-10-17 09:00:00", started: "2026-10-17 10:00:00", ended: "2026-10-17 11:00:00", players: [14] });
  db.prepare("update users set last_seen_at = ? where id = 1").run(NOW - 60_000);
}

it("lists running duels and lobbies with players, then open drafts, and filters stale, empty, other-guild and replay-fork rows", async () => {
  seed();
  duel(9, "empty-lobby", { status: "lobby", created: "2026-10-19 11:59:00", seats: [] });
  draft(9, "25-hours-old", { status: "pending", created: "2026-10-18 11:00:00" });
  const response = await section("live");
  expect(response.status).toBe(200);
  const { state, data } = await response.json();
  expect(state).toBe("ok");
  expect(data.duels.map((d: { slug: string; status: string }) => [d.slug, d.status])).toEqual([["d1", "active"], ["d3", "lobby"]]);
  expect(data.duels.find((d: { slug: string }) => d.slug === "d1")).toMatchObject({ name: "Table d1", format: "1v1", formatLabel: "1v1 duel", players: ["Ann", "Bo"], ranked: true, genesys: true,
    startedAt: Date.parse("2026-10-19T11:55:00Z"), watchHref: "/admin/watch/duel/d1" });
  expect(data.duels.find((d: { slug: string }) => d.slug === "d3")).toMatchObject({ formatLabel: "Tag duel", players: ["Ann"], startedAt: null, ranked: false, genesys: false, watchHref: "/admin/watch/duel/d3" });
  expect(data.drafts.map((d: { slug: string }) => d.slug)).toEqual(["dr1", "dr2"]); // running first, then lobbies
  expect(data.drafts.find((d: { slug: string }) => d.slug === "dr1")).toMatchObject({
    status: "active", players: ["Bo", "Ann"], progress: "Round 2, pick 3", startedAt: Date.parse("2026-10-19T11:00:00Z"), href: "/admin/watch/draft/dr1" });
});

it("matches deploy guard exclusions for active forks, deck-editor tests and idle tables", async () => {
  const created = "2026-10-19 11:59:00";
  duel(1, "live", { status: "active", created, ranked: 1, seats: [12, 13] });
  duel(2, "practice-fork", { status: "active", created, kind: "replay-fork", seats: [12] });
  duel(3, "deck-test", { status: "active", created, seats: [12, "bot"] });
  db.prepare("update duels set setup_json = '{\"testDuel\":true}' where id = 3").run();
  duel(4, "old-fork", { status: "active", created: "2026-10-18 00:00:00", kind: "replay-fork", seats: [12] });
  duel(5, "idle", { status: "active", created: "2026-10-19 11:49:00", seats: [12, 13] });
  const { data } = await (await section("live")).json();
  expect(data.duels.map((d: { slug: string }) => d.slug)).toEqual(["live"]);
  expect(db.prepare("select count(*) as n from duels where status = 'active'").get()).toEqual({ n: 5 });
});

it("adds seats with pictures and bots, the turn from the clock, and draft progress", async () => {
  seed();
  db.prepare("update users set image_url = ? where id = 2").run("https://img.clerk.com/ann.png");
  db.prepare("update duels set clock_json = ? where id = 1").run('{"turn":5,"remainingMs":[1000,2000],"activeSeat":1,"startedAt":1}');
  db.exec(`insert into users(id,username,display_name) values (6,'bot1','Bot 1');
    insert into players(id,guild_id,discord_user_id,display_name,user_id) values (15,'g','bot_player_dev_1','Bot 1',6);
    insert into draft_players(draft_id,player_id,seat_index,pick_count) values (1,15,2,7);
    update draft_players set pick_count = 6 where draft_id = 1 and player_id = 12;
    update drafts set config_json = '{"mode":"theme","cardsPerPlayer":45,"poolSource":{"cubeId":1,"cubeName":"Vintage 540"}}' where id = 1;`);
  const { data } = await (await section("live")).json();
  const d1 = data.duels.find((d: { slug: string }) => d.slug === "d1");
  expect(d1).toMatchObject({ turn: 5, activeSeat: 1, lastActivityAt: Date.parse("2026-10-19T11:58:00Z"),
    seats: [{ name: "Ann", avatarUrl: "https://img.clerk.com/ann.png", bot: false, userId: 2 }, { name: "Bo", avatarUrl: null, bot: false, userId: 3 }] });
  expect(data.duels.find((d: { slug: string }) => d.slug === "d3")).toMatchObject({ turn: null, activeSeat: null });
  expect(data.drafts.find((d: { slug: string }) => d.slug === "dr1")).toMatchObject({
    modeLabel: "Theme", cubeName: "Vintage 540", picksMade: 7, picksTotal: 45,
    seats: [{ name: "Bo", bot: false, userId: 3 }, { name: "Ann", bot: false, userId: 2 }, { name: "Bot 1", avatarUrl: null, bot: true, userId: null }] });
  // Duels that ended are in the "today" section now, not in "live".
  expect(data.ended).toBeUndefined();
});

it("counts today and seven Eastern days with a series per metric", async () => {
  seed();
  // Sign-ups are first web sign-ins. Ann and Operator signed in today, Bo at 23:30 EDT yesterday (already today in UTC), Cy before the window.
  const signedIn = db.prepare("update users set first_sign_in_at = ? where id = ?");
  signedIn.run(Date.parse("2026-10-19T08:00:00Z"), 1); signedIn.run(Date.parse("2026-10-19T09:00:00Z"), 2);
  signedIn.run(Date.parse("2026-10-19T03:30:00Z"), 3); signedIn.run(Date.parse("2026-10-10T10:00:00Z"), 4);
  // A Discord-only row created today that never signed in on the web is not a sign-up.
  db.prepare("insert into users(id,username,display_name,created_at) values (5,'dc','Discord Only','2026-10-19 10:00:00')").run();
  const response = await section("stats");
  expect(response.status).toBe(200);
  const { state, data } = await response.json();
  expect(state).toBe("ok");
  expect(data.timezone).toBe("America/New_York");
  expect(data.days).toEqual(["2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18", "2026-10-19"]);
  expect(data.series.signups).toEqual([0, 0, 0, 0, 0, 1, 2]);
  expect(data.series.duelsStarted).toEqual([0, 0, 0, 0, 0, 1, 2]);
  expect(data.series.duelsFinished).toEqual([0, 0, 0, 0, 0, 1, 0]);
  expect(data.series.draftsStarted).toEqual([0, 0, 0, 0, 1, 0, 1]);
  expect(data.series.draftsCompleted).toEqual([0, 0, 0, 0, 1, 0, 0]);
  // Ann, Bo, Cy and Operator today (duels, draft, presence); Bo and Cy yesterday; Cy in the draft on the 17th.
  expect(data.series.activeUsers).toEqual([0, 0, 0, 0, 1, 2, 4]);
  expect(data.today).toEqual({ signups: 2, activeUsers: 4, duelsStarted: 2, duelsFinished: 0, draftsStarted: 1, draftsCompleted: 0 });
  expect(data.last7Days).toEqual({ signups: 3, activeUsers: 4, duelsStarted: 3, duelsFinished: 1, draftsStarted: 2, draftsCompleted: 1 });
  // The week before (Oct 6 to 12): the duel on the 9th between Ann and Bo; Cy signed in on the 10th.
  expect(data.previous7Days).toEqual({ signups: 1, activeUsers: 2, duelsStarted: 1, duelsFinished: 1, draftsStarted: 0, draftsCompleted: 0 });
});

it("asks for DISCORD_GUILD_ID when it is missing, for both sections", async () => {
  vi.stubEnv("DISCORD_GUILD_ID", "");
  for (const id of ["live", "stats"] as const) {
    const body = await (await section(id)).json();
    expect(body.state).toBe("not-configured");
    expect(body.message).toContain("DISCORD_GUILD_ID");
  }
});
it("answers 404 to a non-owner and 401 without a session", async () => {
  auth.mockResolvedValue({ user: { id: "2", name: "Ann" } });
  expect((await section("live")).status).toBe(404);
  expect((await section("stats")).status).toBe(404);
  auth.mockResolvedValue(null);
  expect((await section("live")).status).toBe(401);
});
it("shows an error result, not a throw, when the database read fails", async () => {
  getDb.mockImplementation(() => { throw new Error("disk full at /secret/path"); });
  const body = await (await section("live")).json();
  expect(body).toMatchObject({ state: "error", message: "Live duels and drafts could not be read from the database." });
  expect(JSON.stringify(body)).not.toContain("secret");
});

it("bounds private and public open rows at 100 per list", async () => {
  for (let id = 1; id <= 105; id++) {
    duel(id, `live-${id}`, { status: "active", created: "2026-10-19 11:58:00", started: "2026-10-19 11:58:00", settings: JSON.stringify({ visibility: id % 2 ? "private" : "public" }), seats: [12,13] });
    draft(id, `draft-${id}`, { status: "active", created: "2026-10-19 08:00:00", players: [12,13] });
  }
  db.exec("update drafts set visibility='private' where id%2=1");
  const { data } = await (await section("live")).json();
  expect(data.duels).toHaveLength(100); expect(data.drafts).toHaveLength(100);
  expect(data.duels.find((d: { slug: string }) => d.slug === "live-105")).toMatchObject({ visibility: "private", watchHref: "/admin/watch/duel/live-105" });
  expect(data.drafts.find((d: { slug: string }) => d.slug === "draft-105")).toMatchObject({ visibility: "private", href: "/admin/watch/draft/draft-105" });
});
