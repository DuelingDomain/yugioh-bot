import Database from "better-sqlite3";
import type { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { createDuelService } from "@yugidraft/shared/services";
import { fixtureUserId, fixtureDiscordId, seedFixtureUsers } from "./fixtures/identity";

const { requireDuelActor, callDuelHost, notifyDuelChange } = vi.hoisted(() => ({
  requireDuelActor: vi.fn(), callDuelHost: vi.fn(), notifyDuelChange: vi.fn(),
}));
vi.mock("@/lib/session-identity", async () => {
  const { sessionFixture } = await import("./fixtures/session");
  return sessionFixture(vi.fn());
});
vi.mock("@/lib/duel-host", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/duel-host")>()), requireDuelActor, callDuelHost,
}));
vi.mock("@/lib/notify-duel", () => ({ notifyDuelChange }));
import { POST } from "../app/api/duels/route";

let db: Database.Database;
beforeEach(() => {
  vi.stubEnv("MULTIPLAYER_TABLES", "1");
  db = new Database(":memory:");
  migrate(db);
  seedFixtureUsers(db, ["u1"]);
  const playerId = Number(db.prepare(
    "insert into players (guild_id, user_id, discord_user_id, display_name) values ('g1', ?, ?, 'P1')",
  ).run(fixtureUserId("u1"), fixtureDiscordId("u1")).lastInsertRowid);
  requireDuelActor.mockReset().mockResolvedValue({ ok: true, guildId: "g1", playerId, duels: createDuelService(db) });
  callDuelHost.mockReset().mockResolvedValue({ ok: true,
    data: { multiplayerTables: true, multiCoreReady: true, multiDomainCoreReady: true } });
  notifyDuelChange.mockReset().mockResolvedValue(undefined);
});
afterEach(() => { db.close(); vi.unstubAllEnvs(); });

function request(mode: string, format: string, settings: unknown): NextRequest {
  return new Request("http://localhost/api/duels", { method: "POST",
    body: JSON.stringify({ name: "First draw", mode, format, settings }) }) as NextRequest;
}

describe("POST /api/duels first-turn draw setting through the real shared service", () => {
  it.each(["ffa3", "ffa4"].flatMap((format) =>
    [undefined, false, true].map((firstTurnDraw) => ({ format, firstTurnDraw }))))(
    "Domain $format persists $firstTurnDraw (omission defaults on)", async ({ format, firstTurnDraw }) => {
      const response = await POST(request("domain", format, firstTurnDraw === undefined ? undefined : { firstTurnDraw }));
      expect(response.status).toBe(201);
      expect(await response.json()).toMatchObject({ session: { mode: "domain", format,
        settings: { firstTurnDraw: firstTurnDraw ?? true } } });
      const row = db.prepare("select settings_json from duels").get() as { settings_json: string };
      expect(JSON.parse(row.settings_json).firstTurnDraw).toBe(firstTurnDraw ?? true);
    });

  it.each([
    ["domain", "1v1"], ["domain", "tag"],
    ["normal", "1v1"], ["normal", "tag"], ["normal", "ffa3"], ["normal", "ffa4"],
  ])("rejects the setting for %s %s without writing a table", async (mode, format) => {
    const response = await POST(request(mode!, format!, { firstTurnDraw: true }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("only available for Domain ffa3 and ffa4") });
    expect(db.prepare("select count(*) as count from duels").get()).toEqual({ count: 0 });
    expect(notifyDuelChange).not.toHaveBeenCalled();
  });

  it.each(["false", 0, null])("rejects non-boolean %j without writing a table", async (firstTurnDraw) => {
    const response = await POST(request("domain", "ffa3", { firstTurnDraw }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "firstTurnDraw must be a boolean" });
    expect(db.prepare("select count(*) as count from duels").get()).toEqual({ count: 0 });
  });
});
