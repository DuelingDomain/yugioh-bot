import { createHmac } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { createDuelService } from "@yugidraft/shared/services";
import { defaultDuelSettings, seatCountFor, type DuelAnswer, type DuelChainMode, type DuelEngineView, type DuelEvent, type DuelFormat, type DuelMode, type DuelRoom } from "@yugidraft/shared/duels";
import { createDuelHost, type DuelHost } from "../src/host.js";
import { createEngineGame, type EngineGame } from "../src/engine.js";
import { isClockDue, liveRemainingMs } from "../src/clock.js";
import { choosePracticeBotAnswer } from "../src/practice-bot.js";
import { compileBoard, type BoardSpec } from "../src/presets/board.js";
import type { DuelGameWorker, GameOptions } from "../src/worker-client.js";
import { engineDataDirectory as DATA } from "./engine-data-dir.js";
import { describeWithCores, needs } from "./support/cores.js";

const SECRET = "coin-clock-test";
const hosts: DuelHost[] = [];
const databases: Database.Database[] = [];
afterEach(async () => {
  while (hosts.length) await hosts.pop()!.close();
  for (const db of databases.splice(0)) db.close();
  vi.useRealTimers();
});

function coin(id: number, count: number): DuelEvent {
  return { id, kind: "toss", seat: 0, text: "Coin toss", toss: { type: "coin", results: Array(count).fill("heads") } };
}

class TossWorker implements DuelGameWorker {
  running = true;
  revision = 1;
  holder = 0;
  format: DuelFormat = "1v1";
  events: DuelEvent[] = [coin(1, 1)]; // Historical tosses must never get fresh grace.
  modes: DuelChainMode[] = ["auto", "auto", "auto", "auto"];
  chainPrefix: DuelEvent[] = [];
  chainBatches: DuelEvent[][] = [];
  handoffAfterToss = false;
  constructor(readonly batches: number[][] = [[3]], readonly botToss = false) {}
  async create(options: GameOptions) { this.running = true; this.format = options.format ?? "1v1"; }
  async view(seat: number | null): Promise<DuelEngineView> {
    return {
      revision: this.revision, format: this.format, turn: 1, turnSeat: 0, phase: "main1",
      seats: Array.from({ length: seatCountFor(this.format) }, (_, index) => ({
        seat: index, lp: 8_000, hand: [], deckCount: 40, extraCount: 0, extra: [], monsters: [], spells: [], graveyard: [], banished: [],
      })),
      prompt: seat === this.holder ? {
        id: `p${this.revision}`, seat, kind: "choice", title: "Main", options: [{ id: "to_ep", label: "End" }],
      } : null,
      prioritySeat: this.holder, chain: [], events: structuredClone(this.events), log: [], result: null,
      ...(seat === null ? {} : { chainMode: this.modes[seat] }),
    };
  }
  async answer(_seat: number, _promptId: string, _answer: DuelAnswer) {
    if (this.revision === 1) this.events.push(...this.chainPrefix);
    this.events.push(...this.chainBatches[this.revision - 1] ?? []);
    for (const count of this.batches[this.revision - 1] ?? []) this.events.push(coin(this.events.length + 1, count));
    this.revision++;
    this.holder = this.botToss && this.revision === 2 ? 1 : 0;
    if (this.handoffAfterToss && this.revision > 2) this.holder = 1;
  }
  async setChainMode(seat: number, mode: DuelChainMode) {
    this.modes[seat] = mode;
    if (seat !== this.holder || mode !== "off") return false;
    await this.answer(seat, `p${this.revision}`, {});
    return true;
  }
  async search() { return []; }
  async close() { this.running = false; }
}

class CoreWorker implements DuelGameWorker {
  game: EngineGame | null = null;
  get running() { return this.game !== null; }
  constructor(readonly board: BoardSpec) {}
  async create(options: GameOptions) {
    const compiled = compileBoard(this.board, DATA).options;
    this.game = await createEngineGame({ ...options, ...compiled, settings: { ...compiled.settings!, turnSeconds: 30, timeout: "loss" }, seed: ["1", "2", "3", "4"] });
  }
  async view(seat: number | null) { return this.game!.view(seat); }
  async answer(seat: number, promptId: string, answer: DuelAnswer) { this.game!.answer(seat, promptId, answer); }
  async search() { return []; }
  async close() { this.game?.close(); this.game = null; }
}

async function table(options: {
  format?: DuelFormat; mode?: DuelMode; timeout?: "loss" | "continue";
  worker?: DuelGameWorker; bot?: boolean; paced?: boolean;
} = {}) {
  const format = options.format ?? "1v1";
  const mode = options.mode ?? "normal";
  const db = new Database(":memory:"); databases.push(db); migrate(db);
  const players = Array.from({ length: seatCountFor(format) }, (_, seat) => Number(db.prepare(
    "insert into players (guild_id, discord_user_id, display_name) values ('g', ?, ?)",
  ).run(`u${seat}`, `P${seat}`).lastInsertRowid));
  const duels = createDuelService(db);
  const settings = { ...defaultDuelSettings(mode), turnSeconds: 30, timeout: options.timeout ?? "loss", validateDeck: false };
  const session = duels.create({ guildId: "g", organizerPlayerId: players[0]!, name: "Coin clock", mode, format, settings });
  const deck = { main: Array(40).fill(15025844), extra: [], side: [], ...(mode === "domain" ? { deckMaster: 15025844 } : {}) };
  for (const [seat, player] of players.entries()) {
    if (seat === 1 && options.bot) { duels.addPracticeBot(session.slug, "g", players[0]!, deck); continue; }
    if (seat !== 0) duels.takeSeat(session.slug, "g", player);
    duels.setDeck(session.slug, "g", player, deck);
  }
  const worker = options.worker ?? new TossWorker();
  let time = 100_000;
  const makeHost = () => {
    const host = createDuelHost({ db, dataDirectory: DATA, secret: SECRET, searchCards: () => [],
      createWorker: () => worker, now: () => time, pollIntervalMs: 1_000, stallMs: 0,
      ...(options.paced ? { botStepDelayMs: 1 } : {}),
    });
    hosts.push(host);
    return host;
  };
  let host = makeHost();
  const post = async (body: Record<string, unknown>, seat = 0) => {
    const raw = JSON.stringify({ slug: session.slug, guildId: "g", playerId: players[seat], ...body });
    const response = await host.handle(new Request("http://localhost/internal/duel", {
      method: "POST", body: raw, headers: { "content-type": "application/json", "x-announce-signature": "sha256=" + createHmac("sha256", SECRET).update(raw).digest("hex") },
    }));
    const data = await response.json() as DuelRoom;
    expect(response.status, JSON.stringify(data)).toBe(200);
    return data;
  };
  await post({ op: "start" });
  const clock = () => duels.privateState(session.slug, "g").clock!;
  const lowBank = () => duels.setClock(session.slug, "g", { ...clock(), remainingMs: players.map(() => 100), startedAt: time });
  lowBank();
  return {
    post, clock, duels, slug: session.slug, worker,
    setTime: (at: number) => { time = at; },
    respond: async (seat = 0, answer?: DuelAnswer) => {
      const view = await worker.view(seat);
      return post({ op: "respond", command: { revision: view.revision, promptId: view.prompt!.id, answer: answer ?? { choice: "to_ep" } } }, seat);
    },
    restart: () => { host = makeHost(); },
  };
}

describe("live coin toss clock grace", () => {
  for (const format of ["1v1", "ffa3", "ffa4", "tag"] as const) {
    for (const mode of ["normal", "domain"] as const) {
      it.each(["loss", "continue"] as const)(`${format} ${mode}: %s bank stays intact during a three-coin toss`, async (timeout) => {
        const t = await table({ format, mode, timeout });
        await t.respond();
        const clock = t.clock();
        expect(clock.startedAt).toBe(124_520);
        t.setTime(124_519);
        const room = await t.post({ op: "view" });
        expect(room.session.status).toBe("active");
        expect(t.clock()).toEqual(clock);
        expect(liveRemainingMs(clock, 124_519)).toEqual(clock.remainingMs);
        expect(isClockDue(clock, 124_519)).toBe(false);
        expect(liveRemainingMs(clock, 124_521)[clock.activeSeat!]).toBe(clock.remainingMs[clock.activeSeat!]! - 1);
      });
    }
  }

  it.each([[[1, 3, 2], 148_640], [[200], 160_000]] as const)("covers all events in one batch and caps long grace (%s)", async (counts, start) => {
    const t = await table({ worker: new TossWorker([[...counts]]) });
    await t.respond();
    expect(t.clock().startedAt).toBe(start);
  });

  it("does not give historical tosses grace on a command or resync", async () => {
    const t = await table({ worker: new TossWorker([]) });
    await t.respond();
    expect(t.clock().startedAt).toBe(100_000);
    t.setTime(100_010);
    await t.post({ op: "view" });
    expect(t.clock().startedAt).toBe(100_000);
  });

  it("keeps the grace end on an early answer and a resync", async () => {
    const t = await table();
    await t.respond();
    t.setTime(100_100);
    await t.respond();
    expect(t.clock().startedAt).toBe(124_520);
    await t.post({ op: "view" });
    expect(t.clock().startedAt).toBe(124_520);
  });

  it("queues another live toss behind the remaining grace", async () => {
    const t = await table({ worker: new TossWorker([[3], [3]]) });
    await t.respond();
    t.setTime(100_100);
    await t.respond();
    expect(t.clock().startedAt).toBe(149_040);
  });

  it("covers a preceding noncoin chain link before a three-coin toss", async () => {
    const worker = new TossWorker();
    worker.chainPrefix = [
      { id: 2, kind: "chain-resolving", chainIndex: 2, text: "Resolve 2" },
      { id: 3, kind: "chain-resolved", chainIndex: 2, text: "Resolved 2" },
      { id: 4, kind: "chain-resolving", chainIndex: 1, text: "Resolve 1" },
    ];
    const t = await table({ worker });
    await t.respond();
    // Actual web planner: 26,760ms at 0.5x, with fallback unlock at 28,260ms.
    expect(t.clock().startedAt).toBeGreaterThanOrEqual(128_260);
    t.setTime(126_759);
    expect((await t.post({ op: "view" })).session.status).toBe("active");
  });

  it("covers a preceding chain still queued after its engine chain-end", async () => {
    const worker = new TossWorker([[], [3]]);
    worker.chainBatches = [
      [
        { id: 2, kind: "activate", chainIndex: 1, text: "Activate" },
        { id: 3, kind: "chain-resolving", chainIndex: 1, text: "Resolve" },
        { id: 4, kind: "chain-resolved", chainIndex: 1, text: "Resolved" },
        { id: 5, kind: "chain-end", text: "End" },
      ],
      [
        { id: 6, kind: "activate", chainIndex: 1, text: "Activate coin" },
        { id: 7, kind: "chain-resolving", chainIndex: 1, text: "Resolve coin" },
      ],
    ];
    const t = await table({ worker });
    await t.respond();
    expect(t.clock().startedAt).toBe(100_000); // Ordinary chains do not grant clock grace.
    t.setTime(100_100);
    await t.respond();
    // The web queue ends 32,620ms after the second command; its fallback needs 1,500ms more.
    expect(t.clock().startedAt).toBeGreaterThanOrEqual(134_220);
    const clock = t.clock();
    t.duels.setClock(t.slug, "g", { ...clock, remainingMs: [1, 1] });
    t.setTime(132_719);
    expect((await t.post({ op: "view" })).session.status).toBe("active");
    expect(liveRemainingMs(t.clock(), 132_719)).toEqual([1, 1]);
  });

  it("keeps grace when a zero-bank continue seat hands the prompt to a funded seat", async () => {
    const worker = new TossWorker(); worker.handoffAfterToss = true;
    const t = await table({ worker, timeout: "continue" });
    t.duels.setClock(t.slug, "g", { ...t.clock(), remainingMs: [0, 100], startedAt: null });
    await t.respond();
    t.setTime(100_100);
    await t.respond();
    expect(t.clock().activeSeat).toBe(1);
    expect(t.clock().startedAt).toBe(124_520);
    t.setTime(124_519);
    expect((await t.post({ op: "view" }, 1)).session.status).toBe("active");
    expect(liveRemainingMs(t.clock(), 124_519)).toEqual([0, 100]);
  });

  it("does not add grace when recovery replays the toss", async () => {
    const t = await table();
    await t.respond();
    const saved = t.clock();
    const worker = t.worker as TossWorker;
    worker.running = false; worker.revision = 1; worker.events = [coin(1, 1)];
    t.restart();
    t.setTime(100_100);
    await t.post({ op: "view" });
    expect(t.clock()).toEqual(saved);
    expect((await worker.view(null)).events).toHaveLength(2);
  });

  it("gives automatic chain passes the same grace", async () => {
    const t = await table();
    await t.post({ op: "chain-mode", mode: "off" });
    expect(t.clock().startedAt).toBe(124_520);
  });

  it.each([false, true])("keeps grace from practice bot answers (paced=%s)", async (paced) => {
    vi.useFakeTimers();
    const t = await table({ worker: new TossWorker([[], [3]], true), bot: true, paced });
    await t.respond();
    if (paced) await vi.advanceTimersByTimeAsync(20);
    expect((t.worker as TossWorker).revision).toBe(3);
    expect(t.clock().activeSeat).toBe(0);
    expect(t.clock().startedAt).toBe(124_520);
  });

  it("the timeout sweep waits for grace, then enforces the low-bank loss", async () => {
    vi.useFakeTimers();
    const t = await table();
    await t.respond();
    const clock = t.clock();
    t.setTime(124_519);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(t.duels.get(t.slug, "g").status).toBe("active");
    t.setTime(clock.startedAt! + clock.remainingMs[0]!);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(t.duels.get(t.slug, "g")).toMatchObject({ status: "completed", resultReason: "Time limit" });
  });
});

describeWithCores("real-core Barrel Dragon clock", [needs.cards(), needs.scripts(), needs.standard(), needs.domain(), needs.installedMulti()], () => {
  it.each([
    ["1v1", "normal"], ["1v1", "domain"], ["ffa3", "normal"], ["ffa4", "normal"], ["tag", "normal"],
  ] as const)("%s %s: the low bank survives the full three-coin lock", async (format, mode) => {
    const master = mode === "domain" ? { deckMaster: 15025844 } : {};
    const board: BoardSpec = { format, mode, p0: { monsters: [81480460], ...master }, p1: { monsters: [6368038], ...master },
      ...(seatCountFor(format) > 2 ? { p2: { ...master } } : {}), ...(seatCountFor(format) > 3 ? { p3: { ...master } } : {}),
    };
    const worker = new CoreWorker(board);
    const t = await table({ format, mode, worker });
    let activated = false;
    for (let guard = 0; guard < 30 && !(await worker.view(null)).events.some((event) => event.kind === "toss"); guard++) {
      let answered = false;
      for (let seat = 0; seat < seatCountFor(format); seat++) {
        const { prompt } = await worker.view(seat);
        if (!prompt) continue;
        const activate = !activated && prompt.options.find((option) => option.id.startsWith("activate:") && option.card?.code === 81480460);
        const answer = activate ? { choice: activate.id } : choosePracticeBotAnswer(prompt);
        if (activate) activated = true;
        await t.respond(seat, answer); answered = true; break;
      }
      expect(answered).toBe(true);
    }
    const toss = (await worker.view(null)).events.find((event) => event.kind === "toss");
    expect(toss?.toss?.results).toHaveLength(3);
    const clock = t.clock();
    expect(clock.startedAt).toBeGreaterThanOrEqual(124_520);
    expect(clock.startedAt).toBeLessThanOrEqual(160_000);
    const graceEnd = clock.startedAt!;
    t.duels.setClock(t.slug, "g", { ...clock, remainingMs: clock.remainingMs.map(() => 1) });
    t.setTime(graceEnd - 1);
    const room = await t.post({ op: "view" });
    expect(room.session.status).toBe("active");
    expect(room.engine?.result).toBeNull();
    expect(liveRemainingMs(t.clock(), graceEnd - 1)).toEqual(clock.remainingMs.map(() => 1));
    expect(isClockDue(t.clock(), graceEnd - 1)).toBe(false);
    expect(isClockDue(t.clock(), graceEnd + 1)).toBe(true);
  });
});
