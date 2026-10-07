import { seedIdentity, seedUser } from "./helpers/identity.js";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, expect, it } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "@yugidraft/shared/db";
import { defaultDuelSettings, type DuelAnswer, type DuelCardInfo, type DuelEngineView, type DuelFormat } from "@yugidraft/shared/duels";
import { createDuelService } from "@yugidraft/shared/services";
import type { DuelHost } from "../src/host.js";
import { createTestDuelHost as createDuelHost, finishTestDiceOpening } from "./support/test-opening.js";
import { createEngineGame, type EngineGame } from "../src/engine.js";
import { buildPracticeBotDeck } from "../src/practice-bot.js";
import type { DuelGameWorker, GameOptions } from "../src/worker-client.js";
import { engineDataDirectory as DATA } from "./engine-data-dir.js";
import { currentMultiWasm, describeWithCores, needs } from "./support/cores.js";

// Real-engine host tests at FFA4 (surrender of the last seats, surrender by the turn player, bots that play to the end).
// The worker below runs the real engine in this process, on a multi core that has Debug.EliminateDuelist.
const multiWasmPath = currentMultiWasm();
const SECRET = "ffa4-real-secret";

class RealEngineWorker implements DuelGameWorker {
  game: EngineGame | null = null;
  answers = 0;
  private stopped = false;
  get running() { return !this.stopped; }
  async create(options: GameOptions) {
    const bytes = readFileSync(multiWasmPath);
    const multiWasmBinary = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    this.game = await createEngineGame({ ...options, seed: ["1", "2", "3", "4"], multiWasmBinary });
  }
  async view(seat: number | null) { return this.game!.view(seat); }
  async answer(seat: number, promptId: string, answer: DuelAnswer) {
    this.game!.answer(seat, promptId, answer);
    this.answers += 1;
  }
  async eliminate(seat: number, reason: number, atTurnEnd = false) { this.game!.eliminate(seat, reason, atTurnEnd); }
  async search(query: string): Promise<DuelCardInfo[]> { return this.game!.searchCards(query); }
  async close() {
    this.stopped = true;
    this.game?.close();
  }
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

function makeHost(db: Database.Database, worker: DuelGameWorker, extra: { botStepDelayMs?: number } = {}): DuelHost {
  const host = createDuelHost({ db, dataDirectory: DATA, secret: SECRET, searchCards: () => [], pollIntervalMs: 60_000, createWorker: () => worker, ...extra });
  hosts.push(host);
  return host;
}

/** A table of humans in seats 0..humans-1; the other seats get a practice bot. */
async function table(format: DuelFormat, humans: number, botSeats: number[] = [], extra: { botStepDelayMs?: number; startingLP?: number } = {}) {
  const db = new Database(":memory:");
  migrate(db);
  const players: number[] = [];
  for (let index = 0; index < humans; index += 1) {
    players.push(seedIdentity(db, { guildId: "g1", name: `P${index}`, userId: seedUser(db, `u${index}`).userId, discordUserId: seedUser(db, `u${index}`).discordUserId ?? `u${index}` }).playerId);
  }
  const duels = createDuelService(db);
  const session = duels.create({ guildId: "g1", organizerPlayerId: players[0]!, name: "Duel", mode: "normal", format, settings: { ...defaultDuelSettings("normal"), startingLP: extra.startingLP ?? 8000 } });
  const worker = new RealEngineWorker();
  const host = makeHost(db, worker, extra);
  const organizer = { slug: session.slug, guildId: "g1", playerId: players[0]! };
  for (const seat of botSeats) expect((await post(host, { op: "add-bot", ...organizer, seat })).status).toBe(200);
  for (const player of players.slice(1)) duels.takeSeat(session.slug, "g1", player);
  const deck = buildPracticeBotDeck("normal", DATA);
  for (const player of players) duels.setDeck(session.slug, "g1", player, deck);
  const view = async (seat: number) => (await post(host, { op: "view", slug: session.slug, guildId: "g1", playerId: players[seat] ?? players[0] })).data.engine as DuelEngineView;
  const surrender = (seat: number) => post(host, { op: "surrender", slug: session.slug, guildId: "g1", playerId: players[seat] });
  const holder = async (seats: number): Promise<number | null> => {
    for (let seat = 0; seat < seats; seat += 1) if ((await view(seat)).prompt) return seat;
    return null;
  };
  return { db, duels, host, worker, players, organizer, slug: session.slug, view, surrender, holder };
}

const state = (view: DuelEngineView) => view.seats.map((seat) => (seat.eliminated ? "out" : seat.pendingElimination ? "pending" : "in"));

describeWithCores("FFA4 host with the real engine", [needs.multi(multiWasmPath), needs.installedMulti(DATA)], () => {
  it("the other seats surrender and the holder wins at once", async () => {
    const t = await table("ffa4", 4);
    expect((await post(t.host, { op: "start", ...t.organizer })).status).toBe(200);
    expect(await t.holder(4)).toBe(0);
    // p3 and p2 give up: p0 and p1 are the last two seats. The duel goes on.
    expect((await t.surrender(3)).status).toBe(200);
    expect((await t.surrender(2)).status).toBe(200);
    expect(t.duels.get(t.slug, "g1").status).toBe("active");
    const middle = await t.view(0);
    expect(state(middle)).toEqual(["in", "in", "out", "out"]);
    expect(middle.result ?? null).toBeNull();
    expect(middle.prompt?.seat).toBe(0);
    // p1 gives up too. The last living seat wins without another answer.
    expect((await t.surrender(1)).status).toBe(200);
    const session = t.duels.get(t.slug, "g1");
    expect(session.status).toBe("completed");
    expect(session.winnerSeat).toBe(0);
    const end = await t.view(0);
    expect(end.result).toMatchObject({ winnerSeat: 0 });
    expect(end.prompt ?? null).toBeNull();
    // A second surrender of a seat that is out is refused or has no effect, and the winner stays.
    await t.surrender(2);
    expect(t.duels.get(t.slug, "g1").winnerSeat).toBe(0);
  }, 60_000);

  it("the turn player gives up: the loss lands, the turn goes to p1, and the duel goes on for p1, p2 and p3", async () => {
    const t = await table("ffa4", 4);
    expect((await post(t.host, { op: "start", ...t.organizer })).status).toBe(200);
    expect(await t.holder(4)).toBe(0);
    expect((await t.surrender(0)).status).toBe(200);
    const views = await Promise.all([0, 1, 2, 3].map((seat) => t.view(seat)));
    expect(t.duels.get(t.slug, "g1").status).toBe("active");
    expect(state(views[1]!)).toEqual(["out", "in", "in", "in"]);
    expect(views[1]!.result ?? null).toBeNull();
    // The turn passed to the next living seat and it holds the open prompt.
    expect(views[1]!.turnSeat).toBe(1);
    expect(views[1]!.prompt?.seat).toBe(1);
    expect(views[0]!.prompt ?? null).toBeNull();
    expect(views[2]!.prompt ?? null).toBeNull();
    expect(views[3]!.prompt ?? null).toBeNull();
    // p1 can play on: it ends the turn and p2 gets the turn.
    const answered = await post(t.host, {
      op: "respond", slug: t.slug, guildId: "g1", playerId: t.players[1],
      command: { promptId: views[1]!.prompt!.id, revision: views[1]!.revision, answer: { choice: "to_ep" } },
    });
    expect(answered.status).toBe(200);
    expect(await t.holder(4)).toBe(2);
    expect((await t.view(2)).turnSeat).toBe(2);
  }, 60_000);

  it("three bots play on after the human gave up, and the duel ends with one winner", async () => {
    const t = await table("ffa4", 1, [1, 2, 3], { botStepDelayMs: 0, startingLP: 16000 });
    expect((await post(t.host, { op: "start", ...t.organizer })).status).toBe(200);
    const gaveUp = await t.surrender(0);
    expect(gaveUp.data, JSON.stringify(gaveUp.data)).toMatchObject({});
    expect(gaveUp.status, JSON.stringify(gaveUp.data)).toBe(200);
    const deadline = Date.now() + 90_000;
    let status = t.duels.get(t.slug, "g1").status;
    while (status !== "completed" && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      await t.view(0);
      status = t.duels.get(t.slug, "g1").status;
    }
    expect(status).toBe("completed");
    // Higher starting LP keeps the real duel open past the old per-call cap.
    expect(t.worker.answers, `Answers: ${t.worker.answers}`).toBeGreaterThan(128);
    const view = await t.view(0);
    // Exactly one seat is left, it is the winner, the seat of the human is out (it gave up) and no prompt is open.
    const living = state(view).flatMap((entry, seat) => (entry === "in" ? [seat] : []));
    expect(living).toHaveLength(1);
    expect(living[0]).not.toBe(0);
    expect(state(view)[0]).toBe("out");
    expect(view.result?.winnerSeat).toBe(living[0]);
    expect(t.duels.get(t.slug, "g1").winnerSeat).toBe(living[0]);
    expect(view.prompt ?? null).toBeNull();
  }, 120_000);
});
