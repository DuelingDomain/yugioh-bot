import { signedRequestHeaders } from "@yugidraft/shared/internal-auth";
import { rmSync } from "node:fs";
import Database from "better-sqlite3";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { createDuelService } from "@yugidraft/shared/services";
import { defaultDuelSettings, seatCountFor, type DuelEngineView, type DuelFormat } from "@yugidraft/shared/duels";
import type { DuelHost } from "../src/host.js";
import type { DuelGameWorker } from "../src/worker-client.js";
import { createHostDataFixture } from "./helpers/host-data-fixture.js";
import { seedIdentity, seedUser } from "./helpers/identity.js";
import { createTestDuelHost, finishTestDiceOpening } from "./support/test-opening.js";

let dataDirectory: string;
const hosts: DuelHost[] = [];
const databases: Database.Database[] = [];
beforeAll(() => { dataDirectory = createHostDataFixture([{ code: 89631139, name: "Blue-Eyes White Dragon" }]); });
afterAll(() => rmSync(dataDirectory, { recursive: true, force: true }));
afterEach(async () => { for (const host of hosts.splice(0)) await host.close(); for (const db of databases.splice(0)) db.close(); });

it.each(["1v1", "tag", "ffa3", "ffa4"] as DuelFormat[])("binds %s search to the signed actor's announcing seat", async format => {
  const db = new Database(":memory:"); databases.push(db); migrate(db);
  const player = (name: string) => {
    const user = seedUser(db, name);
    return seedIdentity(db, { guildId: "g", userId: user.userId, discordUserId: user.discordUserId!, name }).playerId;
  };
  const players = Array.from({ length: seatCountFor(format) }, (_, seat) => player(`p${seat}`));
  const outsider = player("watcher");
  const service = createDuelService(db);
  const session = service.create({ guildId: "g", organizerPlayerId: players[0], name: "Declare", mode: "normal", format,
    settings: { ...defaultDuelSettings("normal"), validateDeck: false } });
  for (const id of players.slice(1)) service.takeSeat(session.slug, "g", id);
  for (const id of players) service.setDeck(session.slug, "g", id, { main: Array(40).fill(89631139), extra: [], side: [] });
  let running = true;
  const search = vi.fn(async () => []);
  const view = (seat: number | null) => ({ revision: 1, format, turn: 1, turnSeat: 0, phase: "main1",
    seats: players.map((_, index) => ({ seat: index, lp: 8000, hand: [], deckCount: 40, extraCount: 0,
      extra: [], monsters: [], spells: [], graveyard: [], banished: [] })),
    prompt: seat === 1 ? { id: "declare", seat, kind: "announce-card", title: "Declare", options: [] } : null,
    chain: [], events: [], log: [], result: null,
  }) as DuelEngineView;
  const worker: DuelGameWorker = { get running() { return running; }, async create() {}, async view(seat) { return view(seat); },
    async answer() {}, search, async close() { running = false; } };
  const host = createTestDuelHost({ db, dataDirectory, secret: "declare-test", searchCards: () => [],
    pollIntervalMs: 60_000, createWorker: () => worker }); hosts.push(host);
  async function post(body: Record<string, unknown>, as = players[0]): Promise<{ status: number; data: unknown }> {
    const raw = JSON.stringify({ guildId: "g", slug: session.slug, playerId: as, ...body });
    const response = await host.handle(new Request("http://local/internal/duel", { method: "POST", body: raw,
      headers: { ...signedRequestHeaders({ url: "http://local/internal/duel", method: "POST", body: raw, secret: "declare-test", purpose: "duel-host" }) } }));
    return finishTestDiceOpening(host, { slug: session.slug, ...body }, { status: response.status, data: await response.json() }, next => post(next, as));
  }
  expect((await post({ op: "start" })).status).toBe(200);
  expect((await post({ op: "cards", query: "", seat: 0 }, players[1])).status).toBe(200);
  expect(search).toHaveBeenCalledExactlyOnceWith("", 1);
  expect((await post({ op: "cards", query: "blue", seat: 1 }, players[0])).status).toBe(409);
  expect((await post({ op: "cards", query: "", seat: 1 }, outsider)).status).toBe(403);
  expect(search).toHaveBeenCalledTimes(1);
});
