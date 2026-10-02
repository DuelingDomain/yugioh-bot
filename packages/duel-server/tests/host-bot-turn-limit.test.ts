import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "@yugidraft/shared/db";
import type { DuelAnswer, DuelCardInfo, DuelEngineView, DuelPrompt } from "@yugidraft/shared/duels";
import { createDuelService } from "@yugidraft/shared/services";
import { createDuelHost, type DuelHost } from "../src/host.js";
import { buildPracticeBotDeck } from "../src/practice-bot.js";
import type { DuelGameWorker, GameOptions } from "../src/worker-client.js";
import { engineDataDirectory as DATA } from "./engine-data-dir.js";

// A table where only bots are left (every human gave up at an N-seat table) plays on for many turns. The stuck-bot limit counts the
// answers of ONE turn: a long duel between bots is not a stuck bot. A bot that never leaves its turn is still stopped.
const SECRET = "bot-long-run-secret";
const BOT_SEAT = 1;

/** The bot holds every prompt. The turn number goes up after `perTurn` answers. The duel ends after `total` answers, or never when total is null. */
class EndlessBotWorker implements DuelGameWorker {
  revision = 1;
  answers = 0;
  private stopped = false;
  constructor(private readonly total: number | null, private readonly perTurn: number, private readonly humanOut = false) {}
  get running() { return !this.stopped; }
  async create(_options: GameOptions) {}
  private result(): DuelEngineView["result"] {
    return this.total !== null && this.answers >= this.total ? { winnerSeat: BOT_SEAT, reason: "LP reached 0" } : null;
  }
  async view(viewer: number | null): Promise<DuelEngineView> {
    // Bound the negative proof so an old host cannot leave this test in an endless loop.
    if (this.humanOut && this.answers >= 1100) throw new Error("Test safety stop: turn cap was not applied");
    const result = this.result();
    const prompt: DuelPrompt | null = !result && viewer === BOT_SEAT
      ? { id: `p${this.revision}`, seat: BOT_SEAT, kind: "choice", title: "Main", options: [{ id: "to_ep", label: "End" }], context: { type: "action", phase: "main" } }
      : null;
    const seat = (index: number) => ({ seat: index, lp: 8000, hand: [], deckCount: 35, extraCount: 0, extra: [], monsters: [], spells: [], graveyard: [], banished: [] });
    return {
      revision: this.revision,
      turn: 1 + Math.floor(this.answers / this.perTurn),
      turnSeat: BOT_SEAT,
      phase: "main1",
      seats: [{ ...seat(0), eliminated: this.humanOut }, seat(1)],
      prompt,
      chain: [],
      events: [{ id: this.revision, kind: "phase", text: "x" }],
      log: [],
      result,
    };
  }
  async answer(_seat: number, _promptId: string, _answer: DuelAnswer) {
    this.answers += 1;
    this.revision += 1;
  }
  async eliminate(_seat: number, _reason: number) {}
  async search(_query: string): Promise<DuelCardInfo[]> { return []; }
  async close() { this.stopped = true; }
}

/** Every view invalidates the previous plan, so the bot cannot send an answer. */
class ReplanningBotWorker extends EndlessBotWorker {
  constructor() { super(null, 5); }
  override async view(viewer: number | null) {
    const view = await super.view(viewer);
    this.revision += 1;
    return view;
  }
}

const hosts: DuelHost[] = [];
afterEach(async () => {
  vi.useRealTimers();
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

async function table(worker: EndlessBotWorker, botStepDelayMs: number) {
  const db = new Database(":memory:");
  migrate(db);
  const player = Number(db.prepare("insert into players (guild_id, discord_user_id, display_name) values (?, ?, ?)").run("g1", "u1", "Yugi").lastInsertRowid);
  const duels = createDuelService(db);
  const session = duels.create({ guildId: "g1", organizerPlayerId: player, name: "Duel", mode: "normal" });
  duels.setDeck(session.slug, "g1", player, buildPracticeBotDeck("normal", DATA));
  const host = createDuelHost({ db, dataDirectory: DATA, secret: SECRET, searchCards: () => [], pollIntervalMs: 60_000, createWorker: () => worker, botStepDelayMs, stallMs: 0 });
  hosts.push(host);
  const base = { slug: session.slug, guildId: "g1", playerId: player };
  expect((await post(host, { op: "add-bot", ...base })).status).toBe(200);
  return { duels, host, base, slug: session.slug };
}

describe("bots that play a long duel on their own", () => {
  it("paced: stops after 32 consecutive plans that no longer match", async () => {
    vi.useFakeTimers();
    const worker = new ReplanningBotWorker();
    const t = await table(worker, 1);
    expect((await post(t.host, { op: "start", ...t.base })).status).toBe(200);
    await vi.advanceTimersByTimeAsync(31);
    expect(t.duels.get(t.slug, "g1").status).toBe("active");
    expect(worker.running).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    const session = t.duels.get(t.slug, "g1");
    expect(session.status).toBe("interrupted");
    expect(session.winnerSeat).toBeNull();
    expect(session.resultReason).toBe("The practice bot could not keep a valid plan.");
    expect(worker.answers).toBe(0);
    expect(worker.running).toBe(false);
    expect(vi.getTimerCount()).toBe(1);
  });

  it.each([0, 1])("delay %i: stops an endless duel at turn 200 when no human is living", async (delay) => {
    vi.useFakeTimers();
    const worker = new EndlessBotWorker(null, 5, true);
    const t = await table(worker, delay);
    const started = await post(t.host, { op: "start", ...t.base });
    expect(started.status, JSON.stringify(started.data)).toBe(200);
    if (delay) await vi.advanceTimersByTimeAsync(1500);
    const session = t.duels.get(t.slug, "g1");
    expect(session.status).toBe("interrupted");
    expect(session.winnerSeat).toBeNull();
    expect(session.resultReason).toBe("No human seat is living. The duel reached the limit of 200 turns.");
    expect(worker.answers).toBe(995);
    expect(worker.running).toBe(false);
    expect(vi.getTimerCount()).toBe(1); // Only the host sweep remains.
  });

  it.each([0, 1])("delay %i: a living human keeps a duel open beyond turn 200", async (delay) => {
    vi.useFakeTimers();
    const worker = new EndlessBotWorker(1100, 5);
    const t = await table(worker, delay);
    expect((await post(t.host, { op: "start", ...t.base })).status).toBe(200);
    if (delay) await vi.advanceTimersByTimeAsync(1500);
    expect(t.duels.get(t.slug, "g1").status).toBe("completed");
    expect(worker.answers).toBe(1100);
  });

  it("unpaced: 400 answers over many turns end the duel, not a 500", async () => {
    const worker = new EndlessBotWorker(400, 5);
    const t = await table(worker, 0);
    const started = await post(t.host, { op: "start", ...t.base });
    expect(started.status, JSON.stringify(started.data)).toBe(200);
    expect(worker.answers).toBe(400);
    const session = t.duels.get(t.slug, "g1");
    expect(session.status).toBe("completed");
    expect(session.winnerSeat).toBe(BOT_SEAT);
  });

  it("unpaced: a bot that never leaves its turn is still stopped after the limit", async () => {
    const worker = new EndlessBotWorker(null, Number.MAX_SAFE_INTEGER);
    const t = await table(worker, 0);
    const started = await post(t.host, { op: "start", ...t.base });
    expect(started.status).toBe(500);
    expect(started.data.error).toMatch(/failed to make progress/);
    expect(worker.answers).toBe(128);
  });

  it("paced: 400 answers over many turns end the duel, the table is not interrupted", async () => {
    const worker = new EndlessBotWorker(400, 5);
    const t = await table(worker, 1);
    expect((await post(t.host, { op: "start", ...t.base })).status).toBe(200);
    const deadline = Date.now() + 30_000;
    while (t.duels.get(t.slug, "g1").status === "active" && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      await post(t.host, { op: "view", ...t.base });
    }
    const session = t.duels.get(t.slug, "g1");
    expect(session.status).toBe("completed");
    expect(worker.answers).toBe(400);
  }, 40_000);

  it("paced: a bot that never leaves its turn interrupts the table after the limit", async () => {
    const worker = new EndlessBotWorker(null, Number.MAX_SAFE_INTEGER);
    const t = await table(worker, 1);
    expect((await post(t.host, { op: "start", ...t.base })).status).toBe(200);
    const deadline = Date.now() + 30_000;
    while (t.duels.get(t.slug, "g1").status === "active" && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(t.duels.get(t.slug, "g1").status).not.toBe("active");
    expect(worker.answers).toBe(128);
  }, 40_000);
});
