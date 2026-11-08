import Database from "better-sqlite3";
import { migrate } from "@yugidraft/shared/db";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { auth, getDb } = vi.hoisted(() => ({ auth: vi.fn(), getDb: vi.fn() }));
vi.mock("@/lib/session-identity", async () => {
  const { sessionFixture } = await import("./fixtures/session");
  return sessionFixture(auth);
});
vi.mock("@/lib/db", () => ({ getDb }));

// 03:30 UTC on Oct 20 is 23:30 EDT on Oct 19. "7d" is Eastern Oct 13 to Oct 19; the period before is Oct 6 to Oct 12.
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
    insert into users(id,username,display_name) values (1,'op','Operator'),(2,'ann','Ann'),(3,'bo','Bo'),(4,'cy','Cy');
    insert into players(id,guild_id,discord_user_id,display_name,user_id) values (12,'g','d2','Ann',2),(13,'g','d3','Bo',3),(14,'g','d4','Cy',4);`);
});
afterEach(() => { db.close(); vi.unstubAllEnvs(); vi.useRealTimers(); });

const get = async (route: "duel-stats" | "duel-history", query: string) => {
  const { GET } = route === "duel-stats" ? await import("../app/api/admin/console/duel-stats/route") : await import("../app/api/admin/console/duel-history/route");
  return GET(new Request(`https://internal/api/admin/console/${route}?${query}`));
};
function duel(id: number, p: { started: string; format?: string; mode?: string; status?: string; winner?: number | null; reason?: string | null; turns?: number;
  settings?: string; setup?: string; guild?: string; seats?: (number | "bot")[]; ended?: string }) {
  db.prepare(`insert into duels(id,guild_id,web_slug,name,organizer_player_id,mode,status,format,created_at,started_at,ended_at,winner_seat,result_reason,turn_count,settings_json,setup_json)
    values (?,?,?,?,12,?,?,?,?,?,?,?,?,?,?,?)`).run(id, p.guild ?? "g", `d${id}`, `Table ${id}`, p.mode ?? "domain", p.status ?? "completed", p.format ?? "1v1", p.started, p.started,
    p.ended ?? p.started.replace(/\d\d:\d\d$/, "59:00"), p.winner === undefined ? 0 : p.winner, p.reason ?? null, p.turns ?? 10, p.settings ?? null, p.setup ?? null);
  (p.seats ?? [12, 13]).forEach((who, seat) => who === "bot"
    ? db.prepare("insert into duel_seats(duel_id,seat,player_id,is_bot) values (?,?,null,1)").run(id, seat)
    : db.prepare("insert into duel_seats(duel_id,seat,player_id) values (?,?,?)").run(id, seat, who));
}

it("counts a range and the period before it: formats, card formats, endings, players, hours, and the bot toggle", async () => {
  duel(1, { started: "2026-10-19 15:00:00", mode: "standard" });
  // 01:00 UTC on Oct 20 is 21:00 EDT on Oct 19: it belongs to Oct 19, not Oct 20.
  duel(2, { started: "2026-10-20 01:00:00", settings: '{"genesys":{"points":100}}', turns: 20 });
  duel(3, { started: "2026-10-18 12:00:00", format: "tag", reason: "Surrender", seats: [12, 13, 14] });
  duel(4, { started: "2026-10-15 12:00:00", format: "ffa3", status: "interrupted", winner: null, reason: "No player activity for 10 minutes.", seats: [12, 13, 14] });
  duel(5, { started: "2026-10-14 12:00:00", seats: [12, "bot"] });
  duel(6, { started: "2026-10-14 13:00:00", setup: '{"testDuel":true}' });
  duel(7, { started: "2026-10-08 12:00:00", mode: "standard" });
  duel(8, { started: "2026-10-16 12:00:00", guild: "other" });
  const started = Date.parse("2026-10-17T16:00:00Z");
  db.prepare(`insert into remote_tables(slug,guild_id,game_id,seat_count,status,created_by,state_json,created_at,started_at,last_event_at) values ('r1','g','yugioh',2,'ended',1,'{}',?,?,?)`).run(started, started, started);
  db.prepare("insert into remote_seats(table_id,seat,user_id,display_name) values (1,0,1,'Operator')").run();
  db.prepare("update users set first_sign_in_at = ? where id in (3,4)").run(Date.parse("2026-10-16T12:00:00Z"));

  const body = async (query: string) => (await (await get("duel-stats", query)).json()).data;
  const week = await body("range=7d");
  expect(week.range).toMatchObject({ from: "2026-10-13", to: "2026-10-19", days: 7, previous: { from: "2026-10-06", to: "2026-10-12" } });
  expect(week.current).toMatchObject({
    total: 5, byFormat: { "1v1": 2, tag: 1, ffa3: 1, remote: 1, ffa4: 0 }, byCardFormat: { domain: 2, genesys: 0, genesysDomain: 1, normal: 1 },
    endings: { win: 2, surrender: 1, idle: 1, draw: 0 }, practice: 1, test: 1, signups: 2, avgTurns: 40 / 3,
    players: { unique: 4, new: 2, returning: 2 },
  });
  expect(week.previous).toMatchObject({ total: 1, players: { unique: 2, new: 2, returning: 0 } });
  expect(week.perDay.find((d: { day: string }) => d.day === "2026-10-19").n).toBe(2);
  expect(week.perDay).toHaveLength(7);
  expect(week.perHour[11]).toBe(1); // 15:00 UTC on Oct 19 is 11 AM EDT
  expect(week.perHour.reduce((a: number, b: number) => a + b, 0)).toBe(5);

  // Practice-bot and test duels join the totals only on request; the other guild never does.
  expect((await body("range=7d&bots=1")).current).toMatchObject({ total: 7, practice: 1, test: 1 });
  expect((await body("from=2026-10-19&to=2026-10-19")).current.total).toBe(2);
  expect((await (await get("duel-history", "range=7d&limit=2")).json()).data).toMatchObject({ counts: { all: 4 }, duels: [{ slug: "d2" }, { slug: "d1" }], next: expect.any(String) });
  expect((await get("duel-stats", "from=2025-01-01&to=2026-10-19")).status).toBe(400);
  auth.mockResolvedValue({ user: { id: "2", name: "Ann" } });
  expect((await get("duel-stats", "range=7d")).status).toBe(404);
});
