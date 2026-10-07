import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, expect, it } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "@yugidraft/shared/db";
import type { DuelAnswer, DuelCardInfo, DuelEngineView, DuelFormat } from "@yugidraft/shared/duels";
import { DUEL_CLOCK_INCREMENT_MS, DUEL_OPENING_GRACE_MS } from "@yugidraft/shared/duels";
import { createDuelService } from "@yugidraft/shared/services";
import type { DuelHost } from "../src/host.js";
import { createTestDuelHost as createDuelHost, finishTestDiceOpening } from "./support/test-opening.js";
import { createEngineGame, type EngineGame } from "../src/engine.js";
import { buildPracticeBotDeck } from "../src/practice-bot.js";
import { compileBoard, type BoardSpec } from "../src/presets/board.js";
import type { DuelGameWorker, GameOptions } from "../src/worker-client.js";
import { engineDataDirectory as DATA } from "./engine-data-dir.js";
import { currentMultiWasm, describeWithCores, needs } from "./support/cores.js";

const multiWasmPath = currentMultiWasm();
const SECRET = "clock-pending-secret";

/** The real engine in this process. The board of the test replaces the decks and adds its startup scripts. */
class BoardWorker implements DuelGameWorker {
  game: EngineGame | null = null;
  private stopped = false;
  constructor(private readonly board: BoardSpec) {}
  get running() { return !this.stopped; }
  async create(options: GameOptions) {
    const bytes = readFileSync(multiWasmPath);
    const multiWasmBinary = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const compiled = compileBoard(this.board, DATA).options;
    this.game = await createEngineGame({ ...options, decks: compiled.decks, startupScripts: compiled.startupScripts, multiWasmBinary });
  }
  async view(seat: number | null) { return this.game!.view(seat); }
  async answer(seat: number, promptId: string, answer: DuelAnswer) { this.game!.answer(seat, promptId, answer); }
  async eliminate(seat: number, reason: number) { this.game!.eliminate(seat, reason); }
  async search(query: string): Promise<DuelCardInfo[]> { return this.game!.searchCards(query); }
  async close() { this.stopped = true; this.game?.close(); }
}

const hosts: DuelHost[] = [];
afterEach(async () => {
  while (hosts.length > 0) await hosts.pop()!.close();
});

async function post(host: DuelHost, body: Record<string, unknown>): Promise<{ status: number; data: Record<string, any> }> {
  const raw = JSON.stringify(body);
  const signature = "sha256=" + createHmac("sha256", SECRET).update(raw).digest("hex");
  const response = await host.handle(new Request("http://localhost/internal/duel", {
    method: "POST",
    headers: { "content-type": "application/json", "x-announce-signature": signature },
    body: raw,
  }));
  return finishTestDiceOpening(host, body, { status: response.status, data: (await response.json()) as Record<string, any> },
    (next) => post(host, next));
}

/** A table of humans only, with a clock the test moves by hand. */
async function table(format: DuelFormat, humans: number, board: BoardSpec) {
  const db = new Database(":memory:");
  migrate(db);
  const players: number[] = [];
  for (let index = 0; index < humans; index += 1) {
    players.push(Number(db.prepare("insert into players (guild_id, discord_user_id, display_name) values (?, ?, ?)").run("g1", `u${index}`, `P${index}`).lastInsertRowid));
  }
  const duels = createDuelService(db);
  const session = duels.create({ guildId: "g1", organizerPlayerId: players[0]!, name: "Duel", mode: "normal", format, settings: { turnSeconds: 60, timeout: "loss" } });
  const worker = new BoardWorker(board);
  const time = { now: 1_000_000 };
  const host = createDuelHost({ db, dataDirectory: DATA, secret: SECRET, searchCards: () => [], pollIntervalMs: 60_000, createWorker: () => worker, now: () => time.now });
  hosts.push(host);
  for (const player of players.slice(1)) duels.takeSeat(session.slug, "g1", player);
  const deck = buildPracticeBotDeck("normal", DATA);
  for (const player of players) duels.setDeck(session.slug, "g1", player, deck);
  const organizer = { slug: session.slug, guildId: "g1", playerId: players[0]! };
  const view = async (seat: number) => (await post(host, { op: "view", slug: session.slug, guildId: "g1", playerId: players[seat] })).data.engine as DuelEngineView;
  const clock = () => duels.privateState(session.slug, "g1").clock!;
  return { db, duels, host, worker, time, players, organizer, slug: session.slug, view, clock };
}

/**
 * Draw Phase of FFA4: p0 controls Swords of Revealing Light, p1, p2 and p3 each Set Dust Tornado. The chain window goes
 * to p1, then p2, then p3. A seat that times out while it holds that window is flagged by the core; the loss lands only
 * at the next Adjust, so the window of the next seat opens while the loss is still pending.
 */
const BOARD: BoardSpec = {
  format: "ffa4",
  p0: { hand: ["Heavy Storm"], spells: [{ card: "Swords of Revealing Light", pos: "up" }] },
  p1: { spells: [{ card: "Dust Tornado", pos: "set" }] },
  p2: { spells: [{ card: "Dust Tornado", pos: "set" }] },
  p3: { spells: [{ card: "Dust Tornado", pos: "set" }] },
};
const BANK = 60_000;

describeWithCores("clock after a time-limit loss that is still pending (real engine)", [needs.multi(multiWasmPath), needs.installedMulti(DATA)], () => {
  it("moves the clock to the next prompt seat, and that seat can time out too, until the last seat wins", async () => {
    const t = await table("ffa4", 4, BOARD);
    expect((await post(t.host, { op: "start", ...t.organizer })).status).toBe(200);
    const holders = async () => {
      const out: number[] = [];
      for (let seat = 0; seat < 4; seat += 1) if ((await t.view(seat)).prompt) out.push(seat);
      return out;
    };
    const states = async () => (await t.view(0)).seats.map((seat) => (seat.eliminated ? "out" : seat.pendingElimination ? "pending" : "in"));
    const start = t.time.now;
    expect(await holders()).toEqual([1]);
    expect(t.clock()).toEqual({ turn: 1, remainingMs: [BANK, BANK, BANK, BANK], activeSeat: 1, startedAt: start + DUEL_OPENING_GRACE_MS });

    // p1 holds the chain window and does not answer. The opening grace comes before the bank.
    t.time.now += DUEL_OPENING_GRACE_MS + BANK + 1_000;
    expect(await holders()).toEqual([2]);
    expect(await states()).toEqual(["in", "pending", "in", "in"]);
    // The clock runs for p2 from now on. It is not stuck on the due clock of p1.
    expect(t.clock()).toEqual({ turn: 1, remainingMs: [BANK, 0, BANK, BANK], activeSeat: 2, startedAt: t.time.now });
    expect(t.duels.get(t.slug, "g1").status).toBe("active");

    // p2 is not charged for the time of p1, and a poll a little later does not change the clock.
    t.time.now += 1_000;
    expect(await holders()).toEqual([2]);
    expect(t.clock().activeSeat).toBe(2);
    expect(t.clock().startedAt).toBe(t.time.now - 1_000);

    // p2 does not answer either.
    t.time.now += BANK;
    expect(await holders()).toEqual([3]);
    expect((await states()).map((state) => state === "in")).toEqual([true, false, false, true]);
    expect(t.clock()).toEqual({ turn: 1, remainingMs: [BANK, 0, 0, BANK], activeSeat: 3, startedAt: t.time.now });

    // p3 does not answer: p0 is the last seat, and wins.
    t.time.now += BANK + 1_000;
    await t.view(0);
    const session = t.duels.get(t.slug, "g1");
    expect(session.status).toBe("completed");
    expect(session.winnerSeat).toBe(0);
  }, 60_000);

  it("keeps the clock of a seat that answers after the one that left: only the answering seat is charged", async () => {
    const t = await table("ffa4", 4, BOARD);
    expect((await post(t.host, { op: "start", ...t.organizer })).status).toBe(200);
    t.time.now += DUEL_OPENING_GRACE_MS + BANK + 1_000;
    const v2 = await t.view(2);
    expect(v2.prompt?.seat).toBe(2);
    // p2 answers 10 s after its window opened. The window of p3 opens and the loss of p1 lands.
    t.time.now += 10_000;
    const answered = await post(t.host, {
      op: "respond", slug: t.slug, guildId: "g1", playerId: t.players[2],
      command: { promptId: v2.prompt!.id, revision: v2.revision, answer: { selected: [] } },
    });
    expect(answered.status).toBe(200);
    const clock = t.clock();
    expect(clock.remainingMs).toEqual([BANK, 0, Math.min(BANK, BANK - 10_000 + DUEL_CLOCK_INCREMENT_MS), BANK]);
    expect(clock.activeSeat).toBe(3);
    expect(clock.startedAt).toBe(t.time.now);
    expect(t.duels.get(t.slug, "g1").status).toBe("active");
  }, 60_000);
});
