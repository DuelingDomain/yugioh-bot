import Database from "better-sqlite3";
import { NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { createDuelSeriesService, createDuelService } from "@yugidraft/shared/services";

const { requireDuelActor, getDb } = vi.hoisted(() => ({ requireDuelActor: vi.fn(), getDb: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb }));
vi.mock("@/lib/duel-host", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/duel-host")>()),
  requireDuelActor,
}));

let db: Database.Database;
let p1: number;
let p2: number;
let p3: number;

function actor(playerId: number) {
  requireDuelActor.mockResolvedValue({ ok: true, guildId: "g", playerId, duels: createDuelService(db) });
}

beforeEach(() => {
  db = new Database(":memory:");
  migrate(db);
  const insert = db.prepare("insert into players (guild_id, discord_user_id, display_name) values ('g', ?, ?)");
  p1 = Number(insert.run("u1", "Yugi").lastInsertRowid);
  p2 = Number(insert.run("u2", "Kaiba").lastInsertRowid);
  p3 = Number(insert.run("u3", "Joey").lastInsertRowid);
  getDb.mockReturnValue(db);
  requireDuelActor.mockReset();
});
afterEach(() => db.close());

describe("GET /api/live", () => {
  it("returns the auth failure from the actor check", async () => {
    requireDuelActor.mockResolvedValue({ ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) });
    const { GET } = await import("../app/api/live/route");
    const response = await GET();
    expect(response.status).toBe(401);
  });

  it("is empty for a player with no duels", async () => {
    actor(p3);
    const { GET } = await import("../app/api/live/route");
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ yourDuel: null, liveCount: 0 });
  });

  it("reports the viewer's duel and the live count", async () => {
    const { duel } = createDuelSeriesService(db).createChallenge({
      guildId: "g", challengerPlayerId: p1, opponentPlayerId: p2, bestOf: 3, ranked: false, mode: "normal",
    });
    const { GET } = await import("../app/api/live/route");
    actor(p2);
    expect(await (await GET()).json()).toEqual({
      yourDuel: { href: `/duels/${duel.slug}`, opponent: "Yugi", state: "waiting" },
      liveCount: 0,
    });
    const deck = { main: Array.from({ length: 40 }, (_, i) => i + 1), extra: [], side: [] };
    const duels = createDuelService(db);
    duels.setDeck(duel.slug, "g", p1, deck);
    duels.setDeck(duel.slug, "g", p2, deck);
    duels.activate(duel.slug, "g", null, ["s"], "v", null);
    // A private challenge is not something a bystander can see.
    actor(p3);
    expect(await (await GET()).json()).toEqual({ yourDuel: null, liveCount: 0 });
    actor(p1);
    const mine = await (await GET()).json();
    expect(mine).toEqual({ yourDuel: { href: `/duels/${duel.slug}`, opponent: "Kaiba", state: "live" }, liveCount: 1 });
  });
});
