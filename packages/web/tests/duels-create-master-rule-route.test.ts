import { fixtureUserId, fixtureDiscordId, seedFixtureUsers } from "./fixtures/identity";
import Database from "better-sqlite3";
import type { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { createDuelService } from "@yugidraft/shared/services";

const { requireDuelActor, callDuelHost, notifyDuelChange } = vi.hoisted(() => ({
  requireDuelActor: vi.fn(),
  callDuelHost: vi.fn(),
  notifyDuelChange: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/duel-host", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/duel-host")>()),
  requireDuelActor,
  callDuelHost,
}));
vi.mock("@/lib/notify-duel", () => ({ notifyDuelChange }));

import { POST } from "../app/api/duels/route";

let db: Database.Database;

beforeEach(() => {
  vi.stubEnv("MULTIPLAYER_TABLES", "1");
  db = new Database(":memory:");
  migrate(db);
  seedFixtureUsers(db, FIXTURE_KEYS);
  const playerId = Number(db.prepare(
    `insert into players (guild_id, user_id, discord_user_id, display_name) values ('g1', ${fixtureUserId("u1")}, '${fixtureDiscordId("u1")}', 'P1')`,
  ).run().lastInsertRowid);
  requireDuelActor.mockReset().mockResolvedValue({ ok: true, guildId: "g1", playerId, duels: createDuelService(db) });
  callDuelHost.mockReset().mockResolvedValue({
    ok: true, data: { multiplayerTables: true, multiCoreReady: true, multiDomainCoreReady: true },
  });
  notifyDuelChange.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  db.close();
  vi.unstubAllEnvs();
});

function request(body: unknown): NextRequest {
  return new Request("http://localhost/api/duels", { method: "POST", body: JSON.stringify(body) }) as NextRequest;
}

const multiTables = ["normal", "domain"].flatMap((mode) =>
  ["tag", "ffa3", "ffa4"].map((format) => ({ mode, format })),
);

describe("POST /api/duels Master Rule validation through the shared service", () => {
  it.each(multiTables.flatMap((table) => [1, 2, 3, 4].map((masterRule) => ({ ...table, masterRule }))))(
    "rejects $mode $format MR$masterRule with 400 before storing a duel",
    async ({ mode, format, masterRule }) => {
      const response = await POST(request({ name: "Table", mode, format, masterRule }));

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "Tag and free-for-all duels use Master Rule 5" });
      expect(db.prepare("select count(*) as count from duels").get()).toEqual({ count: 0 });
      expect(db.prepare("select count(*) as count from duel_seats").get()).toEqual({ count: 0 });
      expect(notifyDuelChange).not.toHaveBeenCalled();
    },
  );

  it.each(multiTables.flatMap((table) => [undefined, 5].map((masterRule) => ({ ...table, masterRule }))))(
    "creates $mode $format with MR$masterRule as MR5",
    async ({ mode, format, masterRule }) => {
      const response = await POST(request({ name: "Table", mode, format, masterRule }));

      expect(response.status).toBe(201);
      expect(await response.json()).toMatchObject({ session: { mode, format, masterRule: 5 } });
      expect(db.prepare("select master_rule from duels").get()).toEqual({ master_rule: 5 });
    },
  );

  it.each(["normal", "domain"].flatMap((mode) =>
    [undefined, "1v1"].flatMap((format) =>
      [1, 2, 3, 4, 5].map((masterRule) => ({ mode, format, masterRule })),
    ),
  ))("preserves MR$masterRule for $mode 1v1 with format $format", async ({ mode, format, masterRule }) => {
    const response = await POST(request({ name: "Table", mode, format, masterRule }));

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ session: { mode, format: "1v1", masterRule } });
    expect(callDuelHost).not.toHaveBeenCalled();
  });
});

const FIXTURE_KEYS = ["u1"] as const;

// Membership is a dependency of these routes; authorization still runs through the real web boundary.
vi.mock("@/lib/discord-guild-membership", () => ({ verifyDiscordGuildMembership: vi.fn(async () => ({ ok: true })) }));
