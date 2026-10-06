import { seedIdentity, seedUser } from "../../shared/tests/helpers/identity.js";
import { createHmac } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, expect, it, vi } from "vitest";
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
  const players = Array.from({ length: format === "ffa4" || format === "tag" ? 4 : format === "1v1" ? 2 : 3 }, (_, seat) =>
    seedIdentity(db, { guildId: "g", name: `P${seat}`, userId: seedUser(db, `u${seat}`).userId, discordUserId: seedUser(db, `u${seat}`).discordUserId ?? `u${seat}` }).playerId);
  const duels = createDuelService(db);
  const session = duels.create({ guildId: "g", organizerPlayerId: players[0]!, name: "watch", mode: "normal", format });
  for (const player of players.slice(1)) duels.takeSeat(session.slug, "g", player);
  const deck = buildPracticeBotDeck("normal", DATA);
  for (const player of players) duels.setDeck(session.slug, "g", player, deck);
  let running = true;
  let pending = false;
  const reads: Array<number | null> = [];
  let blockedView: { started: () => void; wait: Promise<void> } | null = null;
  const view = (seat: number | null): DuelEngineView => ({ revision: 1, format, turn: 2, turnSeat: 1, phase: "main1",
    seats: players.map((_, index) => ({ seat: index, lp: 8000, eliminated: index === 0 && eliminated,
      pendingElimination: index === 0 && pending, hand: index === 0 && eliminated ? [] : [{ controller: index, location: 2, sequence: 0, position: 8, ...(seat === index ? { code: 123, name: "Private hand" } : {}) }], deckCount: 35, extraCount: 0, extra: [], monsters: [], spells: [], graveyard: [], banished: [] })),
    prompt: seat === 1 ? { id: "p", seat: 1, kind: "choice", title: "Main", options: [{ id: "to_ep", label: "End" }], context: { type: "action", phase: "main" } } : null,
    chain: [], events: [], log: [], result: null, eliminationOrder: eliminated ? [[0]] : [],
  });
  const worker: DuelGameWorker = { get running() { return running; }, async create() {}, async view(seat) { reads.push(seat); if (blockedView) { blockedView.started(); await blockedView.wait; } return view(seat); }, async answer() {}, async search() { return []; }, async close() { running = false; } };
  let nextWorker = worker;
  const host = createDuelHost({ db, secret: SECRET, dataDirectory: DATA, searchCards: () => [], pollIntervalMs: 60_000, createWorker: () => nextWorker }); hosts.push(host);
  const actor = { slug: session.slug, guildId: "g", playerId: players[0] };
  async function post(body: Record<string, unknown>) {
    const raw = JSON.stringify({ ...actor, ...body });
    const response = await host.handle(new Request("http://localhost/internal/duel", { method: "POST", headers: { "x-announce-signature": "sha256=" + createHmac("sha256", SECRET).update(raw).digest("hex"), "content-type": "application/json" }, body: raw }));
    return { status: response.status, data: await response.json() };
  }
  expect((await post({ op: "start" })).status).toBe(200);
  function holdView() {
    let release!: () => void;
    let started!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; });
    blockedView = { started, wait: new Promise<void>(resolve => { release = resolve; }) };
    return { entered, release };
  }
  function replaceWorker() {
    running = false;
    let replacementRunning = true;
    nextWorker = { ...worker, get running() { return replacementRunning; },
      async view(seat) { reads.push(seat); return { ...view(seat), revision: 2 }; },
      async close() { replacementRunning = false; } };
  }
  return { db, duels, session, post, reads, view, holdView, replaceWorker, pending: () => { pending = true; } };
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

function finish(t: Awaited<ReturnType<typeof table>>, status: "completed" | "interrupted" = "completed") {
  const publicView = { ...t.view(null), prioritySeat: null, result: { winnerSeat: 2, reason: "Surrender" }, eliminationOrder: [[0], [1]] };
  const seats = [t.view(0), t.view(1), t.view(2)].map(seat => ({ ...seat, result: publicView.result }));
  if (status === "interrupted") t.duels.interrupt(t.session.slug, "g", "Host restarted", { public: { ...publicView, result: null }, seats: seats.map(seat => ({ ...seat, result: null })) });
  else t.duels.complete(t.session.slug, "g", 2, "Surrender", { public: publicView, seats });
  return { publicView, seats };
}

it("restores the saved public final view for an unseated watcher instead of a private seat snapshot", async () => {
  const t = await table();
  const { publicView } = finish(t);
  const watcher = seedIdentity(t.db, { guildId: "g", name: "Watcher", userId: seedUser(t.db, "watcher").userId, discordUserId: seedUser(t.db, "watcher").discordUserId ?? "watcher" }).playerId;
  const result = await t.post({ op: "view", spectate: true, playerId: watcher });
  expect(result.status, JSON.stringify(result.data)).toBe(200);
  expect(result.data.engine).toEqual(publicView);
  expect(result.data).toMatchObject({ role: "spectator", mySeat: null, myDeck: null });
});

it("shows a seated actor their own result when spectate=1 reads a finished duel", async () => {
  const t = await table();
  const { seats } = finish(t);
  const result = await t.post({ op: "view", spectate: true });
  expect(result.status, JSON.stringify(result.data)).toBe(200);
  expect(result.data).toMatchObject({ role: "player", mySeat: 0, session: { status: "completed" } });
  expect(result.data.engine).toMatchObject({ ...seats[0], prioritySeat: null });
  expect(result.data.engine.result).toEqual({ winnerSeat: 2, reason: "Surrender" });
});

it("keeps a 1v1 player in its existing role", async () => {
  const t = await table("1v1");
  expect((await t.post({ op: "view", spectate: true })).status).toBe(409);
  expect((await t.post({ op: "view" })).data).toMatchObject({ role: "player", mySeat: 0 });
});

it("shows a seated actor their own seat when spectate=1 reads an interrupted duel", async () => {
  const t = await table();
  const { seats } = finish(t, "interrupted");
  const result = await t.post({ op: "view", spectate: true });
  expect(result.status, JSON.stringify(result.data)).toBe(200);
  expect(result.data).toMatchObject({ role: "player", mySeat: 0, session: { status: "interrupted" } });
  // The host stamps the interruption onto the stored seat view as a result without a winner.
  expect(result.data.engine).toMatchObject({ ...seats[0], result: { winnerSeat: null, reason: "Host restarted" }, prioritySeat: null });
});

it.each(["tag", "1v1"] as const)("shows a seated %s player their own seat view when spectate=1 reads a finished duel", async format => {
  const t = await table(format);
  const publicView = { ...t.view(null), prioritySeat: null, result: { winnerSeat: 1, reason: "Surrender" } };
  const seats = (format === "tag" ? [0, 1, 2, 3] : [0, 1]).map(seat => ({ ...t.view(seat), result: publicView.result }));
  t.duels.complete(t.session.slug, "g", 1, "Surrender", { public: publicView, seats });
  const result = await t.post({ op: "view", spectate: true });
  expect(result.status, JSON.stringify(result.data)).toBe(200);
  expect(result.data).toMatchObject({ role: "player", mySeat: 0, session: { status: "completed" } });
  expect(result.data.engine).toMatchObject({ ...seats[0], prioritySeat: null });
});


it.each(["completed", "interrupted"] as const)("does not retain %s views after the worker is disposed", async status => {
  const writes = vi.spyOn(Map.prototype, "set");
  let t: Awaited<ReturnType<typeof table>>;
  let cached: Map<string, Map<number, DuelEngineView>>;
  try {
    t = await table();
    const index = writes.mock.calls.findIndex(([key, value]) => key === t.session.slug && value instanceof Map);
    expect(index).toBeGreaterThanOrEqual(0);
    cached = writes.mock.contexts[index] as Map<string, Map<number, DuelEngineView>>;
  } finally {
    writes.mockRestore();
  }
  expect(cached!.get(t!.session.slug)?.has(0)).toBe(true);
  finish(t!, status);
  // Archive disposes the worker and clears all cached views of this duel.
  expect((await t!.post({ op: "archive" })).status).toBe(200);
  expect(cached!.has(t!.session.slug)).toBe(false);
  for (const spectate of [false, true]) {
    const result = await t!.post({ op: "view", spectate });
    expect(result.status).toBe(200);
    expect(result.data).toMatchObject({ role: "player", mySeat: 0, session: { status } });
    expect(result.data.engine).not.toBeNull();
    expect(cached!.has(t!.session.slug)).toBe(false);
  }
});

it("does not retain a public view that returns after disposal", async () => {
  const writes = vi.spyOn(Map.prototype, "set");
  let t: Awaited<ReturnType<typeof table>>;
  let cached: Map<string, Map<number, DuelEngineView>>;
  try {
    t = await table();
    const index = writes.mock.calls.findIndex(([key, value]) => key === t.session.slug && value instanceof Map);
    expect(index).toBeGreaterThanOrEqual(0);
    cached = writes.mock.contexts[index] as Map<string, Map<number, DuelEngineView>>;
  } finally {
    writes.mockRestore();
  }
  const held = t!.holdView();
  const pending = t!.post({ op: "bug-context" });
  try {
    await held.entered;
    finish(t!);
    expect((await t!.post({ op: "archive" })).status).toBe(200);
    expect(cached!.has(t!.session.slug)).toBe(false);
  } finally {
    held.release();
  }
  expect((await pending).status).toBe(200);
  expect(cached!.has(t!.session.slug)).toBe(false);
});

it("does not cache an old worker's delayed view after recovery installs a replacement", async () => {
  const writes = vi.spyOn(Map.prototype, "set");
  let t: Awaited<ReturnType<typeof table>>;
  let cached: Map<string, Map<number, DuelEngineView>>;
  try {
    t = await table();
    const index = writes.mock.calls.findIndex(([key, value]) => key === t.session.slug && value instanceof Map);
    expect(index).toBeGreaterThanOrEqual(0);
    cached = writes.mock.contexts[index] as Map<string, Map<number, DuelEngineView>>;
  } finally {
    writes.mockRestore();
  }
  const held = t!.holdView();
  const pending = t!.post({ op: "bug-context" });
  try {
    await held.entered;
    t!.replaceWorker();
    const recovered = await t!.post({ op: "view" });
    expect(recovered.status).toBe(200);
    expect(recovered.data.engine.revision).toBe(2);
    expect(cached!.get(t!.session.slug)?.get(0)?.revision).toBe(2);
    expect(cached!.get(t!.session.slug)?.has(-1)).toBe(false);
  } finally {
    held.release();
  }
  expect((await pending).status).toBe(200);
  expect(cached!.get(t!.session.slug)?.has(-1)).toBe(false);
});
