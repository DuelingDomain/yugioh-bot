import { createHmac } from "node:crypto";
import { rmSync } from "node:fs";
import Database from "better-sqlite3";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { createDuelSeriesService, createDuelService } from "@yugidraft/shared/services";
import { createDuelHost, type DuelHost } from "../src/host.js";
import { seedIdentity } from "./helpers/identity.js";
import { createHostDataFixture } from "./helpers/host-data-fixture.js";

const SECRET = "owner-history-access-fixture";
const guildId = "owner-history-test";
let db: Database.Database;
let host: DuelHost;
let directory: string;
let slug: string;
let ownerPlayerId: number;
const createWorker = vi.fn(() => { throw new Error("Finished history must not start an engine"); });
const onChange = vi.fn(async () => {});

beforeEach(() => {
  vi.stubEnv("OWNER_USER_IDS", "101");
  vi.stubEnv("DUEL_SCENARIOS", "1");
  createWorker.mockClear(); onChange.mockClear();
  directory = createHostDataFixture([]);
  db = new Database(":memory:"); migrate(db);
  ownerPlayerId = seedIdentity(db, { guildId, userId: "101", name: "Owner fixture" }).playerId;
  const challenger = seedIdentity(db, { guildId, userId: "102", name: "Challenger fixture" });
  const opponent = seedIdentity(db, { guildId, userId: "103", name: "Opponent fixture" });
  const { duel, series } = createDuelSeriesService(db).createChallenge({ guildId,
    challengerPlayerId: challenger.playerId, opponentPlayerId: opponent.playerId, mode: "normal",
    bestOf: 3, ranked: false, settings: { visibility: "private", validateDeck: false } });
  slug = duel.slug;
  db.prepare("update duels set status='completed', ended_at='2026-10-10 12:00:00' where id=?").run(duel.id);
  db.prepare("update duel_series set status='between_games' where id=?").run(series.id);
  host = createDuelHost({ db, dataDirectory: directory, secret: SECRET, searchCards: () => [],
    pollIntervalMs: 60_000, archiveAfterMs: 365 * 24 * 60 * 60 * 1000, createWorker, onChange });
});
afterEach(async () => {
  await host?.close(); db?.close();
  rmSync(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

async function post(op: string, body: Record<string, unknown> = {}) {
  const raw = JSON.stringify({ op, slug, guildId, playerId: ownerPlayerId, ...body });
  return host.handle(new Request("http://localhost/internal/duel", { method: "POST",
    headers: { "content-type": "application/json",
      "x-announce-signature": "sha256=" + createHmac("sha256", SECRET).update(raw).digest("hex") }, body: raw }));
}

it("lets the owner read another player's private finished duel without granting mutation rights", async () => {
  expect(createDuelService(db).room(slug, guildId, ownerPlayerId)).toMatchObject({ role: "spectator", mySeat: null, myDeck: null });
  const view = await post("view");
  expect(view.status).toBe(200);
  onChange.mockClear();
  const before = {
    duels: db.prepare("select * from duels").all(), seats: db.prepare("select * from duel_seats").all(),
    series: db.prepare("select * from duel_series").all(), commands: db.prepare("select * from duel_commands").all(),
    grants: db.prepare("select * from duel_invite_grants").all(),
  };
  for (const [op, body] of [
    ["archive", {}], ["report", { note: "Fixture report" }], ["chain-mode", { mode: "always" }],
    ["series-side", { deck: { main: [], extra: [], side: [] } }], ["series-first", { choice: "first" }],
    ["series-ready", {}], ["series-unready", {}],
    ["respond", { command: { promptId: "fixture-prompt", revision: 1, answer: { choice: "pass" } } }],
    ["surrender", {}], ["cancel", {}],
  ] as const) {
    const response = await post(op, body);
    expect(response.status, op).toBe(403);
    expect(await response.json(), op).toMatchObject({ error: expect.any(String) });
  }
  expect({
    duels: db.prepare("select * from duels").all(), seats: db.prepare("select * from duel_seats").all(),
    series: db.prepare("select * from duel_series").all(), commands: db.prepare("select * from duel_commands").all(),
    grants: db.prepare("select * from duel_invite_grants").all(),
  }).toEqual(before);
  expect(createWorker).not.toHaveBeenCalled(); expect(onChange).not.toHaveBeenCalled();
});
