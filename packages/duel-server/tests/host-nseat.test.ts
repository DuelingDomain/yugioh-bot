import { createHash, createHmac } from "node:crypto";
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "@yugidraft/shared/db";
import type { DuelAnswer, DuelCardInfo, DuelDeck, DuelEngineView, DuelFormat, DuelPrompt } from "@yugidraft/shared/duels";
import { seatCountFor } from "@yugidraft/shared/duels";
import { createDuelService } from "@yugidraft/shared/services";
import { createDuelHost, type DuelHost } from "../src/host.js";
import { buildPracticeBotDeck } from "../src/practice-bot.js";
import { multiCoreAvailable } from "../src/presets/index.js";
import type { DuelGameWorker, GameOptions } from "../src/worker-client.js";
import { engineDataDirectory as DATA } from "./engine-data-dir.js";

const SECRET = "nseat-secret";

/** N-seat fake engine. One prompt is open at a time; answering passes it to the next seat in order. */
class NSeatWorker implements DuelGameWorker {
  revision = 1;
  promptSeat = 0;
  created: GameOptions | null = null;
  answers: Array<{ seat: number; answer: DuelAnswer }> = [];
  eliminated = new Set<number>();
  result: DuelEngineView["result"] = null;
  format: DuelFormat = "1v1";
  /** A stuck core: no call returns. */
  hang = false;
  /** A stuck answer call: the duel queue blocks until `unhang()`. */
  hangAnswer = false;
  private hung: Array<() => void> = [];
  unhang() {
    this.hangAnswer = false;
    this.hang = false;
    for (const release of this.hung.splice(0)) release();
  }
  private stopped = false;
  get running() { return !this.stopped; }
  async create(options: GameOptions) {
    this.created = options;
    this.format = options.format ?? "1v1";
  }
  private view0(viewer: number | null): DuelEngineView {
    const count = seatCountFor(this.format);
    const prompt: DuelPrompt | null =
      !this.result && viewer === this.promptSeat
        ? {
            id: `p${this.revision}`,
            seat: this.promptSeat,
            kind: "choice",
            title: "Main",
            options: [{ id: "summon:1", label: "Summon" }, { id: "to_bp", label: "Battle" }, { id: "to_ep", label: "End" }],
            context: { type: "action", phase: "main" },
          }
        : null;
    return {
      revision: this.revision,
      format: this.format,
      turn: 1,
      turnSeat: this.promptSeat,
      phase: "main1",
      seats: Array.from({ length: count }, (_, seat) => ({
        seat, lp: 8000, hand: [], deckCount: 35, extraCount: 0, extra: [], monsters: [], spells: [], graveyard: [], banished: [],
        team: this.format === "tag" ? seat % 2 : seat,
        eliminated: this.eliminated.has(seat),
      })),
      prompt,
      chain: [],
      events: [{ id: this.revision, kind: "phase", text: "x" }],
      log: [],
      result: this.result,
    };
  }
  async view(seat: number | null) {
    if (this.hang) {
      await new Promise<void>((resolve) => this.hung.push(resolve));
    }
    return this.view0(seat);
  }
  async answer(seat: number, _promptId: string, answer: DuelAnswer) {
    if (this.hangAnswer) await new Promise<void>((resolve) => this.hung.push(resolve));
    if (seat !== this.promptSeat) throw new Error(`seat ${seat} has no prompt`);
    this.answers.push({ seat, answer });
    this.revision += 1;
    const count = seatCountFor(this.format);
    let next = (seat + 1) % count;
    while (this.eliminated.has(next)) next = (next + 1) % count;
    this.promptSeat = next;
  }
  async search(_query: string): Promise<DuelCardInfo[]> { return []; }
  async diagnostics() { return [{ turn: 1, phase: "main1", kind: "response", seat: 0, detail: "fake" }]; }
  debugState() {
    return { busy: this.hang, lastOp: "answer", lastOpAt: 1234, wasmSha: "f".repeat(64), wasmFile: "ocgcore.fake.wasm", callsSinceLastPrompt: 3, messagesSinceLastPrompt: 7 };
  }
  async close() { this.stopped = true; }
}

/** A fake core that can remove a duelist (Debug.EliminateDuelist). `missing` makes it throw the way an old core does. */
class EliminatingWorker extends NSeatWorker {
  missing = false;
  calls: Array<{ seat: number; reason: number }> = [];
  async eliminate(seat: number, reason: number) {
    if (this.missing) throw new Error("This duel core has no Debug.EliminateDuelist");
    const count = seatCountFor(this.format);
    this.calls.push({ seat, reason });
    this.eliminated.add(seat);
    this.revision += 1;
    const living = Array.from({ length: count }, (_, index) => index).filter((index) => !this.eliminated.has(index));
    if (living.length === 1) this.result = { winnerSeat: living[0]!, reason: "Surrendered" };
    else if (seat === this.promptSeat) {
      let next = (seat + 1) % count;
      while (this.eliminated.has(next)) next = (next + 1) % count;
      this.promptSeat = next;
    }
  }
}

const hosts: DuelHost[] = [];
afterEach(async () => {
  while (hosts.length > 0) await hosts.pop()!.close();
});

async function post(host: DuelHost, body: Record<string, unknown>) {
  const raw = JSON.stringify(body);
  const signature = "sha256=" + createHmac("sha256", SECRET).update(raw).digest("hex");
  const response = await host.handle(new Request("http://localhost/internal/duel", {
    method: "POST",
    headers: { "content-type": "application/json", "x-announce-signature": signature },
    body: raw,
  }));
  return { status: response.status, data: (await response.json()) as Record<string, any> };
}

function rotated(deck: DuelDeck, by: number): DuelDeck {
  return { ...deck, main: [...deck.main.slice(by), ...deck.main.slice(0, by)] };
}

/** Human players in seats 0..humans-1 (seat order = join order); `bots` optional seats get a practice bot. */
async function table(format: DuelFormat, humans: number, botSeats: number[], clockNow?: { t: number }, worker: NSeatWorker = new NSeatWorker()) {
  const db = new Database(":memory:");
  migrate(db);
  const players: number[] = [];
  for (let index = 0; index < humans; index += 1) {
    players.push(Number(db.prepare("insert into players (guild_id, discord_user_id, display_name) values (?, ?, ?)").run("g1", `u${index}`, `P${index}`).lastInsertRowid));
  }
  const duels = createDuelService(db);
  const session = duels.create({ guildId: "g1", organizerPlayerId: players[0]!, name: "Duel", mode: "normal", format });
  const host = createDuelHost({
    db,
    dataDirectory: DATA,
    secret: SECRET,
    searchCards: () => [],
    pollIntervalMs: 60_000,
    createWorker: () => worker,
    now: clockNow ? () => clockNow.t : undefined,
  });
  hosts.push(host);
  const organizer = { slug: session.slug, guildId: "g1", playerId: players[0]! };
  // Bots sit down before the other humans join, so the humans take the seats that are left.
  for (const seat of botSeats) {
    expect((await post(host, { op: "add-bot", ...organizer, seat })).status).toBe(200);
  }
  for (const player of players.slice(1)) duels.join(session.slug, "g1", player);
  const base = buildPracticeBotDeck("normal", DATA);
  players.forEach((player, index) => duels.setDeck(session.slug, "g1", player, rotated(base, index + 1)));
  const respond = (playerId: number, answer: DuelAnswer = { choice: "to_ep" }) =>
    post(host, {
      op: "respond", slug: session.slug, guildId: "g1", playerId,
      command: { promptId: `p${worker.revision}`, revision: worker.revision, answer },
    });
  return { db, duels, host, worker, players, organizer, slug: session.slug, respond };
}

describe("host with more than two seats", () => {
  it("starts a 4-seat table with one deck per seat in seat order and the format", async () => {
    const t = await table("ffa4", 1, [1, 2, 3]);
    const started = await post(t.host, { op: "start", ...t.organizer });
    expect(started.status).toBe(200);
    expect(t.worker.created?.format).toBe("ffa4");
    expect(t.worker.created?.decks).toHaveLength(4);
    const state = t.duels.privateState(t.slug, "g1");
    expect(t.worker.created?.decks).toEqual(state.decks);
    // Bots all use the same deck; the human deck is rotated, so seat 0 differs from seat 1.
    expect(state.decks[0]).not.toEqual(state.decks[1]);
    expect(state.decks[1]).toEqual(state.decks[2]);
    expect(state.clock?.remainingMs).toHaveLength(4);
    expect(state.clock?.activeSeat).toBe(0);
  });

  it("does not start 1v1 tables with a format option", async () => {
    const t = await table("1v1", 1, [1]);
    expect((await post(t.host, { op: "start", ...t.organizer })).status).toBe(200);
    expect(t.worker.created).not.toHaveProperty("format");
  });

  it("refuses to start a 3-seat table that has an empty seat", async () => {
    const t = await table("ffa3", 1, [1]);
    const started = await post(t.host, { op: "start", ...t.organizer });
    expect(started.status).toBe(409);
    expect(started.data.error).toMatch(/3 players/);
  });

  it("lets three bots answer only their own seat's prompts, then waits for the human", async () => {
    const t = await table("ffa4", 1, [1, 2, 3]);
    await post(t.host, { op: "start", ...t.organizer });
    const result = await t.respond(t.players[0]!);
    expect(result.status).toBe(200);
    expect(t.worker.answers.map((entry) => entry.seat)).toEqual([0, 1, 2, 3]);
    expect(t.worker.promptSeat).toBe(0);
    // Journal holds every seat's move, so a recover can replay it.
    expect(t.duels.privateState(t.slug, "g1").commands.map((entry) => entry.seat)).toEqual([0, 1, 2, 3]);
  });

  it("can put the Tag partner of the human on a bot", async () => {
    const t = await table("tag", 1, [2, 1, 3]);
    await post(t.host, { op: "start", ...t.organizer });
    const session = t.duels.get(t.slug, "g1");
    expect(session.format).toBe("tag");
    expect(session.seats.map((seat) => [seat.seat, seat.isBot])).toEqual([[0, false], [1, true], [2, true], [3, true]]);
    expect((await t.respond(t.players[0]!)).status).toBe(200);
    expect(t.worker.answers.map((entry) => entry.seat)).toEqual([0, 1, 2, 3]);
  });

  it("recovers by replaying the journal with the same format and decks", async () => {
    const t = await table("ffa3", 1, [1, 2]);
    await post(t.host, { op: "start", ...t.organizer });
    await t.respond(t.players[0]!);
    const first = t.worker.created;
    // A fresh host with a fresh worker plays the journal back.
    const worker2 = new NSeatWorker();
    const host2 = createDuelHost({
      db: t.db, dataDirectory: DATA, secret: SECRET, searchCards: () => [], pollIntervalMs: 60_000, createWorker: () => worker2,
    });
    hosts.push(host2);
    const viewed = await post(host2, { op: "view", ...t.organizer });
    expect(viewed.status).toBe(200);
    expect(worker2.created?.format).toBe("ffa3");
    expect(worker2.created?.decks).toEqual(first?.decks);
    expect(worker2.answers.map((entry) => entry.seat)).toEqual([0, 1, 2]);
    expect(worker2.revision).toBe(t.worker.revision);
  });

  it("moves the clock to the seat that holds the prompt and stops an eliminated seat", async () => {
    const t = await table("ffa3", 3, []);
    await post(t.host, { op: "start", ...t.organizer });
    expect(t.duels.privateState(t.slug, "g1").clock?.activeSeat).toBe(0);
    await t.respond(t.players[0]!);
    expect(t.duels.privateState(t.slug, "g1").clock?.activeSeat).toBe(1);
    // The core eliminates seat 2: it never gets the prompt, and the clock skips it.
    t.worker.eliminated.add(2);
    await t.respond(t.players[1]!);
    const clock = t.duels.privateState(t.slug, "g1").clock!;
    expect(t.worker.promptSeat).toBe(0);
    expect(clock.activeSeat).toBe(0);
    expect(clock.remainingMs).toHaveLength(3);
  });

  it("FFA surrender removes only that seat; its prompts are passed on autopilot; the last seat wins", async () => {
    const t = await table("ffa3", 3, []);
    await post(t.host, { op: "start", ...t.organizer });
    // Seat 0 holds the prompt and surrenders.
    const surrendered = await post(t.host, { op: "surrender", slug: t.slug, guildId: "g1", playerId: t.players[0] });
    expect(surrendered.status).toBe(200);
    expect(t.duels.get(t.slug, "g1").status).toBe("active");
    expect(t.duels.privateState(t.slug, "g1").setup?.surrenderedSeats).toEqual([0]);
    // Seat 0's prompt was answered with a pass, and seat 1 now holds the prompt.
    expect(t.worker.answers).toEqual([{ seat: 0, answer: { choice: "to_ep" } }]);
    expect(t.worker.promptSeat).toBe(1);
    const clock = t.duels.privateState(t.slug, "g1").clock!;
    expect(clock.activeSeat).toBe(1);
    // A surrendered seat cannot answer any more.
    const late = await post(t.host, {
      op: "respond", slug: t.slug, guildId: "g1", playerId: t.players[0],
      command: { promptId: "p2", revision: 2, answer: { choice: "to_ep" } },
    });
    expect(late.status).toBe(409);
    // The room shows the seat as out.
    const room = (await post(t.host, { op: "view", slug: t.slug, guildId: "g1", playerId: t.players[1] })).data;
    expect(room.engine.seats.find((seat: any) => seat.seat === 0).eliminated).toBe(true);
    // Seat 1 surrenders too: seat 2 is the last one and wins.
    const second = await post(t.host, { op: "surrender", slug: t.slug, guildId: "g1", playerId: t.players[1] });
    expect(second.status).toBe(200);
    const done = t.duels.get(t.slug, "g1");
    expect(done.status).toBe("completed");
    expect(done.winnerSeat).toBe(2);
    expect(done.winnerPlayerId).toBe(t.players[2]);
    expect(done.resultReason).toBe("Surrender");
    // Every seat has a saved final board.
    const finalRoom = (await post(t.host, { op: "view", slug: t.slug, guildId: "g1", playerId: t.players[2] })).data;
    expect(finalRoom.engine.result.winnerSeat).toBe(2);
  });

  it("a surrendered seat stays on autopilot after a restart", async () => {
    const t = await table("ffa3", 3, []);
    await post(t.host, { op: "start", ...t.organizer });
    await post(t.host, { op: "surrender", slug: t.slug, guildId: "g1", playerId: t.players[0] });
    await t.respond(t.players[1]!);
    await t.respond(t.players[2]!);
    // Seat 0 comes up again and is passed automatically during the respond above.
    expect(t.worker.answers.map((entry) => entry.seat)).toEqual([0, 1, 2, 0]);
    const worker2 = new NSeatWorker();
    const host2 = createDuelHost({
      db: t.db, dataDirectory: DATA, secret: SECRET, searchCards: () => [], pollIntervalMs: 60_000, createWorker: () => worker2,
    });
    hosts.push(host2);
    await post(host2, { op: "view", slug: t.slug, guildId: "g1", playerId: t.players[1] });
    expect(worker2.answers.map((entry) => entry.seat)).toEqual([0, 1, 2, 0]);
    expect(worker2.promptSeat).toBe(1);
  });

  it("Tag surrender ends the duel for the whole team and names both the team and the lowest winning seat", async () => {
    const t = await table("tag", 4, []);
    await post(t.host, { op: "start", ...t.organizer });
    const surrendered = await post(t.host, { op: "surrender", slug: t.slug, guildId: "g1", playerId: t.players[2] });
    expect(surrendered.status).toBe(200);
    const done = t.duels.get(t.slug, "g1");
    expect(done.status).toBe("completed");
    // Seat 2 is on team 0; team 1 (seats 1 and 3) wins, lowest seat is 1.
    expect(done.winnerSeat).toBe(1);
    const finalRoom = (await post(t.host, { op: "view", slug: t.slug, guildId: "g1", playerId: t.players[3] })).data;
    expect(finalRoom.engine.result).toMatchObject({ winnerSeat: 1, winnerTeam: 1, reason: "Surrender" });
  });

  it("Tag winner_player_id is the human partner when the lowest winning seat is a bot", async () => {
    // Human seats 0 and 3; bots in seats 1 and 2. Seat 0 surrenders: team 1 (seats 1 and 3) wins.
    const t = await table("tag", 2, [1, 2]);
    expect(t.duels.get(t.slug, "g1").seats.map((seat) => seat.isBot)).toEqual([false, true, true, false]);
    await post(t.host, { op: "start", ...t.organizer });
    expect((await post(t.host, { op: "surrender", slug: t.slug, guildId: "g1", playerId: t.players[0] })).status).toBe(200);
    const done = t.duels.get(t.slug, "g1");
    expect(done.winnerSeat).toBe(1);
    expect(done.winnerPlayerId).toBe(t.players[1]);
  });

  it("a time-limit loss in FFA eliminates the seat instead of ending the duel", async () => {
    const clock = { t: 1_000 };
    const t = await table("ffa3", 3, [], clock);
    await post(t.host, { op: "start", ...t.organizer });
    clock.t += 10 * 60 * 1000;
    const viewed = await post(t.host, { op: "view", slug: t.slug, guildId: "g1", playerId: t.players[1] });
    expect(viewed.status).toBe(200);
    const session = t.duels.get(t.slug, "g1");
    expect(session.status).toBe("active");
    expect(t.duels.privateState(t.slug, "g1").setup?.surrenderedSeats).toEqual([0]);
    expect(t.worker.promptSeat).toBe(1);
  });
});

describe("host eliminates through the core", () => {
  it("FFA surrender calls eliminate with the surrender code, journals it and keeps the duel going", async () => {
    const worker = new EliminatingWorker();
    const t = await table("ffa3", 3, [], undefined, worker);
    await post(t.host, { op: "start", ...t.organizer });
    const surrendered = await post(t.host, { op: "surrender", slug: t.slug, guildId: "g1", playerId: t.players[0] });
    expect(surrendered.status).toBe(200);
    expect(worker.calls).toEqual([{ seat: 0, reason: 0 }]);
    // No autopilot pass happened and no surrendered seat is saved: the core removed the seat.
    expect(worker.answers).toEqual([]);
    const state = t.duels.privateState(t.slug, "g1");
    expect(state.setup?.surrenderedSeats).toBeUndefined();
    expect(state.commands.map((entry) => [entry.seat, entry.command.promptId, entry.command.revision])).toEqual([[0, "eliminate:0", 1]]);
    expect(state.clock?.activeSeat).toBe(1);
    expect(t.duels.get(t.slug, "g1").status).toBe("active");
  });

  it("the last duelist standing wins, with the host reason", async () => {
    const worker = new EliminatingWorker();
    const t = await table("ffa3", 3, [], undefined, worker);
    await post(t.host, { op: "start", ...t.organizer });
    await post(t.host, { op: "surrender", slug: t.slug, guildId: "g1", playerId: t.players[0] });
    await post(t.host, { op: "surrender", slug: t.slug, guildId: "g1", playerId: t.players[1] });
    const done = t.duels.get(t.slug, "g1");
    expect(done.status).toBe("completed");
    expect(done.winnerSeat).toBe(2);
    expect(done.resultReason).toBe("Surrender");
  });

  it("a time-limit loss uses the time-limit code", async () => {
    const clock = { t: 1_000 };
    const worker = new EliminatingWorker();
    const t = await table("ffa3", 3, [], clock, worker);
    await post(t.host, { op: "start", ...t.organizer });
    clock.t += 10 * 60 * 1000;
    await post(t.host, { op: "view", slug: t.slug, guildId: "g1", playerId: t.players[1] });
    expect(worker.calls).toEqual([{ seat: 0, reason: 3 }]);
    expect(t.duels.get(t.slug, "g1").status).toBe("active");
  });

  it("a recover repeats the elimination at the same point", async () => {
    const worker = new EliminatingWorker();
    const t = await table("ffa3", 3, [], undefined, worker);
    await post(t.host, { op: "start", ...t.organizer });
    await t.respond(t.players[0]!);
    await post(t.host, { op: "surrender", slug: t.slug, guildId: "g1", playerId: t.players[1] });
    const worker2 = new EliminatingWorker();
    const host2 = createDuelHost({
      db: t.db, dataDirectory: DATA, secret: SECRET, searchCards: () => [], pollIntervalMs: 60_000, createWorker: () => worker2,
    });
    hosts.push(host2);
    const viewed = await post(host2, { op: "view", slug: t.slug, guildId: "g1", playerId: t.players[2] });
    expect(viewed.status).toBe(200);
    expect(worker2.answers.map((entry) => entry.seat)).toEqual([0]);
    expect(worker2.calls).toEqual([{ seat: 1, reason: 0 }]);
    expect(worker2.revision).toBe(worker.revision);
    expect(worker2.promptSeat).toBe(worker.promptSeat);
  });

  it("keeps the autopilot fallback when the core has no Debug.EliminateDuelist", async () => {
    const worker = new EliminatingWorker();
    worker.missing = true;
    const t = await table("ffa3", 3, [], undefined, worker);
    await post(t.host, { op: "start", ...t.organizer });
    expect((await post(t.host, { op: "surrender", slug: t.slug, guildId: "g1", playerId: t.players[0] })).status).toBe(200);
    expect(t.duels.privateState(t.slug, "g1").setup?.surrenderedSeats).toEqual([0]);
    expect(worker.answers).toEqual([{ seat: 0, answer: { choice: "to_ep" } }]);
    expect(t.duels.privateState(t.slug, "g1").commands.some((entry) => entry.command.promptId.startsWith("eliminate:"))).toBe(false);
  });

  it("Tag: one partner's surrender still ends the duel for the team and never calls eliminate", async () => {
    const worker = new EliminatingWorker();
    const t = await table("tag", 4, [], undefined, worker);
    await post(t.host, { op: "start", ...t.organizer });
    await post(t.host, { op: "surrender", slug: t.slug, guildId: "g1", playerId: t.players[2] });
    expect(worker.calls).toEqual([]);
    expect(t.duels.get(t.slug, "g1").winnerSeat).toBe(1);
  });
});

describe("host hand scenarios (DUEL_SCENARIOS)", () => {
  const previous = process.env.DUEL_SCENARIOS;
  afterEach(() => {
    if (previous === undefined) delete process.env.DUEL_SCENARIOS;
    else process.env.DUEL_SCENARIOS = previous;
  });

  function scenarioHost(extra: { queueBlockedMs?: number; stallMs?: number; botStepDelayMs?: number; debugReadTimeoutMs?: number; dataDirectory?: string; presetIssues?: (id: string) => Array<{ sig: string; title: string; owner: string }> } = {}) {
    const db = new Database(":memory:");
    migrate(db);
    const player = Number(db.prepare("insert into players (guild_id, discord_user_id, display_name) values (?, ?, ?)").run("g1", "u0", "P0").lastInsertRowid);
    const worker = new NSeatWorker();
    const host = createDuelHost({ db, dataDirectory: DATA, secret: SECRET, searchCards: () => [], pollIntervalMs: 60_000, createWorker: () => worker, ...extra });
    hosts.push(host);
    return { db, worker, host, who: { guildId: "g1", playerId: player } };
  }

  it("answers 404 to all three ops when the gate is off", async () => {
    delete process.env.DUEL_SCENARIOS;
    const t = scenarioHost();
    expect((await post(t.host, { op: "list-presets", ...t.who })).status).toBe(404);
    expect((await post(t.host, { op: "start-preset", presetId: "dust-tornado-chain", ...t.who })).status).toBe(404);
    expect((await post(t.host, { op: "report", slug: "nope", note: "x", ...t.who })).status).toBe(404);
    expect((await post(t.host, { op: "debug-trace", slug: "nope", ...t.who })).status).toBe(404);
  });

  it("lists presets with the contract fields", async () => {
    process.env.DUEL_SCENARIOS = "1";
    const t = scenarioHost();
    const listed = await post(t.host, { op: "list-presets", ...t.who });
    expect(listed.status).toBe(200);
    const ids = listed.data.presets.map((item: { id: string }) => item.id);
    expect(ids).toContain("dust-tornado-chain");
    expect(ids).toContain("ffa4-surrender-in-chain");
    const dust = listed.data.presets.find((item: { id: string }) => item.id === "dust-tornado-chain");
    expect(dust).toMatchObject({ format: "1v1", needsMultiCore: false, available: true });
    expect(dust.checklist.length).toBeGreaterThan(0);
  });

  it("list-presets answers core {tag, sha} and per-preset issues", async () => {
    process.env.DUEL_SCENARIOS = "1";
    const dir = mkdtempSync(join(tmpdir(), "duel-core-info-"));
    try {
      copyFileSync(join(DATA, "manifest.json"), join(dir, "manifest.json"));
      writeFileSync(join(dir, "ocgcore.multi.wasm"), "fake wasm bytes");
      writeFileSync(join(dir, "ocgcore.multi.SOURCE"), "tag=B7\nsource=x\n");
      const t = scenarioHost({
        dataDirectory: dir,
        presetIssues: (id: string) => (id === "dust-tornado-chain" ? [{ sig: "s1", title: "Known", owner: "T3" }] : []),
      });
      const listed = await post(t.host, { op: "list-presets", ...t.who });
      expect(listed.data.core).toEqual({ tag: "B7", sha: createHash("sha256").update("fake wasm bytes").digest("hex") });
      const byId = (id: string) => listed.data.presets.find((item: { id: string }) => item.id === id);
      expect(byId("dust-tornado-chain").issues).toEqual([{ sig: "s1", title: "Known", owner: "T3" }]);
      expect(byId("solemn-judgment-summon").issues).toEqual([]);
      rmSync(join(dir, "ocgcore.multi.wasm"));
      rmSync(join(dir, "ocgcore.multi.SOURCE"));
      const bare = await post(scenarioHost({ dataDirectory: dir }).host, { op: "list-presets", ...t.who });
      expect(bare.data.core).toEqual({ tag: null, sha: null });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses an unknown preset", async () => {
    process.env.DUEL_SCENARIOS = "1";
    const t = scenarioHost();
    expect((await post(t.host, { op: "start-preset", presetId: "nope", ...t.who })).status).toBe(404);
  });

  it("starts a preset table: bot seat, startup scripts in the setup, scripted bot policy", async () => {
    process.env.DUEL_SCENARIOS = "1";
    const t = scenarioHost();
    const started = await post(t.host, { op: "start-preset", presetId: "dust-tornado-chain", ...t.who });
    expect(started.status).toBe(200);
    const slug = started.data.slug as string;
    expect(started.data.session.slug).toBe(slug);
    expect(started.data.room.mySeat).toBe(0);
    const duels = createDuelService(t.db);
    const state = duels.privateState(slug, "g1");
    expect(state.session.status).toBe("active");
    expect(state.session.seats.map((seat) => seat.isBot)).toEqual([false, true]);
    expect(state.setup).toMatchObject({ presetId: "dust-tornado-chain", scenarioId: "dust-tornado-chain", botPolicies: { "1": "scripted" } });
    expect(state.setup?.startupScripts?.length).toBeGreaterThan(0);
    const scripts = (t.worker.created as { startupScripts?: Array<{ content: string }> }).startupScripts;
    expect(scripts?.map((script) => script.content)).toEqual(state.setup?.startupScripts);
  });

  it("journals the reason of a scripted bot answer and reports to a folder", async () => {
    process.env.DUEL_SCENARIOS = "1";
    const t = scenarioHost();
    const started = await post(t.host, { op: "start-preset", presetId: "dust-tornado-chain", ...t.who });
    const slug = started.data.slug as string;
    const responded = await post(t.host, {
      op: "respond", slug, ...t.who,
      command: { promptId: `p${t.worker.revision}`, revision: t.worker.revision, answer: { choice: "to_ep" } },
    });
    expect(responded.status).toBe(200);
    const duels = createDuelService(t.db);
    const commands = duels.privateState(slug, "g1").commands;
    expect(commands.map((entry) => entry.seat)).toEqual([0, 1]);
    expect((commands[1]!.command as { note?: string }).note).toBe("default: pass");
    expect(commands[0]!.command).not.toHaveProperty("note");

    const dir = mkdtempSync(join(tmpdir(), "duel-report-"));
    process.env.DUEL_REPORT_DIR = dir;
    try {
      const reported = await post(t.host, { op: "report", slug, note: "Looks right.", ...t.who });
      expect(reported.status).toBe(200);
      const folder = reported.data.path as string;
      expect(folder.startsWith(dir)).toBe(true);
      const journal = readFileSync(join(folder, "journal.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
      expect(journal[0]).toMatchObject({ type: "duel", slug, presetId: "dust-tornado-chain" });
      expect(journal[2]).toMatchObject({ type: "answer", seat: 1, bot: true, note: "default: pass" });
      expect(existsSync(join(folder, "views", "seat-0.json"))).toBe(true);
      expect(existsSync(join(folder, "views", "seat-1.json"))).toBe(true);
      expect(JSON.parse(readFileSync(join(folder, "engine-diagnostics.json"), "utf8"))).toEqual({
        wasmSha: "f".repeat(64),
        wasmFile: "ocgcore.fake.wasm",
        entries: [{ turn: 1, phase: "main1", kind: "response", seat: 0, detail: "fake" }],
      });
      expect(journal[0]).toMatchObject({ format: "yugidraft-duel-journal/1", mode: "normal", wasmSha: "f".repeat(64), wasmFile: "ocgcore.fake.wasm" });
      expect(journal[0].decks).toHaveLength(2);
      expect(journal[0].startupScripts.length).toBeGreaterThan(0);
      expect(JSON.parse(readFileSync(join(folder, "debug-trace.json"), "utf8")).wasmSha).toBe("f".repeat(64));
      expect(readFileSync(join(folder, "note.md"), "utf8")).toContain("Looks right.");
    } finally {
      delete process.env.DUEL_REPORT_DIR;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("recovers a preset table with the same startup scripts", async () => {
    process.env.DUEL_SCENARIOS = "1";
    const t = scenarioHost();
    const started = await post(t.host, { op: "start-preset", presetId: "dust-tornado-chain", ...t.who });
    const slug = started.data.slug as string;
    const worker2 = new NSeatWorker();
    const host2 = createDuelHost({ db: t.db, dataDirectory: DATA, secret: SECRET, searchCards: () => [], pollIntervalMs: 60_000, createWorker: () => worker2 });
    hosts.push(host2);
    expect((await post(host2, { op: "view", slug, ...t.who })).status).toBe(200);
    expect((worker2.created as { startupScripts?: unknown }).startupScripts).toEqual((t.worker.created as { startupScripts?: unknown }).startupScripts);
  });

  it("refuses a multi-core preset with 409 when the data directory has no multi wasm", async () => {
    process.env.DUEL_SCENARIOS = "1";
    const t = scenarioHost();
    const res = await post(t.host, { op: "start-preset", presetId: "mind-crush-ffa4-pick", ...t.who });
    expect(res.status).toBe(multiCoreAvailable(DATA) ? 200 : 409);
  });

  it("debug-trace returns the contract shape: views, prompt, bot rule trace, worker state", async () => {
    process.env.DUEL_SCENARIOS = "1";
    const t = scenarioHost();
    const started = await post(t.host, { op: "start-preset", presetId: "dust-tornado-chain", ...t.who });
    const slug = started.data.slug as string;
    await post(t.host, {
      op: "respond", slug, ...t.who,
      command: { promptId: `p${t.worker.revision}`, revision: t.worker.revision, answer: { choice: "to_ep" } },
    });
    const traced = await post(t.host, { op: "debug-trace", slug, ...t.who });
    expect(traced.status).toBe(200);
    const trace = traced.data;
    expect(trace.revision).toBe(t.worker.revision);
    expect(trace.wasmSha).toBe("f".repeat(64));
    expect(trace.seats).toHaveLength(2);
    expect(trace.seats[0]).toMatchObject({ seat: 0, view: { revision: t.worker.revision } });
    expect(trace.seats[0].prompt).toMatchObject({ seat: 0 });
    expect(trace.seats[1].prompt).toBeUndefined();
    expect(trace.spectator.revision).toBe(t.worker.revision);
    expect(trace.bot.seats).toHaveLength(1);
    expect(trace.bot.seats[0]).toMatchObject({ seat: 1, policy: "scripted" });
    expect(trace.bot.seats[0].lastTrace.length).toBeGreaterThan(0);
    const last = trace.bot.seats[0].lastTrace.at(-1);
    expect(last).toMatchObject({ matched: true });
    expect(typeof last.rule).toBe("string");
    expect(last.answer).toBeDefined();
    expect(trace.worker).toEqual({ busy: false, lastOp: "answer", lastOpAt: 1234, callsSinceLastPrompt: 3, messagesSinceLastPrompt: 7 });
  });

  it("debug-trace answers while the core is stuck", async () => {
    process.env.DUEL_SCENARIOS = "1";
    const t = scenarioHost({ debugReadTimeoutMs: 50 });
    const started = await post(t.host, { op: "start-preset", presetId: "dust-tornado-chain", ...t.who });
    const slug = started.data.slug as string;
    t.worker.hang = true;
    const traced = await post(t.host, { op: "debug-trace", slug, ...t.who });
    expect(traced.status).toBe(200);
    expect(traced.data.revision).toBeNull();
    expect(traced.data.seats.map((seat: { view: unknown }) => seat.view)).toEqual([null, null]);
    expect(traced.data.worker.busy).toBe(true);
    expect(traced.data.errors.length).toBeGreaterThan(0);
  });

  /** Start a preset, let seat 0 read its room once, then block the duel queue inside the core. */
  async function blockedDuel() {
    process.env.DUEL_SCENARIOS = "1";
    const t = scenarioHost({ debugReadTimeoutMs: 50, queueBlockedMs: 150, stallMs: 0 });
    const started = await post(t.host, { op: "start-preset", presetId: "dust-tornado-chain", ...t.who });
    const slug = started.data.slug as string;
    const seen = await post(t.host, { op: "view", slug, ...t.who });
    t.worker.hangAnswer = true;
    t.worker.hang = true;
    const stuck = post(t.host, {
      op: "respond", slug, ...t.who,
      command: { promptId: `p${t.worker.revision}`, revision: t.worker.revision, answer: { choice: "to_ep" } },
    });
    return { t, slug, seen, stuck };
  }

  it("report on a hung core writes one partial folder within the limit", async () => {
    const dir = mkdtempSync(join(tmpdir(), "duel-partial-"));
    process.env.DUEL_REPORT_DIR = dir;
    const { t, slug, stuck } = await blockedDuel();
    try {
      const began = Date.now();
      const reported = await post(t.host, { op: "report", slug, note: "Hung.", ...t.who });
      expect(Date.now() - began).toBeLessThan(2000);
      expect(reported.status).toBe(200);
      expect(reported.data.partial).toBe(true);
      const folder = reported.data.path as string;
      expect(folder.startsWith(dir)).toBe(true);
      expect(existsSync(join(folder, "journal.jsonl"))).toBe(true);
      expect(existsSync(join(folder, "views", "seat-0.json"))).toBe(true);
      expect(existsSync(join(folder, "room-setup.json"))).toBe(true);
      expect(existsSync(join(folder, "engine-diagnostics.json"))).toBe(true);
      expect(JSON.parse(readFileSync(join(folder, "debug-trace.json"), "utf8")).worker.busy).toBe(true);
      expect(JSON.parse(readFileSync(join(folder, "partial.json"), "utf8"))).toMatchObject({ partial: true, slug });
      expect(readFileSync(join(folder, "note.md"), "utf8")).toContain("PARTIAL REPORT");
      // The core answers later: no second folder.
      t.worker.hang = false;
      t.worker.unhang();
      await stuck;
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(readdirSync(dir)).toHaveLength(1);
    } finally {
      t.worker.unhang();
      delete process.env.DUEL_REPORT_DIR;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("room read on a hung core returns the last view of that seat with stale true", async () => {
    const { t, slug, seen, stuck } = await blockedDuel();
    try {
      const read = await post(t.host, { op: "view", slug, ...t.who });
      expect(read.status).toBe(200);
      expect(read.data.stale).toBe(true);
      expect(read.data.engine.revision).toBe(seen.data.engine.revision);
      expect(read.data.engine.prompt?.seat).toBe(0);
    } finally {
      t.worker.hang = false;
      t.worker.unhang();
      await stuck;
    }
  });

  it("a normal duel gives a full report and a fresh room read", async () => {
    process.env.DUEL_SCENARIOS = "1";
    const dir = mkdtempSync(join(tmpdir(), "duel-full-"));
    process.env.DUEL_REPORT_DIR = dir;
    try {
      const t = scenarioHost({ queueBlockedMs: 150 });
      const started = await post(t.host, { op: "start-preset", presetId: "dust-tornado-chain", ...t.who });
      const slug = started.data.slug as string;
      const read = await post(t.host, { op: "view", slug, ...t.who });
      expect(read.data).not.toHaveProperty("stale");
      const reported = await post(t.host, { op: "report", slug, note: "Fine.", ...t.who });
      expect(reported.data).not.toHaveProperty("partial");
      expect(existsSync(join(reported.data.path as string, "partial.json"))).toBe(false);
      expect(existsSync(join(reported.data.path as string, "views", "seat-1.json"))).toBe(true);
    } finally {
      delete process.env.DUEL_REPORT_DIR;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  async function waitFor<T>(read: () => T | undefined, ms = 5000): Promise<T> {
    const end = Date.now() + ms;
    for (;;) {
      const value = read();
      if (value !== undefined) return value;
      if (Date.now() > end) throw new Error("timed out waiting");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  it("the stall watchdog writes one auto-stall report when a bot holds the prompt", async () => {
    process.env.DUEL_SCENARIOS = "1";
    const dir = mkdtempSync(join(tmpdir(), "duel-stall-"));
    process.env.DUEL_REPORT_DIR = dir;
    try {
      // A paced bot with an endless pause: the bot seat holds the prompt and nothing changes.
      const t = scenarioHost({ stallMs: 150, botStepDelayMs: 10_000_000 });
      const started = await post(t.host, { op: "start-preset", presetId: "dust-tornado-chain", ...t.who });
      const slug = started.data.slug as string;
      // The human seat holds the first prompt: a human may take their time, so no stall yet.
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(readdirSync(dir)).toEqual([]);
      await post(t.host, {
        op: "respond", slug, ...t.who,
        command: { promptId: `p${t.worker.revision}`, revision: t.worker.revision, answer: { choice: "to_ep" } },
      });
      expect(t.worker.promptSeat).toBe(1);
      const folder = await waitFor(() => readdirSync(dir).find((name) => name.includes("auto-stall") && existsSync(join(dir, name, "note.md"))));
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(readdirSync(dir).filter((name) => name.includes("auto-stall"))).toEqual([folder]);
      const full = join(dir, folder);
      const stall = JSON.parse(readFileSync(join(full, "stall.json"), "utf8"));
      expect(stall).toMatchObject({ slug, waitingOn: "bot seat 1", wasmSha: "f".repeat(64), wasmFile: "ocgcore.fake.wasm" });
      const trace = JSON.parse(readFileSync(join(full, "debug-trace.json"), "utf8"));
      expect(trace.bot.seats[0].timer).toMatchObject({ delayMs: expect.any(Number), dueAt: expect.any(Number) });
      expect(existsSync(join(full, "journal.jsonl"))).toBe(true);
      expect(existsSync(join(full, "engine-diagnostics.json"))).toBe(true);
      expect(readFileSync(join(full, "note.md"), "utf8")).toContain("bot seat 1");
    } finally {
      delete process.env.DUEL_REPORT_DIR;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the stall watchdog names the core when the worker does not answer", async () => {
    process.env.DUEL_SCENARIOS = "1";
    const dir = mkdtempSync(join(tmpdir(), "duel-stall-"));
    process.env.DUEL_REPORT_DIR = dir;
    try {
      const t = scenarioHost({ stallMs: 100, debugReadTimeoutMs: 30 });
      await post(t.host, { op: "start-preset", presetId: "dust-tornado-chain", ...t.who });
      t.worker.hang = true;
      const folder = await waitFor(() => readdirSync(dir).find((name) => name.includes("auto-stall") && existsSync(join(dir, name, "note.md"))));
      const stall = JSON.parse(readFileSync(join(dir, folder, "stall.json"), "utf8"));
      expect(stall.waitingOn).toMatch(/^core/);
      expect(stall.worker.busy).toBe(true);
    } finally {
      delete process.env.DUEL_REPORT_DIR;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a report journal has the e2e header and puts eliminate and surrender lines at their seq", async () => {
    process.env.DUEL_SCENARIOS = "1";
    const dir = mkdtempSync(join(tmpdir(), "duel-report-"));
    process.env.DUEL_REPORT_DIR = dir;
    try {
      // Core that can eliminate: the elimination is journaled as a command at its seq.
      const worker = new EliminatingWorker();
      const t = await table("ffa3", 3, [], undefined, worker);
      await post(t.host, { op: "start", ...t.organizer });
      await t.respond(t.players[0]!);
      await post(t.host, { op: "surrender", slug: t.slug, guildId: "g1", playerId: t.players[1] });
      await t.respond(t.players[2]!);
      const reported = await post(t.host, { op: "report", slug: t.slug, note: "n", guildId: "g1", playerId: t.players[0] });
      const lines = readFileSync(join(reported.data.path, "journal.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
      expect(lines[0]).toMatchObject({ format: "yugidraft-duel-journal/1", tableFormat: "ffa3", mode: "normal", wasmSha: "f".repeat(64) });
      expect(lines[0].decks).toHaveLength(3);
      expect(lines[0].seed).toHaveLength(4);
      expect(lines.slice(1).map((line) => [line.type, line.seq, line.seat])).toEqual([["answer", 1, 0], ["eliminate", 2, 1], ["answer", 3, 2]]);

      // Core without Debug.EliminateDuelist: the surrender line sits before the first autopilot answer of that seat.
      const old = new EliminatingWorker();
      old.missing = true;
      const u = await table("ffa3", 3, [], undefined, old);
      await post(u.host, { op: "start", ...u.organizer });
      await post(u.host, { op: "surrender", slug: u.slug, guildId: "g1", playerId: u.players[0] });
      const reported2 = await post(u.host, { op: "report", slug: u.slug, note: "n", guildId: "g1", playerId: u.players[1] });
      const lines2 = readFileSync(join(reported2.data.path, "journal.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
      const types = lines2.slice(1).map((line) => [line.type, line.seq, line.seat]);
      expect(types[0]).toEqual(["surrender", 1, 0]);
      expect(types[1]).toEqual(["answer", 1, 0]);
    } finally {
      delete process.env.DUEL_REPORT_DIR;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
