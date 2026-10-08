import Database from "better-sqlite3";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
const state = vi.hoisted(() => ({ db: null as Database.Database | null, userId: 2 }));
vi.mock("@/lib/db", () => ({ getDb: () => state.db! }));
vi.mock("@/lib/env", () => ({ env: { discordGuildId: "g" } }));
vi.mock("@/lib/web-access", () => ({ requireWebAccess: async () => ({ ok: true, userId: state.userId }) }));
vi.mock("@/lib/notify", () => ({ broadcaster: { tournament: vi.fn() }, announcer: { announce: vi.fn() } }));
beforeEach(() => {
  state.db = new Database(":memory:"); migrate(state.db); state.userId = 2;
  state.db.exec(`insert into users(id,username,display_name) values(1,'host','Host'),(2,'stranger','Stranger'),(3,'opponent','Opponent');
    insert into players(id,guild_id,user_id,display_name) values(1,'g',1,'Host'),(2,'g',2,'Stranger'),(3,'g',3,'Opponent');
    insert into tournaments(id,guild_id,name,format,status,created_by_user_id,web_slug) values(1,'g','Hidden Cup','round_robin','active',1,'hidden');
    insert into matches(id,guild_id,player_one_id,player_two_id,winner_id,reporter_id,status,source,tournament_id) values(1,'g',1,3,1,1,'pending','tournament',1);`);
});
afterEach(() => state.db?.close());
it.each(["approve", "deny"])("%s hides private tournament matches before checking player role", async action => {
  const route = action === "approve" ? await import("../app/api/matches/[id]/approve/route") : await import("../app/api/matches/[id]/deny/route");
  const response = await route.POST(new Request("http://local/api/matches/1/" + action), { params: Promise.resolve({ id: "1" }) });
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: "Match not found" });
  state.db!.exec("insert into tournament_invite_grants(tournament_id,user_id) values(1,2)");
  expect((await route.POST(new Request("http://local/"), { params: Promise.resolve({ id: "1" }) })).status).toBe(400);
});
it("dashboard API includes creator and granted entries without player memberships, excluding unrelated open entries", async () => {
  state.db!.exec(`update tournaments set status='pending';
    insert into tournaments(id,guild_id,name,format,status,created_by_user_id,web_slug,visibility) values
      (2,'g','Open','round_robin','pending',1,'open','open'),(3,'g','Created','round_robin','pending',2,'created','private'),(4,'g','Granted','round_robin','pending',1,'granted','private');
    insert into tournament_invite_grants(tournament_id,user_id) values(4,2); delete from players where id=2;`);
  const { GET } = await import("../app/api/dashboard/route");
  const response = await GET();
  expect(response.status).toBe(200);
  expect((await response.json()).tournaments.map((t: { name: string }) => t.name)).toEqual(["Granted", "Created"]);
});
