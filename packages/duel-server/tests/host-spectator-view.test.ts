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
const SECRET = "spectator-test";
const hosts: DuelHost[] = [];
const databases: Database.Database[] = [];
afterEach(async () => { for (const host of hosts.splice(0)) await host.close(); for (const db of databases.splice(0)) db.close(); });

async function table(format: DuelFormat = "ffa3", eliminated = true) {
  const db = new Database(":memory:"); databases.push(db); migrate(db);
  const players = Array.from({ length: format === "ffa4" ? 4 : format === "1v1" ? 2 : 3 }, (_, seat) =>
    Number(db.prepare("insert into players (guild_id, discord_user_id, display_name) values ('g', ?, ?)").run(`u${seat}`, `P${seat}`).lastInsertRowid));
  const duels = createDuelService(db);
  const session = duels.create({ guildId: "g", organizerPlayerId: players[0]!, name: "watch", mode: "normal", format });
  for (const player of players.slice(1)) duels.takeSeat(session.slug, "g", player);
  const deck = buildPracticeBotDeck("normal", DATA);
  for (const player of players) duels.setDeck(session.slug, "g", player, deck);
  let running = true;
  let pending = false;
  const reads: Array<number | null> = [];
  const view = (seat: number | null): DuelEngineView => ({ revision: 1, format, turn: 2, turnSeat: 1, phase: "main1",
    seats: players.map((_, index) => ({ seat: index, lp: 8000, eliminated: index === 0 && eliminated,
      pendingElimination: index === 0 && pending, hand: index === 0 && eliminated ? [] : [{ controller: index, location: 2, sequence: 0, position: 8, ...(seat === index ? { code: 123, name: "Private hand" } : {}) }], deckCount: 35, extraCount: 0, extra: [], monsters: [], spells: [], graveyard: [], banished: [] })),
    prompt: seat === 1 ? { id: "p", seat: 1, kind: "choice", title: "Main", options: [{ id: "to_ep", label: "End" }], context: { type: "action", phase: "main" } } : null,
    chain: [], events: [], log: [], result: null, eliminationOrder: eliminated ? [[0]] : [],
  });
  const worker: DuelGameWorker = { get running() { return running; }, async create() {}, async view(seat) { reads.push(seat); return view(seat); }, async answer() {}, async search() { return []; }, async close() { running = false; } };
  const host = createDuelHost({ db, secret: SECRET, dataDirectory: DATA, searchCards: () => [], pollIntervalMs: 60_000, createWorker: () => worker }); hosts.push(host);
  const actor = { slug: session.slug, guildId: "g", playerId: players[0] };
  async function post(body: Record<string, unknown>) {
    const raw = JSON.stringify({ ...actor, ...body });
    const response = await host.handle(new Request("http://localhost/internal/duel", { method: "POST", headers: { "x-announce-signature": "sha256=" + createHmac("sha256", SECRET).update(raw).digest("hex"), "content-type": "application/json" }, body: raw }));
    return { status: response.status, data: await response.json() };
  }
  expect((await post({ op: "start" })).status).toBe(200);
  return { duels, session, post, reads, view, pending: () => { pending = true; } };
}

it.each(["ffa3", "ffa4"] as const)("projects an eliminated %s player through the public worker view and preserves seats", async format => {
  const t = await table(format);
  const result = await t.post({ op: "view", spectate: true });
  expect(result.status, JSON.stringify(result.data)).toBe(200);
  expect(result.data).toMatchObject({ role: "spectator", mySeat: null, myDeck: null, mySide: null, engine: { prompt: null } });
  expect(t.reads.at(-1)).toBeNull();
  expect(result.data.engine.seats.flatMap((seat: { hand: Array<{ code?: number }> }) => seat.hand).every((card: { code?: number }) => card.code === undefined)).toBe(true);
  expect(t.duels.get(t.session.slug, "g").seats.map(seat => seat.playerId)).toEqual(result.data.session.seats.map((seat: { playerId: number }) => seat.playerId));
});

it("rejects a living or merely Leaving player's spectator switch", async () => {
  const t = await table("ffa3", false);
  expect((await t.post({ op: "view", spectate: true })).status).toBe(409);
  t.pending();
  expect((await t.post({ op: "view", spectate: true })).status).toBe(409);
});

it("restores the saved public final view instead of a private seat snapshot", async () => {
  const t = await table();
  const publicView = { ...t.view(null), prioritySeat: null, result: { winnerSeat: 2, reason: "Surrender" }, eliminationOrder: [[0], [1]] };
  t.duels.complete(t.session.slug, "g", 2, "Surrender", { public: publicView, seats: [t.view(0), t.view(1), t.view(2)] });
  const result = await t.post({ op: "view", spectate: true });
  expect(result.status, JSON.stringify(result.data)).toBe(200);
  expect(result.data.engine).toEqual(publicView);
  expect(result.data).toMatchObject({ role: "spectator", mySeat: null, myDeck: null });
});

it("keeps a 1v1 player in its existing role", async () => {
  const t = await table("1v1");
  expect((await t.post({ op: "view", spectate: true })).status).toBe(409);
  expect((await t.post({ op: "view" })).data).toMatchObject({ role: "player", mySeat: 0 });
});
