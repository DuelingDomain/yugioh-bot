import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { MULTIPLAYER_TABLES_OFF_MESSAGE, type DuelFormat, type DuelMode } from "@yugidraft/shared/duels";
import { createDuelService, type DuelService } from "@yugidraft/shared/services";

const { actor, notify } = vi.hoisted(() => ({ actor: vi.fn(), notify: vi.fn() }));
vi.mock("@/lib/duel-host", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/duel-host")>(),
  requireDuelActor: actor,
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/notify-duel", () => ({ notifyDuelChange: notify }));

import { POST } from "../app/api/duels/[slug]/seat/route";

let db: Database.Database;
let duels: DuelService;
let organizerPlayerId: number;
let playerId: number;
let joinSpy: MockInstance<DuelService["takeSeat"]>;

function lobby(format?: DuelFormat, mode: DuelMode = "normal") {
  return duels.create({ guildId: "g1", organizerPlayerId, name: "T", mode, format });
}

function join(slug: string) {
  return POST(new Request(`http://localhost/api/duels/${slug}/seat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ seat: 1 }) }), {
    params: Promise.resolve({ slug }),
  });
}

beforeEach(() => {
  vi.stubEnv("MULTIPLAYER_TABLES", "0");
  db = new Database(":memory:");
  migrate(db);
  const insert = db.prepare("insert into players (guild_id, discord_user_id, display_name) values ('g1', ?, ?)");
  organizerPlayerId = Number(insert.run("organizer", "Yugi").lastInsertRowid);
  playerId = Number(insert.run("joiner", "Kaiba").lastInsertRowid);
  duels = createDuelService(db);
  joinSpy = vi.spyOn(duels, "takeSeat");
  actor.mockReset().mockResolvedValue({ ok: true, guildId: "g1", playerId, duels });
  notify.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  db.close();
  vi.unstubAllEnvs();
});

describe("POST /api/duels/[slug]/seat with MULTIPLAYER_TABLES", () => {
  it.each([undefined, "", "0", "off", "false"])("refuses multiplayer joins with 403 when the flag is %j", async (flag) => {
    vi.stubEnv("MULTIPLAYER_TABLES", flag);
    for (const mode of ["normal", "domain"] as const) {
      for (const format of ["tag", "ffa3", "ffa4"] as const) {
        const session = lobby(format, mode);
        const response = await join(session.slug);
        expect(response.status).toBe(403);
        expect(await response.json()).toEqual({ error: MULTIPLAYER_TABLES_OFF_MESSAGE });
        expect(duels.get(session.slug, "g1").seats).toHaveLength(1);
      }
    }
    expect(joinSpy).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it.each(["normal", "domain"] as const)("still joins %s 1v1 tables when multiplayer is off", async (mode) => {
    for (const format of [undefined, "1v1"] as const) {
      const session = lobby(format, mode);
      const response = await join(session.slug);
      expect(response.status).toBe(200);
      expect(duels.get(session.slug, "g1").seats.map((seat) => seat.playerId)).toEqual([organizerPlayerId, playerId]);
      expect(notify).toHaveBeenCalledWith(session.slug, "g1");
    }
  });

  it.each(["1", "true", "on"])("joins multiplayer tables when the flag is %j", async (flag) => {
    vi.stubEnv("MULTIPLAYER_TABLES", flag);
    for (const mode of ["normal", "domain"] as const) {
      for (const format of ["tag", "ffa3", "ffa4"] as const) {
        const session = lobby(format, mode);
        const response = await join(session.slug);
        expect(response.status).toBe(200);
        expect(duels.get(session.slug, "g1").seats.map((seat) => seat.playerId)).toEqual([organizerPlayerId, playerId]);
        expect(notify).toHaveBeenCalledWith(session.slug, "g1");
      }
    }
  });

  it("reads the flag on every join request", async () => {
    const open = lobby("ffa3");
    const closed = lobby("ffa4");
    vi.stubEnv("MULTIPLAYER_TABLES", "1");
    expect((await join(open.slug)).status).toBe(200);
    vi.stubEnv("MULTIPLAYER_TABLES", "0");
    expect((await join(closed.slug)).status).toBe(403);
    expect(duels.get(closed.slug, "g1").seats).toHaveLength(1);
    expect(joinSpy).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("returns 404 for an unknown duel", async () => {
    const response = await join("missing");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Duel not found" });
    expect(notify).not.toHaveBeenCalled();
  });

  it("does not look up or join a duel in another guild", async () => {
    const session = lobby("ffa3");
    actor.mockResolvedValue({ ok: true, guildId: "another-guild", playerId, duels });
    expect((await join(session.slug)).status).toBe(404);
    expect(duels.get(session.slug, "g1").seats).toHaveLength(1);
    expect(notify).not.toHaveBeenCalled();
  });

  it("requires authentication before reading the duel", async () => {
    actor.mockResolvedValue({ ok: false, response: Response.json({ error: "Unauthorized" }, { status: 401 }) });
    const get = vi.spyOn(duels, "get");
    expect((await join("missing")).status).toBe(401);
    expect(get).not.toHaveBeenCalled();
    expect(joinSpy).not.toHaveBeenCalled();
  });

  it("keeps a successful join when notification fails", async () => {
    const session = lobby();
    notify.mockRejectedValue(new Error("notification unavailable"));
    expect((await join(session.slug)).status).toBe(200);
    expect(duels.get(session.slug, "g1").seats).toHaveLength(2);
  });
});
