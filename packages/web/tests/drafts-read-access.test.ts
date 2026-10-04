import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "../../shared/src/db/schema";

const { auth, database, environment } = vi.hoisted(() => ({
  auth: vi.fn(), database: { current: null as Database.Database | null },
  environment: { discordGuildId: "guild-1", wsInternalSecret: "room-secret" },
}));
vi.mock("@/lib/auth", () => ({ auth }));
vi.mock("@/lib/db", () => ({ getDb: () => database.current! }));
vi.mock("@/lib/env", () => ({ env: environment }));
// Exercise source modules in this worktree without requiring a shared package build.
vi.mock("@yugidraft/shared/services", () => import("../../shared/src/services/index"));
vi.mock("@yugidraft/shared/ws", () => import("../../shared/src/ws/index"));
vi.mock("@yugidraft/shared/notify", () => import("../../shared/src/notify/index"));
vi.mock("@yugidraft/shared/duels", () => import("../../shared/src/duels/index"));
vi.mock("@/lib/notify", () => ({ announcer: {}, broadcaster: {} }));

const statuses = ["pending", "active", "completed", "cancelled"] as const;
const users = ["player", "creator", "outsider"] as const;
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
    migrate(database.current);
    auth.mockResolvedValue({ user: { id: "player" } });
    environment.wsInternalSecret = "room-secret";
    database.current.prepare("insert into players (id, guild_id, discord_user_id, display_name) values (1, 'guild-1', 'player', 'Yugi')").run();
    // A player in a different guild must not count as this draft's participant.
    database.current.prepare("insert into players (id, guild_id, discord_user_id, display_name) values (2, 'guild-2', 'outsider', 'Kaiba')").run();
    database.current.prepare(`insert into drafts (id, guild_id, channel_id, name, status, created_by_user_id, config_json, web_slug)
      values (1, 'guild-1', 'channel', 'Draft', 'pending', 'creator', '{}', 'test-draft')`).run();
    database.current.prepare("insert into draft_players (draft_id, player_id, seat_index) values (1, 1, 0)").run();
  });

  afterEach(() => {
    database.current?.close();
    database.current = null;
    vi.restoreAllMocks();
  });

  for (const route of routes) {
    describe(route, () => {
      for (const status of statuses) {
        for (const user of users) {
          it(`${status}: ${user}`, async () => {
            database.current!.prepare("update drafts set status = ? where id = 1").run(status);
            auth.mockResolvedValue({ user: { id: user } });
            const response = await read(route);
            if (status !== "pending" && user === "outsider") {
              expect(response.status).toBe(403);
              expect(await response.json()).toEqual({ error: "This draft is only open to its players." });
              return;
            }
            if (route === "export") {
              // Preserve the existing participant and complete-deck requirements.
              expect(response.status).toBe(user === "player" ? 400 : 403);
              expect(await response.json()).toEqual({ error: user === "player" ? "Deck is not complete yet" : "Not a participant" });
            } else if (route === "deck-pool") {
              expect(response.status).toBe(user === "player" ? (status === "completed" ? 200 : 409) : 403);
            } else {
              expect(response.status).toBe(200);
              const body = await response.json();
              if (route === "connection") {
                expect(response.headers.get("cache-control")).toBe("no-store");
                const { verifyDraftRoomToken } = await import("../../shared/src/ws/draft-token");
                expect(verifyDraftRoomToken(body.token, "room-secret", { slug: "test-draft", userId: user }))
                  .toMatchObject({ slug: "test-draft", guildId: "guild-1", userId: user, expiresAt: body.expiresAt });
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

  it("refuses a fresh lobby token once an outsider's draft starts", async () => {
    auth.mockResolvedValue({ user: { id: "outsider" } });
    expect((await read("connection")).status).toBe(200);
    database.current!.prepare("update drafts set status = 'active' where id = 1").run();
    expect((await read("connection")).status).toBe(403);
  });

  it("does not count a participant from another guild", async () => {
    database.current!.prepare("insert into draft_players (draft_id, player_id) values (1, 2)").run();
    database.current!.prepare("update drafts set status = 'active' where id = 1").run();
    auth.mockResolvedValue({ user: { id: "outsider" } });
    for (const route of routes) expect((await read(route)).status).toBe(403);
  });

  it("does not issue a room token without the existing signing secret", async () => {
    environment.wsInternalSecret = "";
    const response = await read("connection");
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "The live feed is unavailable. Try again later." });
  });

  it("names the tournament made from the draft so the finale can link to it", async () => {
    const db = database.current!;
    db.prepare("update drafts set status = 'completed' where id = 1").run();
    expect(await (await read("draft")).json()).toMatchObject({ tournamentId: null, tournamentName: null, tournamentSlug: null });

    db.prepare("insert into tournaments (id, guild_id, name, format, status, created_by_user_id, web_slug) values (7, 'guild-1', 'Draft Cup', 'round_robin', 'pending', 'creator', 'draft-cup')").run();
    db.prepare("update drafts set tournament_id = 7 where id = 1").run();
    expect(await (await read("draft")).json()).toMatchObject({ tournamentId: 7, tournamentName: "Draft Cup", tournamentSlug: "draft-cup" });
  });
});
