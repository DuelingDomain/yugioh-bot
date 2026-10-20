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
    insert into users(id,username,display_name,created_at,image_url,first_sign_in_at,last_seen_at,last_route,online_since) values
      (1,'op','Operator','2026-01-01 00:00:00',null,null,null,null,null),
      (2,'ann','Ann','2026-08-14 10:00:00','https://img.clerk.com/ann.png',${Date.parse("2026-08-15T09:00:00Z")},${NOW - 20_000},'/duels/[slug]',${NOW - 1_500_000}),
      (3,'bo','Bo','2026-09-01 10:00:00',null,null,${NOW - 3 * 3600_000},'/decks',${NOW - 4 * 3600_000});
    insert into players(id,guild_id,discord_user_id,display_name,user_id) values (12,'g','d2','Ann',2),(13,'g','d3','Bo',3),(22,'other','d2','Ann',2);`);
  const duel = db.prepare(`insert into duels(id,guild_id,web_slug,name,organizer_player_id,mode,status,format,created_at,started_at,ended_at,winner_seat)
    values (?,?,?,?,12,'domain',?,?,?,?,?,?)`);
  const seat = db.prepare("insert into duel_seats(duel_id,seat,player_id) values (?,?,?)");
  // Live 4-way table, a 1v1 win, a Tag loss (the winner's partner sits on seat 3), an old win, a duel in another guild.
  duel.run(1, "g", "live4", "Friday Fours", "active", "ffa4", "2026-10-19 11:30:00", "2026-10-19 11:35:00", null, null);
  db.prepare("update duels set last_activity_at = '2026-10-19 11:59:00' where id = 1").run();
  seat.run(1, 0, 13); seat.run(1, 1, 12);
  duel.run(2, "g", "won1", "Ranked queue", "completed", "1v1", "2026-10-19 09:00:00", "2026-10-19 09:05:00", "2026-10-19 09:40:00", 1);
  seat.run(2, 0, 13); seat.run(2, 1, 12);
  duel.run(3, "g", "tagloss", "Tag night", "completed", "tag", "2026-10-18 19:00:00", "2026-10-18 19:05:00", "2026-10-18 19:50:00", 1);
  seat.run(3, 0, 12); seat.run(3, 1, 13);
  duel.run(4, "g", "oldwin", "Long ago", "completed", "1v1", "2026-08-20 19:00:00", "2026-08-20 19:05:00", "2026-08-20 19:50:00", 0);
  seat.run(4, 0, 12); seat.run(4, 1, 13);
  duel.run(5, "other", "elsewhere", "Other guild", "completed", "1v1", "2026-10-19 08:00:00", "2026-10-19 08:05:00", "2026-10-19 08:30:00", 0);
  seat.run(5, 0, 22);
  db.exec(`insert into drafts(id,guild_id,channel_id,name,status,created_by_user_id,web_slug,created_at,started_at,ended_at)
    values (1,'g','c','Sunday Cube','completed','2','cube1','2026-10-17 09:00:00','2026-10-17 09:10:00','2026-10-17 11:00:00');
    insert into draft_players(draft_id,player_id) values (1,12);`);
});
afterEach(() => { db.close(); vi.unstubAllEnvs(); vi.useRealTimers(); });

async function person(id: string) {
  const { GET } = await import("../app/api/admin/console/people/[id]/route");
  return GET(new Request(`https://internal/api/admin/console/people/${id}`), { params: Promise.resolve({ id }) });
}

it("returns who the person is, where they are now, recent duels and drafts, and 7 and 30 day counts", async () => {
  const response = await person("2");
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  const { state, data } = await response.json();
  expect(state).toBe("ok");
  expect(data).toMatchObject({
    userId: 2, name: "Ann", username: "ann", avatarUrl: "https://img.clerk.com/ann.png", online: true, label: "4-way duel",
    lastSeenAt: NOW - 20_000, onlineSince: NOW - 1_500_000, joinedAt: Date.parse("2026-08-15T09:00:00Z"),
    current: { kind: "duel", slug: "live4", name: "Friday Fours", href: "/duels/live4", label: "4-way duel", status: "active" },
    week: { duels: 3, drafts: 1 },
    results: { wins: 1, games: 2 },
  });
  // Newest first. Other guilds are not read.
  expect(data.recent.map((a: { name: string; outcome: string; tone: string; href: string }) => [a.name, a.outcome, a.tone, a.href])).toEqual([
    ["Friday Fours", "Playing", "live", "/duels/live4"],
    ["Ranked queue", "Won", "good", "/duels/won1/replay"],
    ["Tag night", "Lost", "bad", "/duels/tagloss/replay"],
    ["Sunday Cube", "Completed", "quiet", "/draft/cube1"],
    ["Long ago", "Won", "good", "/duels/oldwin/replay"],
  ]);
});

it("an offline person has no current table, page, last-seen time or online stretch", async () => {
  const { data } = await (await person("3")).json();
  expect(data).toMatchObject({ online: false, current: null, onlineSince: null, label: null, lastSeenAt: null, avatarUrl: null });
});

it("answers 400 for a bad id, 404 for an unknown person, and not-configured without a guild", async () => {
  expect((await person("abc")).status).toBe(400);
  expect((await person("0")).status).toBe(400);
  expect((await person("99")).status).toBe(404);
  // A user who never played in this guild and was never seen is not shown either.
  db.exec("insert into users(id,username,display_name) values (4,'cy','Cy')");
  expect((await person("4")).status).toBe(404);
  vi.stubEnv("DISCORD_GUILD_ID", ""); vi.resetModules();
  const body = await (await person("2")).json();
  expect(body.state).toBe("not-configured");
});

it("answers 404 to a non-owner and 401 without a session", async () => {
  auth.mockResolvedValue({ user: { id: "2", name: "Ann" } });
  expect((await person("2")).status).toBe(404);
  auth.mockResolvedValue(null);
  expect((await person("2")).status).toBe(401);
});
