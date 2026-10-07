import Database from "better-sqlite3";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
const state = vi.hoisted(() => ({ db: null as Database.Database | null, userId: "101", discordId: "900000000000000101" }));
vi.mock("@/lib/db", () => ({ getDb: () => state.db! }));
vi.mock("@/lib/session-identity", async () => {
  const { sessionFixture } = await import("./fixtures/session");
  return sessionFixture((() => ({ auth: async () => ({ user: { id: state.userId, discordUserId: state.discordId, name: "Host" } }) }))().auth);
});
vi.mock("@/lib/env", () => ({ env: { discordBotEnabled: true, webUrl: "https://web.example", discordGuildId: "g", wsInternalSecret: "secret", discordDefaultChannelId: "channel" } }));
beforeEach(() => {
  state.db = new Database(":memory:"); migrate(state.db); state.db.pragma("foreign_keys=on");
  state.db.exec(`insert into users(id,username,display_name,discord_user_id) values
    (101,'host','Host','900000000000000101'),(102,'other','Other','900000000000000102');
    insert into players(id,guild_id,user_id,discord_user_id,display_name) values(1,'g',101,'900000000000000101','Host');
    insert into cubes(id,guild_id,name,created_by_user_id) values(8,'g','Cube',101),(9,'other','Foreign',101);`);
  state.userId = "101"; state.discordId = "900000000000000101";
});
afterEach(() => state.db?.close());
it("rejects non-creators, permits the numeric owner, and scopes guilds", async () => {
  const { DELETE } = await import("../app/api/cubes/[id]/route");
  state.userId = "102"; state.discordId = "900000000000000102";
  const request = new Request("http://localhost/api/cubes/8", { method: "DELETE" });
  expect((await DELETE(request, { params: Promise.resolve({ id: "8" }) })).status).toBe(403);
  state.userId = "101";
  expect((await DELETE(request, { params: Promise.resolve({ id: "8" }) })).status).toBe(200);
  expect((await DELETE(request, { params: Promise.resolve({ id: "9" }) })).status).toBe(404);
});
it("lets a creator whose application ID is a string session value delete their cube", async () => {
  const { DELETE } = await import("../app/api/cubes/[id]/route");
  expect((await DELETE(new Request("http://localhost/api/cubes/8", { method: "DELETE" }), { params: Promise.resolve({ id: "8" }) })).status).toBe(200);
});
it("rejects noncanonical session IDs at a mutation boundary", async () => {
  state.userId = "0101";
  const { DELETE } = await import("../app/api/cubes/[id]/route");
  expect((await DELETE(new Request("http://localhost/api/cubes/8", { method: "DELETE" }), { params: Promise.resolve({ id: "8" }) })).status).toBe(401);
});

const effects = vi.hoisted(() => ({
  announce: vi.fn(async (..._args: unknown[]) => ({ ok: true as const })),
  tournament: vi.fn(), draft: vi.fn(),
}));
vi.mock("@/lib/notify", () => ({
  announcer: { announce: effects.announce },
  broadcaster: { tournament: effects.tournament, draft: effects.draft },
}));
vi.mock("@/lib/notify-duel", () => ({ notifyDuelChange: vi.fn(async () => { }) }));
beforeEach(() => vi.clearAllMocks());

it("reads canonical Discord identity even when the player compatibility value is stale", async () => {
  state.db!.prepare("update players set discord_user_id = '800000000000000001' where id = 1").run();
  const { playerIdentity } = await import("../src/lib/player-lookup");
  expect(playerIdentity(state.db!, 1)).toEqual({ id: 1, userId: 101, discordUserId: state.discordId, displayName: "Host" });
  state.db!.prepare("update users set discord_user_id = null where id = 101").run();
  expect(playerIdentity(state.db!, 1)?.discordUserId).toBeNull();
});

it("announces the owner's canonical Discord ID and refuses an unlinked organizer", async () => {
  state.db!.exec(`insert into tournaments(id,guild_id,name,format,status,created_by_user_id,web_slug)
    values(5,'g','Cup','round_robin','pending',101,'cup');`);
  const { POST } = await import("../app/api/tournaments/[slug]/announce/route");
  const ctx = { params: Promise.resolve({ slug: "cup" }) };
  expect((await POST(new Request("http://localhost/api/tournaments/cup/announce", { method: "POST" }), ctx)).status).toBe(200);
  expect(effects.announce).toHaveBeenCalledWith(expect.objectContaining({ organizerUserId: "900000000000000101" }));
  state.db!.prepare("update users set discord_user_id = null where id = 101").run();
  effects.announce.mockClear();
  const response = await POST(new Request("http://localhost/api/tournaments/cup/announce", { method: "POST" }), ctx);
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "Organizer has no linked Discord account" });
  expect(effects.announce).not.toHaveBeenCalled();
});

it.each(["reporter", "opponent", "neither"])("saves and broadcasts a report when %s is unlinked", async (unlinked) => {
  state.db!.exec(`insert into players(id,guild_id,user_id,discord_user_id,display_name)
    values(2,'g',102,'900000000000000102','Other');
    insert into tournaments(id,guild_id,name,format,status,created_by_user_id,web_slug)
    values(5,'g','Cup','round_robin','active',101,'cup');
    insert into tournament_matches(id,tournament_id,round_number,player_one_id,player_two_id,status)
    values(7,5,1,1,2,'open');`);
  if (unlinked !== "neither") {
    state.db!.prepare("update users set discord_user_id = null where id = ?").run(unlinked === "reporter" ? 101 : 102);
  }
  state.db!.exec("update players set discord_user_id = case id when 1 then '800000000000000001' else '800000000000000002' end");
  const { POST } = await import("../app/api/tournaments/[slug]/report/route");
  const response = await POST(new Request("http://localhost/api/tournaments/cup/report", {
    method: "POST", body: JSON.stringify({ tournamentMatchId: 7, result: "win" }),
  }), { params: Promise.resolve({ slug: "cup" }) });
  expect(response.status).toBe(200);
  expect(state.db!.prepare("select reporter_id, player_two_id from matches").get()).toEqual({ reporter_id: 1, player_two_id: 2 });
  expect(effects.tournament).toHaveBeenCalledWith({ kind: "match-updated", slug: "cup" });
  if (unlinked === "neither") {
    expect(effects.announce).toHaveBeenCalledWith(expect.objectContaining({
      reporterDiscordId: "900000000000000101", opponentDiscordId: "900000000000000102",
    }));
  } else {
    expect(effects.announce).not.toHaveBeenCalled();
  }
});

it("keeps saved deck ownership on users.id when player IDs differ", async () => {
  const { createSavedDeckService } = await import("@yugidraft/shared/services");
  const deck = createSavedDeckService(state.db!).create("g", 101, {
    name: "Host deck", mode: "normal", deck: { main: [], extra: [], side: [] },
  });
  const { DELETE } = await import("../app/api/decks/[id]/route");
  const ctx = { params: Promise.resolve({ id: String(deck.id) }) };
  state.userId = "102"; state.discordId = "900000000000000102";
  expect((await DELETE(new Request("http://localhost/api/decks/1", { method: "DELETE" }), ctx)).status).toBe(404);
  expect(state.db!.prepare("select owner_user_id from saved_decks where id = ?").get(deck.id)).toEqual({ owner_user_id: 101 });
  state.db!.exec(`insert into players(id,guild_id,user_id,discord_user_id,display_name)
    values(2,'g',102,'900000000000000102','Other');
    insert into tournaments(id,guild_id,name,format,status,created_by_user_id,web_slug)
    values(5,'g','Cup','round_robin','pending',101,'cup');
    insert into tournament_participants(tournament_id,player_id) values(5,1),(5,2);`);
  const { PUT } = await import("../app/api/tournaments/[slug]/deck/route");
  expect((await PUT(new Request("http://localhost/api/tournaments/cup/deck", {
    method: "PUT", body: JSON.stringify({ savedDeckId: deck.id }),
  }) as never, { params: Promise.resolve({ slug: "cup" }) })).status).toBe(404);
  expect(state.db!.prepare("select deck_json from tournament_participants order by player_id").all())
    .toEqual([{ deck_json: null }, { deck_json: null }]);
  state.userId = "101"; state.discordId = "900000000000000101";
  expect((await DELETE(new Request("http://localhost/api/decks/1", { method: "DELETE" }), ctx)).status).toBe(200);
});

it("creates and broadcasts a challenge without sending a stale Discord recipient", async () => {
  state.db!.exec(`insert into players(id,guild_id,user_id,discord_user_id,display_name)
    values(2,'g',102,'900000000000000102','Other');
    update users set discord_user_id = null where id = 102;`);
  const { POST } = await import("../app/api/duels/route");
  const { notifyDuelChange } = await import("../src/lib/notify-duel");
  const response = await POST(new Request("http://localhost/api/duels", {
    method: "POST", body: JSON.stringify({ mode: "normal", opponentPlayerId: 2 }),
  }) as never);
  expect(response.status).toBe(201);
  const body = await response.json();
  expect(body).not.toHaveProperty("notified");
  expect(body.shareUrl).toBe(`https://web.example/duels/${body.session.slug}`);
  expect(state.db!.prepare("select count(*) as n from duel_series").get()).toEqual({ n: 1 });
  expect(notifyDuelChange).toHaveBeenCalledWith(body.session.slug, "g");
  expect(effects.announce).not.toHaveBeenCalled();
});
