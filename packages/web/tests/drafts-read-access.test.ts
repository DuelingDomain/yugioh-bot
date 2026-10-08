import { fixtureUserId, fixtureDiscordId, seedFixtureUsers } from "./fixtures/identity";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "../../shared/src/db/schema";

const { auth, database, environment } = vi.hoisted(() => ({
  auth: vi.fn(), database: { current: null as Database.Database | null },
  environment: { discordGuildId: "guild-1", wsInternalSecret: "room-secret" },
}));
vi.mock("@/lib/session-identity", async () => {
  const { sessionFixture } = await import("./fixtures/session");
  return sessionFixture(auth);
});
vi.mock("@/lib/db", () => ({ getDb: () => database.current! }));
vi.mock("@/lib/env", () => ({ env: environment }));
// Exercise source modules in this worktree without requiring a shared package build.
vi.mock("@yugidraft/shared/services", () => import("../../shared/src/services/index"));
vi.mock("@yugidraft/shared/ws", () => import("../../shared/src/ws/index"));
vi.mock("@yugidraft/shared/notify", () => import("../../shared/src/notify/index"));
vi.mock("@yugidraft/shared/duels", () => import("../../shared/src/duels/index"));
vi.mock("@/lib/notify", () => ({ announcer: {}, broadcaster: {} }));

const statuses = ["pending", "active", "completed", "cancelled"] as const;
const users = ["player", "creator", "grant", "outsider"] as const;
const routes = ["draft", "pool", "preflight", "export", "deck-pool", "connection"] as const;
type Route = typeof routes[number];

async function read(route: Route, slug = "test-draft") {
  const modules = {
    draft: () => import("../app/api/drafts/[slug]/route"),
    pool: () => import("../app/api/drafts/[slug]/pool/route"),
    preflight: () => import("../app/api/drafts/[slug]/preflight/route"),
    export: () => import("../app/api/drafts/[slug]/export/route"),
    "deck-pool": () => import("../app/api/drafts/[slug]/deck-pool/route"),
    connection: () => import("../app/api/drafts/[slug]/connection/route"),
  };
  const { GET } = await modules[route]();
  return GET(new Request(`http://localhost/api/drafts/${slug}`), { params: Promise.resolve({ slug }) });
}

describe("draft read access", () => {
  beforeEach(() => {
    database.current = new Database(":memory:");
    migrate(database.current); seedFixtureUsers(database.current, FIXTURE_KEYS);
    auth.mockResolvedValue({ user: { id: String(fixtureUserId("player")), discordUserId: fixtureDiscordId("player") } });
    environment.wsInternalSecret = "room-secret";
    database.current.prepare(`insert into players (id, guild_id, user_id, discord_user_id, display_name) values (1, 'guild-1', ${fixtureUserId("player")}, '${fixtureDiscordId("player")}', 'Yugi')`).run();
    // A player in a different guild must not count as this draft's participant.
    database.current.prepare(`insert into players (id, guild_id, user_id, discord_user_id, display_name) values (2, 'guild-2', ${fixtureUserId("outsider")}, '${fixtureDiscordId("outsider")}', 'Kaiba')`).run();
    database.current.prepare(`insert into drafts (id, guild_id, channel_id, name, status, created_by_user_id, config_json, web_slug) values (1, 'guild-1', 'channel', 'Draft', 'pending', ${fixtureUserId("creator")}, '{}', 'test-draft')`).run();
    database.current.prepare("insert into draft_players (draft_id, player_id, seat_index) values (1, 1, 0)").run();
    database.current.prepare("insert into draft_invite_grants (draft_id,user_id) values (1,?)").run(fixtureUserId("grant"));
  });

  afterEach(() => {
    database.current?.close();
    database.current = null;
    vi.restoreAllMocks();
  });

  for (const visibility of ["open", "private"] as const) {
  for (const route of routes) {
    describe(`${visibility} ${route}`, () => {
      for (const status of statuses) {
        for (const user of users) {
          it(`${status}: ${user}`, async () => {
            database.current!.prepare("update drafts set status = ?, visibility = ? where id = 1").run(status, visibility);
            auth.mockResolvedValue({ user: { id: String(fixtureUserId(user)), discordUserId: fixtureDiscordId(user) } });
            const response = await read(route);
            if (user === "outsider" && (visibility === "private" || status !== "pending")) {
              expect(response.status).toBe(404);
              expect(await response.json()).toEqual({ error: "Draft not found" });
              return;
            }
            if (route === "export") {
              if (user === "player" && status === "completed") {
                expect(response.status).toBe(200);
                expect(response.headers.get("content-type")).toBe("text/plain");
                expect(await response.text()).toBe("#main\n#extra\n\n!side\n");
                return;
              }
              // Other exports require both a participant and the configured pick total.
              expect(response.status).toBe(user === "player" ? 400 : 403);
              expect(await response.json()).toEqual({ error: user === "player" ? "Deck is not complete yet" : "Not a participant" });
            } else if (route === "deck-pool") {
              expect(response.status).toBe(user === "player" ? (status === "completed" ? 200 : 409) : 403);
            } else {
              expect(response.status).toBe(200);
              const body = await response.json();
              if (route === "connection") {
                expect(Number.isSafeInteger(body.userId)).toBe(true);
                expect(response.headers.get("cache-control")).toBe("no-store");
                const { verifyDraftRoomToken } = await import("../../shared/src/ws/draft-token");
                expect(verifyDraftRoomToken(body.token, "room-secret", { slug: "test-draft", userId: fixtureUserId(user) }))
                  .toMatchObject({ slug: "test-draft", guildId: "guild-1", userId: fixtureUserId(user), expiresAt: body.expiresAt });
                expect(body.expiresAt).toBeGreaterThan(Date.now());
                expect(body.expiresAt).toBeLessThanOrEqual(Date.now() + 60_000);
              }
            }
          });
        }
      }

      it("requires a session", async () => {
        auth.mockResolvedValue(null);
        expect((await read(route)).status).toBe(401);
      });

      it("does not expose drafts from other guilds", async () => {
        database.current!.prepare("update drafts set guild_id = 'guild-2' where id = 1").run();
        expect((await read(route)).status).toBe(404);
      });

      it("returns 404 for an unknown slug", async () => {
        expect((await read(route, "missing")).status).toBe(404);
      });
    });
  }

  }

  it("refuses a fresh lobby token once an outsider's draft starts", async () => {
    auth.mockResolvedValue({ user: { id: String(fixtureUserId("outsider")), discordUserId: fixtureDiscordId("outsider") } });
    database.current!.prepare("update drafts set visibility = 'open'").run();
    expect((await read("connection")).status).toBe(200);
    database.current!.prepare("update drafts set status = 'active' where id = 1").run();
    expect((await read("connection")).status).toBe(404);
  });

  it("does not count a participant from another guild", async () => {
    database.current!.prepare("insert into draft_players (draft_id, player_id) values (1, 2)").run();
    database.current!.prepare("update drafts set status = 'active' where id = 1").run();
    auth.mockResolvedValue({ user: { id: String(fixtureUserId("outsider")), discordUserId: fixtureDiscordId("outsider") } });
    for (const route of routes) expect((await read(route)).status).toBe(404);
  });

  it("does not issue a room token without the existing signing secret", async () => {
    environment.wsInternalSecret = "";
    const response = await read("connection");
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "The live feed is unavailable. Try again later." });
  });

  it("hides a private linked tournament from a draft grant holder who never joined it", async () => {
    database.current!.prepare(`insert into tournaments(id,guild_id,name,format,status,created_by_user_id,web_slug) values(7,'guild-1','Hidden Cup','round_robin','pending',${fixtureUserId("creator")},'hidden-cup')`).run();
    database.current!.exec("update drafts set status='completed',tournament_id=7 where id=1");
    auth.mockResolvedValue({user:{id:String(fixtureUserId("grant")),discordUserId:fixtureDiscordId("grant")}});
    expect(await (await read("draft")).json()).toMatchObject({tournamentId:null,tournamentName:null,tournamentSlug:null});
  });

  it("names the tournament made from the draft so the finale can link to it", async () => {
    const db = database.current!;
    db.prepare("update drafts set status = 'completed' where id = 1").run();
    expect(await (await read("draft")).json()).toMatchObject({ tournamentId: null, tournamentName: null, tournamentSlug: null });

    db.prepare(`insert into tournaments (id, guild_id, name, format, status, created_by_user_id, web_slug) values (7, 'guild-1', 'Draft Cup', 'round_robin', 'pending', ${fixtureUserId("creator")}, 'draft-cup')`).run();
    db.prepare("update drafts set tournament_id = 7 where id = 1").run();
    db.prepare("insert into tournament_participants(tournament_id,player_id) values(7,1)").run();
    expect(await (await read("draft")).json()).toMatchObject({ tournamentId: 7, tournamentName: "Draft Cup", tournamentSlug: "draft-cup" });
  });

  it("does not expose the name or slug of a linked tournament from another guild", async () => {
    const db = database.current!;
    db.prepare(`insert into tournaments (id, guild_id, name, format, status, created_by_user_id, web_slug) values (7, 'guild-2', 'Other Guild Cup', 'round_robin', 'pending', ${fixtureUserId("outsider")}, 'other-guild-cup')`).run();
    db.prepare("update drafts set status = 'completed', tournament_id = 7 where id = 1").run();

    const response = await read("draft");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      tournamentId: null, tournamentName: null, tournamentSlug: null, canCreateTournament: false,
    });
  });

  it("lets an email-only participant read the draft", async () => {
    auth.mockResolvedValue({ user: { id: String(fixtureUserId("player")), discordUserId: null, name: "Participant" } });
    const response = await read("draft");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: 1 });
  });

  describe("canCreateTournament", () => {
    beforeEach(() => {
      database.current!.prepare("update drafts set status = 'completed' where id = 1").run();
    });

    it("is true for the email-only creator", async () => {
      auth.mockResolvedValue({ user: { id: String(fixtureUserId("creator")), discordUserId: null } });
      const response = await read("draft");
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ canCreateTournament: true });
    });

    it("is false for a former admin who did not create the draft", async () => {
      const response = await read("draft");
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ canCreateTournament: false });
    });

    it.each([403, 503])("keeps participant draft reads available after guild permissions change (%s)", async (status) => {
      const response = await read("draft");
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ canCreateTournament: false });
    });

    it("keeps participant reads available without a Discord service", async () => {
      const response = await read("draft");
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ canCreateTournament: false });
    });

    for (const user of ["creator", "player"]) {
      it.each(["pending", "active", "cancelled"])(`is false for ${user} on a %s draft with creator-only access`, async (status) => {
        database.current!.prepare("update drafts set status = ? where id = 1").run(status);
        auth.mockResolvedValue({ user: { id: String(fixtureUserId(user)), discordUserId: fixtureDiscordId(user) } });
        const response = await read("draft");
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ canCreateTournament: false });
      });

      it(`is false for ${user} when a tournament exists with creator-only access`, async () => {
        const db = database.current!;
        db.prepare(`insert into tournaments (id, guild_id, name, format, status, created_by_user_id, web_slug) values (7, 'guild-1', 'Draft Cup', 'round_robin', 'pending', ${fixtureUserId("creator")}, 'draft-cup')`).run();
        db.prepare("update drafts set tournament_id = 7 where id = 1").run();
        auth.mockResolvedValue({ user: { id: String(fixtureUserId(user)), discordUserId: fixtureDiscordId(user) } });
        const response = await read("draft");
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ canCreateTournament: false });
      });
    }
  });
});

const FIXTURE_KEYS = ["player", "outsider", "creator", "admin", "grant"] as const;
