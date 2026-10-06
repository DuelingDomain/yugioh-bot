import { fixtureUserId, fixtureDiscordId, seedFixtureUsers } from "./fixtures/identity";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eloStakes } from "@yugidraft/shared/scoring";
import { pickStakesMatch, type StakesMatch } from "@/lib/tournament-stakes";

const auth = vi.fn();
const tempDirs: string[] = [];
vi.mock("@/lib/auth", () => ({ auth }));
vi.mock("@/lib/notify", () => ({
  broadcaster: { draft: vi.fn(), tournament: vi.fn() },
  announcer: { announce: vi.fn() },
}));

const m = (id: number, one: number, two: number | null, status = "open", reporterId: number | null = null): StakesMatch => ({
  id, playerOneId: one, playerTwoId: two, status, reporterId,
});

describe("pickStakesMatch", () => {
  it("takes the viewer's first open match in round order", () => {
    expect(pickStakesMatch([m(1, 2, 3), m(2, 1, 4), m(3, 5, 1)], 1)?.id).toBe(2);
  });

  it("skips byes and finished matches", () => {
    expect(pickStakesMatch([m(1, 1, null), m(2, 1, 2, "completed"), m(3, 3, 1)], 1)?.id).toBe(3);
    expect(pickStakesMatch([m(1, 1, null), m(2, 1, 2, "completed")], 1)).toBeNull();
  });

  it("prefers a report the opponent made over one the viewer made", () => {
    expect(pickStakesMatch([m(1, 1, 2, "pending_approval", 1), m(2, 3, 1, "pending_approval", 3)], 1)?.id).toBe(2);
  });

  it("falls back to a report the viewer is waiting on", () => {
    expect(pickStakesMatch([m(1, 1, 2, "pending_approval", 1)], 1)?.id).toBe(1);
  });

  it("is null for someone with no matches", () => {
    expect(pickStakesMatch([m(1, 2, 3)], 1)).toBeNull();
  });
});

describe("GET /api/tournaments/[slug] stakes", () => {
  const SLUG = "stk";
  beforeEach(() => {
    vi.resetModules();
    auth.mockReset();
  });
  afterEach(() => {
    delete process.env.DATABASE_PATH;
    delete process.env.DISCORD_GUILD_ID;
    while (tempDirs.length) rmSync(tempDirs.pop()!, { recursive: true, force: true });
  });

  async function seed(status = "active") {
    const dir = mkdtempSync(join(tmpdir(), "yugioh-stakes-"));
    tempDirs.push(dir);
    process.env.DATABASE_PATH = join(dir, "test.sqlite");
    process.env.DISCORD_GUILD_ID = "guild-1";
    const Database = (await import("better-sqlite3")).default;
    const { migrate } = await import("@yugidraft/shared/db");
    const db = new Database(process.env.DATABASE_PATH);
    migrate(db);
    seedFixtureUsers(db, FIXTURE_KEYS);
    const player = (user: string) =>
      Number(db.prepare("insert into players (guild_id, user_id, discord_user_id, display_name) values ('guild-1', ?, ?, ?)").run(fixtureUserId(user), fixtureDiscordId(user), user).lastInsertRowid);
    const me = player("me");
    const rival = player("rival");
    const bystander = player("bystander");
    db.prepare("insert into player_ratings (guild_id, player_id, elo) values ('guild-1', ?, 1100)").run(me);
    db.prepare("insert into player_ratings (guild_id, player_id, elo) values ('guild-1', ?, 1300)").run(rival);
    const tournamentId = Number(
      db.prepare(`insert into tournaments (guild_id, name, format, status, created_by_user_id, web_slug) values ('guild-1', 'Cup', 'round_robin', ?, ${fixtureUserId("host")}, ?)`)
        .run(status, SLUG).lastInsertRowid,
    );
    for (const id of [me, rival, bystander]) db.prepare("insert into tournament_participants (tournament_id, player_id) values (?, ?)").run(tournamentId, id);
    const slot = Number(
      db.prepare("insert into tournament_matches (tournament_id, player_one_id, player_two_id, round_number, status) values (?, ?, ?, 1, 'open')")
        .run(tournamentId, me, rival).lastInsertRowid,
    );
    db.close();
    return { slot, rival };
  }

  async function get() {
    const { GET } = await import("../app/api/tournaments/[slug]/route");
    const res = await GET(new Request(`http://localhost/api/tournaments/${SLUG}`) as never, { params: Promise.resolve({ slug: SLUG }) });
    return res.json();
  }

  it("gives a player the exact Elo for their next match", async () => {
    const { slot, rival } = await seed();
    auth.mockResolvedValue({ user: { id: String(fixtureUserId("me")), discordUserId: fixtureDiscordId("me"), name: "me" } });
    const json = await get();
    expect(json.stakes).toEqual({ tournamentMatchId: slot, opponentId: rival, ...eloStakes(1100, 1300) });
    expect(json.stakes.win).toBeGreaterThan(16);
    expect(json.stakes.loss).toBeLessThan(0);
  });

  it("is null for a participant who has no match to play", async () => {
    await seed();
    auth.mockResolvedValue({ user: { id: String(fixtureUserId("bystander")), discordUserId: fixtureDiscordId("bystander"), name: "bystander" } });
    expect((await get()).stakes).toBeNull();
  });

  it("is null for a tournament that is not running and rejects a signed-out viewer", async () => {
    await seed("completed");
    auth.mockResolvedValue({ user: { id: String(fixtureUserId("me")), discordUserId: fixtureDiscordId("me"), name: "me" } });
    expect((await get()).stakes).toBeNull();
    auth.mockResolvedValue(null);
    const { GET } = await import("../app/api/tournaments/[slug]/route");
    const response = await GET(new Request(`http://localhost/api/tournaments/${SLUG}`) as never, { params: Promise.resolve({ slug: SLUG }) });
    expect(response.status).toBe(401);
  });
});

const FIXTURE_KEYS = ["host", "me", "rival", "bystander"] as const;

// Membership is a dependency of these routes; authorization still runs through the real web boundary.
vi.mock("@/lib/discord-guild-membership", () => ({ verifyDiscordGuildMembership: vi.fn(async () => ({ ok: true })) }));
