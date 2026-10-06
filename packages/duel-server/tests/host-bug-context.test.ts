import { seedIdentity, seedUser } from "./helpers/identity.js";
import { createHmac } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, expect, it } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { createDuelService } from "@yugidraft/shared/services";
import type { DuelEngineView, DuelFormat } from "@yugidraft/shared/duels";
import { createDuelHost, type DuelHost } from "../src/host.js";
import { buildPracticeBotDeck } from "../src/practice-bot.js";
import type { DuelGameWorker } from "../src/worker-client.js";
import { engineDataDirectory as DATA } from "./engine-data-dir.js";

const SECRET = "bug-context-test";
const hosts: DuelHost[] = [];
const databases: Database.Database[] = [];
afterEach(async () => { for (const host of hosts.splice(0)) await host.close(); for (const db of databases.splice(0)) db.close(); });

const PUBLIC_LINES = Array.from({ length: 20 }, (_, index) => `Public line ${index + 1}`);

async function table(format: DuelFormat = "ffa3") {
  const db = new Database(":memory:"); databases.push(db); migrate(db);
  const count = format === "ffa4" || format === "tag" ? 4 : format === "1v1" ? 2 : 3;
  const players = Array.from({ length: count }, (_, seat) =>
    seedIdentity(db, { guildId: "g", name: `P${seat}`, userId: seedUser(db, `u${seat}`).userId, discordUserId: seedUser(db, `u${seat}`).discordUserId ?? `u${seat}` }).playerId);
  const duels = createDuelService(db);
  const session = duels.create({ guildId: "g", organizerPlayerId: players[0]!, name: "bug", mode: "normal", format });
  for (const player of players.slice(1)) duels.takeSeat(session.slug, "g", player);
  const deck = buildPracticeBotDeck("normal", DATA);
  for (const player of players) duels.setDeck(session.slug, "g", player, deck);
  let running = true;
  let hang = false;
  const reads: Array<number | null> = [];
  // A seat view holds its own private lines; the spectator view (null) holds only the public ones. The fake keeps the
  // same split the engine makes: a log entry with audience "all" or the viewer's seat.
  const view = (seat: number | null): DuelEngineView => ({
    revision: 1, format, turn: 4, turnSeat: 1, phase: "main1",
    seats: players.map((_, index) => ({ seat: index, lp: 8000, eliminated: index === 2, hand: [], deckCount: 35, extraCount: 0, extra: [], monsters: [], spells: [], graveyard: [], banished: [] })),
    prompt: null, chain: [], events: [],
    log: [
      ...PUBLIC_LINES.map((text, index) => ({ id: index + 1, text })),
      ...(seat === null ? [] : [{ id: 99, text: `You drew Secret Card (seat ${seat})` }]),
    ],
    result: null,
  });
  const worker: DuelGameWorker = {
    get running() { return running; },
    async create() {},
    async view(seat) { reads.push(seat); if (hang) await new Promise(() => {}); return view(seat); },
    async answer() {}, async search() { return []; }, async close() { running = false; },
  };
  const host = createDuelHost({ db, secret: SECRET, dataDirectory: DATA, searchCards: () => [], pollIntervalMs: 60_000, debugReadTimeoutMs: 50, createWorker: () => worker });
  hosts.push(host);
  const actor = { slug: session.slug, guildId: "g", playerId: players[0] };
  async function post(body: Record<string, unknown>) {
    const raw = JSON.stringify({ ...actor, ...body });
    const response = await host.handle(new Request("http://localhost/internal/duel", { method: "POST", headers: { "x-announce-signature": "sha256=" + createHmac("sha256", SECRET).update(raw).digest("hex"), "content-type": "application/json" }, body: raw }));
    return { status: response.status, data: await response.json() };
  }
  expect((await post({ op: "start" })).status).toBe(200);
  reads.length = 0;
  return { db, duels, session, players, post, reads, hang: () => { hang = true; } };
}

it("answers the public facts and only the newest spectator-view log lines", async () => {
  const t = await table("ffa3");
  const result = await t.post({ op: "bug-context" });
  expect(result.status, JSON.stringify(result.data)).toBe(200);
  expect(result.data).toEqual({
    format: "ffa3", mode: "normal", seat: 0, turn: 4, phase: "main1", turnSeat: 1, livingPlayers: 2,
    log: PUBLIC_LINES.slice(-15),
  });
  // Only the spectator view is read: a seat view (with its private lines) is never asked for.
  expect(t.reads).toEqual([null]);
  expect(JSON.stringify(result.data)).not.toContain("Secret Card");
});

it("answers without a log when the core does not answer, and never waits on the duel queue", async () => {
  const t = await table("1v1");
  t.hang();
  const result = await t.post({ op: "bug-context" });
  expect(result.status).toBe(200);
  expect(result.data).toEqual({ format: "1v1", mode: "normal", seat: 0, turn: null, phase: null, turnSeat: null, livingPlayers: null, log: [] });
});

it("refuses a player who may not see the duel", async () => {
  const t = await table("1v1");
  const outsider = seedIdentity(t.db, { guildId: "other", name: "X", userId: seedUser(t.db, "x").userId, discordUserId: seedUser(t.db, "x").discordUserId ?? "x" }).playerId;
  expect((await t.post({ op: "bug-context", playerId: outsider })).status).toBeGreaterThanOrEqual(400);
});

it("reads a finished duel from its saved public view", async () => {
  const t = await table("ffa3");
  const saved = { revision: 2, format: "ffa3", turn: 9, turnSeat: 0, phase: "end", seats: [0, 1, 2].map(seat => ({ seat, lp: 0, hand: [], deckCount: 0, extraCount: 0, extra: [], monsters: [], spells: [], graveyard: [], banished: [] })), prompt: null, chain: [], events: [], log: [{ id: 1, text: "Saved public line" }], result: { winnerSeat: 1, reason: "x" } };
  t.duels.complete(t.session.slug, "g", 1, "x", { public: saved as unknown as DuelEngineView, seats: [saved, saved, saved] as unknown as DuelEngineView[] });
  const result = await t.post({ op: "bug-context" });
  expect(result.data).toMatchObject({ turn: 9, phase: "end", log: ["Saved public line"], livingPlayers: 3 });
});
