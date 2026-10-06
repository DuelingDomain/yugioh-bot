import { seedIdentity, seedUser } from "../../shared/tests/helpers/identity.js";
import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "@yugidraft/shared/db";
import type { DuelAnswer, DuelCardInfo, DuelEngineView, DuelPrompt } from "@yugidraft/shared/duels";
import { createDuelService } from "@yugidraft/shared/services";
import { createDuelHost, practiceBotDelay, type DuelHost } from "../src/host.js";
import { buildPracticeBotDeck } from "../src/practice-bot.js";
import type { DuelGameWorker, GameOptions } from "../src/worker-client.js";
import { engineDataDirectory as DATA } from "./engine-data-dir.js";

const SECRET = "bot-pacing-secret";

function fakeView(viewer: number | null, worker: BotWorker): DuelEngineView {
  const over = worker.result;
  const prompt: DuelPrompt | null =
    !over && viewer === worker.promptSeat
      ? { id: `p${worker.revision}`, seat: worker.promptSeat, kind: "choice", title: "Main", options: [{ id: "to_ep", label: "End" }], context: { type: "action", phase: "main" } }
      : null;
  const seat = (index: number) => ({
    seat: index, lp: 8000, hand: [], deckCount: 35, extraCount: 0, extra: [], monsters: [], spells: [], graveyard: [], banished: [],
  });
  return {
    revision: worker.revision,
    turn: 1,
    turnSeat: worker.promptSeat,
    phase: "main1",
    seats: [seat(0), seat(1)],
    prompt,
    chain: [],
    events: [{ id: worker.revision, kind: "phase", text: "x" }],
    log: [],
    result: over,
  };
}

/** Human (seat 0) answers once; then the bot (seat 1) owns `botSteps` prompts in a row; then it is the human's turn again. */
class BotWorker implements DuelGameWorker {
  revision = 1;
  promptSeat = 0;
  botStepsLeft = 3;
  botStepsPerHumanMove = 3;
  answers: number[] = [];
  closed = 0;
  result: DuelEngineView["result"] = null;
  onBotAnswer: (() => void) | null = null;
  private stopped = false;
  get running() { return !this.stopped; }
  async create(_options: GameOptions) {}
  async view(seat: number | null) { return fakeView(seat, this); }
  async answer(seat: number, _promptId: string, _answer: DuelAnswer) {
    this.answers.push(seat);
    this.revision += 1;
    if (seat === 0) {
      this.promptSeat = 1;
      this.botStepsLeft = this.botStepsPerHumanMove;
    } else {
      this.onBotAnswer?.();
      this.botStepsLeft -= 1;
      if (this.botStepsLeft <= 0) this.promptSeat = 0;
    }
  }
  async search(_query: string): Promise<DuelCardInfo[]> { return []; }
  async close() { this.stopped = true; this.closed += 1; }
}

const hosts: DuelHost[] = [];
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
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
  return { status: response.status, data: (await response.json()) as Record<string, unknown> };
}

async function setup(options: { botStepDelayMs?: number | ((prompt: DuelPrompt) => number); worker?: BotWorker } = {}) {
  const db = new Database(":memory:");
  migrate(db);
  const player = seedIdentity(db, { guildId: "g1", name: "Yugi", userId: seedUser(db, "u1").userId, discordUserId: seedUser(db, "u1").discordUserId ?? "u1" }).playerId;
  const duels = createDuelService(db);
  const session = duels.create({ guildId: "g1", organizerPlayerId: player, name: "Duel", mode: "normal" });
  duels.setDeck(session.slug, "g1", player, buildPracticeBotDeck("normal", DATA));
  const worker = options.worker ?? new BotWorker();
  const changes: string[] = [];
  const host = createDuelHost({
    db,
    dataDirectory: DATA,
    secret: SECRET,
    searchCards: () => [],
    pollIntervalMs: 60_000,
    createWorker: () => worker,
    botStepDelayMs: options.botStepDelayMs,
    stallMs: 0, // no stall watchdog interval: the timer counts below expect only the sweep interval
    onChange: (slug) => { changes.push(slug); },
  });
  hosts.push(host);
  const base = { slug: session.slug, guildId: "g1", playerId: player };
  expect((await post(host, { op: "add-bot", ...base })).status).toBe(200);
  expect((await post(host, { op: "start", ...base })).status).toBe(200);
  const respond = () =>
    post(host, { op: "respond", ...base, command: { promptId: `p${worker.revision}`, revision: worker.revision, answer: { choice: "to_ep" } } });
  return { db, duels, host, worker, base, changes, respond, slug: session.slug };
}

describe("practice bot pacing", () => {
  it("keeps the synchronous behaviour when no delay is configured", async () => {
    const { worker, respond, changes } = await setup({ botStepDelayMs: 0 });
    const before = changes.length;
    const result = await respond();
    expect(result.status).toBe(200);
    // The human's request already contains all three bot answers.
    expect(worker.answers).toEqual([0, 1, 1, 1]);
    expect(worker.promptSeat).toBe(0);
    expect(changes.length - before).toBe(1);
  });

  it("returns right after the human's move, then plays one step at a time and reports each one", async () => {
    vi.useFakeTimers();
    const { worker, respond, changes } = await setup({ botStepDelayMs: () => 500 });
    const before = changes.length;
    const result = await respond();
    expect(result.status).toBe(200);
    expect(worker.answers).toEqual([0]);
    expect(worker.promptSeat).toBe(1);
    expect(changes.length - before).toBe(1);

    await vi.advanceTimersByTimeAsync(499);
    expect(worker.answers).toEqual([0]);
    await vi.advanceTimersByTimeAsync(1);
    expect(worker.answers).toEqual([0, 1]);
    expect(changes.length - before).toBe(2);

    await vi.advanceTimersByTimeAsync(500);
    expect(worker.answers).toEqual([0, 1, 1]);
    expect(changes.length - before).toBe(3);

    await vi.advanceTimersByTimeAsync(500);
    expect(worker.answers).toEqual([0, 1, 1, 1]);
    expect(changes.length - before).toBe(4);
    expect(worker.promptSeat).toBe(0);

    // The loop is over: nothing more happens and a new human move starts a fresh loop.
    await vi.advanceTimersByTimeAsync(5000);
    expect(worker.answers).toEqual([0, 1, 1, 1]);
    await respond();
    await vi.advanceTimersByTimeAsync(1500);
    expect(worker.answers).toEqual([0, 1, 1, 1, 0, 1, 1, 1]);
  });

  it("runs a single loop per duel even when viewers keep polling", async () => {
    vi.useFakeTimers();
    const { worker, respond, host, base } = await setup({ botStepDelayMs: () => 500 });
    await respond();
    for (let i = 0; i < 5; i++) {
      expect((await post(host, { op: "view", ...base })).status).toBe(200);
    }
    await vi.advanceTimersByTimeAsync(499);
    expect(worker.answers).toEqual([0]);
    await vi.advanceTimersByTimeAsync(1);
    // One step after one delay, not one per poll.
    expect(worker.answers).toEqual([0, 1]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(worker.answers).toEqual([0, 1, 1, 1]);
  });

  it("stops when the human surrenders", async () => {
    vi.useFakeTimers();
    const { worker, respond, host, base, duels, slug } = await setup({ botStepDelayMs: () => 500 });
    await respond();
    await vi.advanceTimersByTimeAsync(500);
    expect(worker.answers).toEqual([0, 1]);
    const surrendered = await post(host, { op: "surrender", ...base });
    expect(surrendered.status).toBe(200);
    expect(duels.get(slug, "g1").status).toBe("completed");
    await vi.advanceTimersByTimeAsync(5000);
    expect(worker.answers).toEqual([0, 1]);
    expect(vi.getTimerCount()).toBeLessThanOrEqual(1); // only the host's sweep interval
  });

  it("records the win itself when the bot's move ends the duel", async () => {
    vi.useFakeTimers();
    const { worker, respond, duels, slug } = await setup({ botStepDelayMs: () => 500 });
    worker.onBotAnswer = () => { worker.result = { winnerSeat: 1, reason: "Life points" }; };
    await respond();
    await vi.advanceTimersByTimeAsync(500);
    expect(duels.get(slug, "g1").status).toBe("completed");
    expect(duels.get(slug, "g1").winnerSeat).toBe(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(worker.answers).toEqual([0, 1]);
  });

  it("stops the loop when the host shuts down", async () => {
    vi.useFakeTimers();
    const { worker, respond, host } = await setup({ botStepDelayMs: () => 500 });
    await respond();
    await host.close();
    await vi.advanceTimersByTimeAsync(5000);
    expect(worker.answers).toEqual([0]);
  });

  it("accepts a function of the prompt and never lets a failing bot crash the process", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const seen: string[] = [];
    const { worker, respond, duels, slug } = await setup({
      botStepDelayMs: (prompt) => { seen.push(prompt.id); return 250; },
    });
    worker.answer = async () => { throw new Error("illegal choice"); };
    // Human answer itself must succeed, so only fail the bot's answers.
    const original = BotWorker.prototype.answer.bind(worker);
    worker.answer = async (seat, promptId, answer) => {
      if (seat === 1) throw new Error("illegal choice");
      await original(seat, promptId, answer);
    };
    await respond();
    await vi.advanceTimersByTimeAsync(250);
    expect(seen).toEqual(["p2"]);
    expect(duels.get(slug, "g1").status).toBe("interrupted");
    expect(warn).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5000);
    expect(worker.answers).toEqual([0]);
  });

  it("paces a numeric delay by action (phase moves take about 0.6x the base)", async () => {
    vi.useFakeTimers();
    const { worker, respond } = await setup({ botStepDelayMs: 1000 });
    await respond();
    await vi.advanceTimersByTimeAsync(500);
    expect(worker.answers).toEqual([0]);
    await vi.advanceTimersByTimeAsync(200);
    expect(worker.answers).toEqual([0, 1]);
  });

  it("scales pauses by action and stays human-paced", () => {
    const mid = () => 0.5;
    expect(practiceBotDelay(900, 1, mid)).toBe(900);
    expect(practiceBotDelay(900, 1.5, mid)).toBe(1350);
    expect(practiceBotDelay(900, 0.6, mid)).toBe(540);
    expect(practiceBotDelay(900, 1, () => 0)).toBeGreaterThanOrEqual(790);
    expect(practiceBotDelay(900, 1, () => 1)).toBeLessThanOrEqual(1010);
    expect(practiceBotDelay(0, 1)).toBe(0);
  });
});
