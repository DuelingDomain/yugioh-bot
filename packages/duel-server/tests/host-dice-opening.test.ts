import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { createDuelService } from "@yugidraft/shared/services";
import { seatCountFor, type DuelAnswer, type DuelEngineView, type DuelFormat } from "@yugidraft/shared/duels";
import { createDuelHost, type DuelHost } from "../src/host.js";
import type { DuelGameWorker, GameOptions } from "../src/worker-client.js";
import { createTestDuelHost, finishTestDiceOpening } from "./support/test-opening.js";

const SECRET = "dice-host-test";
const resources: Array<{ host: DuelHost; db: Database.Database; dir: string }> = [];
afterEach(async () => {
  for (const { host, db, dir } of resources.splice(0)) {
    await host.close(); db.close(); rmSync(dir, { recursive: true, force: true });
  }
  vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks();
});

class Worker implements DuelGameWorker {
  running = true;
  options: GameOptions | null = null;
  revision = 0;
  holder = 0;
  answers: number[] = [];
  async create(options: GameOptions) { this.options = options; }
  async view(viewer: number | null): Promise<DuelEngineView> {
    return {
      revision: this.revision, format: this.options!.format, turn: 1, turnSeat: 0, phase: "main1",
      seats: this.options!.decks.map((_, seat) => ({ seat, lp: 8000, hand: [], deckCount: 40, extraCount: 0,
        extra: [], monsters: [], spells: [], graveyard: [], banished: [] })),
      prompt: viewer === this.holder ? { id: `p${this.revision}`, seat: this.holder, kind: "choice", title: "Main",
        options: [{ id: "to_ep", label: "End" }] } : null,
      prioritySeat: this.holder, chain: [], events: [], log: [], result: null,
    };
  }
  async answer(seat: number, _id: string, _answer: DuelAnswer) {
    this.answers.push(seat); this.revision++; this.holder = (seat + 1) % this.options!.decks.length;
  }
  async search() { return []; }
  async close() { this.running = false; }
}

function table(format: DuelFormat, values: number[], botSeat?: number, keepFixtureSeats = false) {
  vi.stubEnv("MULTIPLAYER_TABLES", "1");
  const dir = mkdtempSync(join(tmpdir(), "host-dice-"));
  writeFileSync(join(dir, "manifest.json"), JSON.stringify({ bundleVersion: "fixture" }));
  // The fake worker never loads a core. This file only satisfies the host's availability check.
  writeFileSync(join(dir, "ocgcore.multi.wasm"), "fake-worker-fixture");
  writeFileSync(join(dir, "strings.conf"), "");
  const cards = new Database(join(dir, "cards.cdb"));
  cards.exec(`create table datas (id integer primary key, ot integer, alias integer, setcode integer, type integer, race integer, attribute integer);
    create table texts (id integer primary key, name text, desc text);`);
  for (let code = 1; code <= 4; code++) {
    cards.prepare("insert into datas values (?, 3, 0, 0, 17, 1, 1)").run(code);
    cards.prepare("insert into texts values (?, ?, '')").run(code, `Test ${code}`);
  }
  cards.close();
  const db = new Database(":memory:"); migrate(db);
  const duels = createDuelService(db);
  const count = seatCountFor(format);
  const players = Array.from({ length: count + 1 }, (_, seat) => Number(db.prepare(
    "insert into players (guild_id, discord_user_id, display_name) values ('g', ?, ?)",
  ).run(`u${seat}`, `Player ${seat}`).lastInsertRowid));
  const session = duels.create({ guildId: "g", organizerPlayerId: players[0]!, name: "Dice", mode: "normal", format,
    settings: { validateDeck: false, turnSeconds: 0 } });
  for (let seat = 0; seat < count; seat++) {
    const deck = { main: Array(40).fill(seat + 1), extra: [], side: [] };
    if (seat === botSeat) duels.addPracticeBot(session.slug, "g", players[0]!, deck, seat);
    else {
      if (seat) duels.takeSeat(session.slug, "g", players[seat]!, seat);
      duels.setDeck(session.slug, "g", players[seat]!, deck);
    }
  }
  const rollDie = vi.fn(() => {
    const value = values.shift();
    if (value === undefined) throw new Error("Unexpected roll");
    return value;
  });
  const workers: Worker[] = [];
  const changes = vi.fn();
  const host = (keepFixtureSeats ? createTestDuelHost : createDuelHost)({ db, dataDirectory: dir, secret: SECRET, searchCards: () => [],
    rollDie: keepFixtureSeats ? undefined : rollDie,
    onChange: changes, pollIntervalMs: 60 * 60 * 1000, createWorker: () => { const worker = new Worker(); workers.push(worker); return worker; } });
  resources.push({ host, db, dir });
  const post = async (op: string, playerId = players[0]!, extra: Record<string, unknown> = {}): Promise<{ status: number; data: Record<string, any> }> => {
    const raw = JSON.stringify({ op, slug: session.slug, guildId: "g", playerId, ...extra });
    const response = await host.handle(new Request("http://localhost/internal/duel", { method: "POST", body: raw,
      headers: { "x-announce-signature": "sha256=" + createHmac("sha256", SECRET).update(raw).digest("hex") } }));
    const result = { status: response.status, data: await response.json() as Record<string, any> };
    return keepFixtureSeats ? finishTestDiceOpening(host, JSON.parse(raw), result,
      (body) => post(String(body.op), playerId, body)) : result;
  };
  return { duels, players, slug: session.slug, workers, rollDie, changes, post };
}

describe("host FFA dice opening", () => {
  it("restarts descending fixture dice for each FFA opening on the same host", async () => {
    const t = table("ffa3", [], undefined, true);
    expect((await t.post("start")).data.session.status).toBe("active");
    for (const format of ["ffa3", "ffa4", "ffa3"] as const) {
      const session = t.duels.create({ guildId: "g", organizerPlayerId: t.players[0]!, name: "Next fixture", mode: "normal", format,
        settings: { validateDeck: false, turnSeconds: 0 } });
      const count = seatCountFor(format);
      for (let seat = 0; seat < count; seat++) {
        if (seat) t.duels.takeSeat(session.slug, "g", t.players[seat]!, seat);
        t.duels.setDeck(session.slug, "g", t.players[seat]!, { main: Array(40).fill(seat + 1), extra: [], side: [] });
      }
      const result = await t.post("start", t.players[0]!, { slug: session.slug });
      expect(result.status, JSON.stringify(result.data)).toBe(200);
      expect(result.data.session.status).toBe("active");
      expect(result.data.session.seats.map((seat: { playerId: number }) => seat.playerId)).toEqual(t.players.slice(0, count));
      expect(t.workers.at(-1)?.options?.decks.map((deck) => deck.main[0])).toEqual(Array.from({ length: count }, (_, seat) => seat + 1));
    }
  });

  it.each(["ffa3", "ffa4"] as const)("starts %s with the rolled player and deck in seat 0 at the last reveal deadline", async (format) => {
    vi.useFakeTimers();
    const t = table(format, format === "ffa3" ? [2, 1, 6] : [2, 1, 6, 4]);
    const at = Date.now();
    const started = await t.post("start");
    expect(started.status).toBe(200);
    expect(started.data).toMatchObject({ session: { status: "lobby" }, opening: { phase: "dice", round: 1 } });
    expect(t.workers).toHaveLength(0);
    await t.post("start");
    expect(t.rollDie).toHaveBeenCalledTimes(seatCountFor(format));
    const watched = await t.post("view", t.players.at(-1)!);
    expect(watched.data.opening.rounds).toEqual(started.data.opening.rounds);
    await vi.advanceTimersByTimeAsync(2999);
    expect(t.workers).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(Date.now()).toBe(at + 3000);
    expect(t.duels.get(t.slug, "g").status).toBe("active");
    expect(t.duels.get(t.slug, "g").seats[0]?.playerId).toBe(t.players[2]);
    expect(t.workers[0]!.options?.decks[0]?.main[0]).toBe(3);
    const winner = await t.post("view", t.players[2]!);
    expect(winner.data).toMatchObject({ mySeat: 0, engine: { turnSeat: 0, prompt: { seat: 0 } }, opening: null });
    expect(t.changes).toHaveBeenCalledWith(t.slug, "g");
  });

  it("shows each tie round for 3 seconds and never lets players pick or choose", async () => {
    vi.useFakeTimers();
    const t = table("ffa4", [6, 6, 2, 2, 1, 2, 6, 5]);
    await t.post("start");
    expect((await t.post("opening-pick", t.players[0]!, { move: "rock" })).status).toBe(409);
    expect((await t.post("opening-choose", t.players[0]!, { choice: "first" })).status).toBe(409);
    await vi.advanceTimersByTimeAsync(3000);
    const next = await t.post("view");
    expect(next.data.opening).toMatchObject({ phase: "dice", round: 2, order: [1, 0, 2, 3] });
    expect(t.workers).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(2999);
    expect(t.workers).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(t.duels.get(t.slug, "g").seats[0]?.playerId).toBe(t.players[1]);
  });

  it("starts after a lost timer when a player reads the overdue opening", async () => {
    vi.useFakeTimers();
    const t = table("ffa3", [1, 6, 3]);
    await t.post("start");
    vi.setSystemTime(Date.now() + 4000);
    const view = await t.post("view", t.players[1]!);
    expect(view.data).toMatchObject({ session: { status: "active" }, mySeat: 0 });
    expect(t.workers).toHaveLength(1);
  });

  it("starts a bot in its new seat and journals its answers there", async () => {
    vi.useFakeTimers();
    const t = table("ffa3", [1, 2, 6], 2);
    await t.post("start");
    await vi.advanceTimersByTimeAsync(3000);
    expect(t.duels.get(t.slug, "g").seats[0]?.isBot).toBe(true);
    expect(t.workers[0]?.answers).toEqual([0]);
    expect(t.duels.privateState(t.slug, "g").commands[0]?.seat).toBe(0);
  });

  it("frees a failed start and rolls fresh dice on the next attempt", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const t = table("ffa3", [1, 2, 6]);
    await t.post("start");
    vi.spyOn(Worker.prototype, "create").mockRejectedValueOnce(new Error("Test start failed"));
    await vi.advanceTimersByTimeAsync(3000);
    expect(t.duels.get(t.slug, "g").status).toBe("lobby");
    expect(t.duels.openingState(t.slug, "g")).toBeNull();
    expect(t.duels.get(t.slug, "g").seats[0]?.playerId).toBe(t.players[2]);
    t.rollDie.mockReturnValueOnce(1).mockReturnValueOnce(6).mockReturnValueOnce(2);
    expect((await t.post("start")).data.opening.rounds).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(3000);
    expect(t.duels.get(t.slug, "g").status).toBe("active");
    expect(t.duels.get(t.slug, "g").seats[0]?.playerId).toBe(t.players[1]);
  });

  it("keeps Tag immediate and gives each new FFA table fresh dice", async () => {
    vi.useFakeTimers();
    const tag = table("tag", []);
    expect((await tag.post("start")).data.session.status).toBe("active");
    expect(tag.rollDie).not.toHaveBeenCalled();
    for (let game = 0; game < 2; game++) {
      const t = table("ffa3", [1, 6, 3]);
      expect((await t.post("start")).data.opening.rounds).toHaveLength(1);
      expect(t.rollDie).toHaveBeenCalledTimes(3);
      await vi.advanceTimersByTimeAsync(3000);
    }
  });
});
