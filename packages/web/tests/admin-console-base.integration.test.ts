import Database from "better-sqlite3";
import { migrate } from "@yugidraft/shared/db";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { auth, getDb } = vi.hoisted(() => ({ auth: vi.fn(), getDb: vi.fn() }));
vi.mock("@/lib/session-identity", async () => {
  const { sessionFixture } = await import("./fixtures/session");
  return sessionFixture(auth);
});
vi.mock("@/lib/db", () => ({ getDb }));

let db: Database.Database;
beforeEach(() => {
  vi.resetModules(); auth.mockReset(); getDb.mockReset();
  auth.mockResolvedValue({ user: { id: "1", name: "Operator" } });
  vi.stubEnv("OWNER_USER_IDS", "1"); vi.stubEnv("WEB_URL", "https://app.example.test");
  db = new Database(":memory:"); migrate(db); getDb.mockReturnValue(db);
  db.exec(`insert into users(id,username,display_name) values(1,'op','Operator'),(2,'ann','Ann'),(3,'bo','Bo'),(4,'cy','Cy');
    insert into players(id,guild_id,discord_user_id,display_name,user_id) values(12,'g','d2','Ann',2),(13,'g','d3','Bo',3);`);
});
afterEach(() => { db.close(); vi.unstubAllEnvs(); });

const beat = (route: unknown, origin: string | null = "https://app.example.test") => new Request("https://internal/api/presence", {
  method: "POST", headers: { ...(origin ? { origin } : {}), "content-type": "application/json" }, body: JSON.stringify({ route }) });
async function post(request: Request) { const { POST } = await import("../app/api/presence/route"); return POST(request); }
async function online() { const { GET } = await import("../app/api/admin/console/online/route"); return GET(); }

it("stores only the latest route template and rate-limits a second beat", async () => {
  expect((await post(beat("/decks/new"))).status).toBe(204);
  expect(db.prepare("select last_route r, last_seen_at s from users where id=1").get()).toMatchObject({ r: "/decks/new" });
  const second = await post(beat("/draft/[slug]"));
  expect(second.status).toBe(429);
  expect(second.headers.get("retry-after")).toBe("30");
  expect(db.prepare("select last_route r from users where id=1").get()).toEqual({ r: "/decks/new" });
  // A changed route is let through after 10 s, so the label follows the person.
  db.prepare("update users set last_seen_at = last_seen_at - 11000 where id=1").run();
  expect((await post(beat("/draft/[slug]"))).status).toBe(204);
  expect(db.prepare("select last_route r from users where id=1").get()).toEqual({ r: "/draft/[slug]" });
});
it.each(["/duels/abc-123", "/decks/new?x=1", 5, null])("refuses an unknown route %j", async (route) => {
  expect((await post(beat(route))).status).toBe(400);
  expect(db.prepare("select last_route r from users where id=1").get()).toEqual({ r: null });
});
it("refuses a beat from another origin and a signed-out beat", async () => {
  expect((await post(beat("/decks", "https://evil.test"))).status).toBe(403);
  expect((await post(beat("/decks", null))).status).toBe(403);
  auth.mockResolvedValue(null);
  expect((await post(beat("/decks"))).status).toBe(401);
});
it("does nothing when PRESENCE_ENABLED is 0", async () => {
  vi.stubEnv("PRESENCE_ENABLED", "0");
  expect((await post(beat("/decks"))).status).toBe(204);
  expect(db.prepare("select last_route r from users where id=1").get()).toEqual({ r: null });
});

it("lists people seen in the last 2 minutes with friendly labels, newest first", async () => {
  const now = Date.now();
  db.prepare("update users set last_seen_at=?, last_route=? where id=?").run(now - 5_000, "/decks/new", 2);
  db.prepare("update users set last_seen_at=?, last_route=? where id=?").run(now - 60_000, "/duels/[slug]", 3);
  db.prepare("update users set last_seen_at=?, last_route=? where id=?").run(now - 130_000, "/cubes/[id]", 4);
  db.exec(`insert into duels(id,guild_id,web_slug,name,organizer_player_id,mode,status,format)
    values(1,'g','t1','Table',13,'domain','active','ffa4'); insert into duel_seats(duel_id,seat,player_id) values(1,0,13);`);
  const response = await online();
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.state).toBe("ok");
  expect(body.data.count).toBe(2);
  expect(body.data.users.map((u: { name: string; label: string }) => [u.name, u.label])).toEqual([["Ann", "Deck builder"], ["Bo", "4-way duel"]]);
  expect(body.data.bySection).toEqual([{ label: "4-way duel", count: 1 }, { label: "Deck builder", count: 1 }]);
});
it("says Duel lobby for a table that has not started", async () => {
  db.prepare("update users set last_seen_at=?, last_route=? where id=2").run(Date.now(), "/duels/[slug]");
  db.exec(`insert into duels(id,guild_id,web_slug,name,organizer_player_id,mode,status,format)
    values(1,'g','t1','Table',12,'domain','lobby','tag'); insert into duel_seats(duel_id,seat,player_id) values(1,0,12);`);
  expect((await (await online()).json()).data.users[0].label).toBe("Duel lobby");
});
it("answers 404 to anyone who is not an owner and 401 without a session", async () => {
  auth.mockResolvedValue({ user: { id: "2", name: "Ann" } });
  expect((await online()).status).toBe(404);
  auth.mockResolvedValue(null);
  expect((await online()).status).toBe(401);
});
it("clears presence when the account is deleted", async () => {
  db.prepare("update users set last_seen_at=?, last_route=? where id=2").run(Date.now(), "/decks");
  // A user with game history is anonymised and kept; one without is removed.
  db.exec(`insert into duels(id,guild_id,web_slug,name,organizer_player_id,mode,status) values(1,'g','t1','Table',12,'domain','completed');
    insert into duel_seats(duel_id,seat,player_id) values(1,0,12);`);
  const { deleteUserAccount } = await import("@yugidraft/shared/services");
  deleteUserAccount(db, 2);
  expect(db.prepare("select last_seen_at s, last_route r from users where id=2").get()).toEqual({ s: null, r: null });
});
