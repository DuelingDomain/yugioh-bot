import { createHmac } from "node:crypto";
import { rmSync } from "node:fs";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { createDuelService } from "@yugidraft/shared/services";
import { seatCountFor, type DuelAnswer, type DuelEngineView, type DuelFormat } from "@yugidraft/shared/duels";
import { EngineResourceCache } from "../src/engine-resource-cache.js";
import { createDuelHost, type DuelHost } from "../src/host.js";
import type { DuelGameWorker, GameOptions } from "../src/worker-client.js";
import { createTestDuelHost, finishTestDiceOpening } from "./support/test-opening.js";
import { createHostDataFixture } from "./helpers/host-data-fixture.js";

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
  const dir = createHostDataFixture(Array.from({ length: 4 }, (_, i) => ({ code: i + 1, name: `Test ${i + 1}` })));
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
  return { db, duels, players, slug: session.slug, workers, rollDie, changes, post };
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
    await vi.waitFor(() => expect(t.duels.get(t.slug, "g").status).toBe("active"));
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
    await vi.waitFor(() => expect(t.duels.get(t.slug, "g").status).toBe("active"));
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
    await vi.waitFor(() => expect(t.duels.privateState(t.slug, "g").commands[0]?.seat).toBe(0));
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
    await vi.waitFor(() => expect(t.duels.openingState(t.slug, "g")).toBeNull());
    expect(t.duels.get(t.slug, "g").status).toBe("lobby");
    expect(t.duels.openingState(t.slug, "g")).toBeNull();
    expect(t.duels.get(t.slug, "g").seats[0]?.playerId).toBe(t.players[2]);
    t.rollDie.mockReturnValueOnce(1).mockReturnValueOnce(6).mockReturnValueOnce(2);
    expect((await t.post("start")).data.opening.rounds).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(3000);
    await vi.waitFor(() => expect(t.duels.get(t.slug, "g").status).toBe("active"));
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
      await vi.waitFor(() => expect(t.duels.get(t.slug, "g").status).toBe("active"));
    }
  });
});



describe("lobby resource preparation", () => {
  it.each(["ffa4", "ffa3", "tag", "1v1"] as const)("returns a %s lobby while resource preparation is pending", async (format) => {
    const t = table(format, [6, 4, 2, 1]);
    const get = vi.spyOn(EngineResourceCache.prototype, "get").mockReturnValue(new Promise(() => {}));
    const room = await t.post("view");
    expect(room.status).toBe(200);
    expect(room.data.session.status).toBe("lobby");
    expect(room.data.engine).toBeNull();
    expect(t.workers).toHaveLength(0);
    expect(get).toHaveBeenCalledWith(resources.at(-1)!.dir, { mode: "normal", format,
      engine: format === "1v1" ? "legacy" : undefined });
    await t.post("view");
    expect(get).toHaveBeenCalledTimes(1);
  });
});


describe("startup room signal", () => {
  it.each(["ffa4", "ffa3", "tag", "1v1"] as const)("reports a pending %s start without waiting or exposing other decks", async (format) => {
    vi.useFakeTimers();
    const t = table(format, [6, 4, 2, 1]);
    t.db.prepare("update duels set settings_json = json_set(settings_json, '$.visibility', 'private') where web_slug = ?").run(t.slug);
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const creating = new Promise<void>(resolve => { entered = resolve; });
    const create = Worker.prototype.create;
    vi.spyOn(Worker.prototype, "create").mockImplementation(async function(this: Worker, options) {
      entered(); await gate; await create.call(this, options);
    });
    const start = t.post("start");
    if (format === "ffa3" || format === "ffa4") await start;
    try {
      await vi.advanceTimersByTimeAsync(3000);
      await creating;
      let seen: Awaited<ReturnType<typeof t.post>> | undefined;
      const read = t.post("view").then(value => { seen = value; });
      await vi.advanceTimersByTimeAsync(10);
      expect(seen?.status).toBe(200);
      expect(seen?.data).toMatchObject({ starting: true, engine: null, session: { status: "lobby" },
        myDeck: { main: Array(40).fill(1), extra: [], side: [] } });
      expect(JSON.stringify(seen?.data)).not.toContain("seed");
      const otherSeat = await t.post("view", t.players[1]!);
      expect(otherSeat.data.myDeck.main).toEqual(Array(40).fill(2));
      for (const override of [{ as: 0 }, { reveal: true }]) {
        expect((await t.post("view", t.players[0]!, override)).status).toBe(400);
      }
      expect((await t.post("view", t.players[0]!, { guildId: "other" })).status).toBe(404);
      expect((await t.post("view", t.players.at(-1)!)).status).toBe(403);
      let spectatorDone = false;
      const spectator = t.post("view", t.players[0]!, { spectate: true }).then(value => { spectatorDone = true; return value; });
      await vi.advanceTimersByTimeAsync(10);
      expect(spectatorDone).toBe(false);
      release(); await start; await read;
      expect((await spectator).status).toBe(409);
      const active = await t.post("view");
      expect(active.data.session.status).toBe("active");
      expect(active.data.starting).toBeUndefined();
      expect(t.workers).toHaveLength(1);
    } finally { release(); await start; }
  });

  it.each(["ffa3", "tag"] as const)("clears the %s signal and notifies readers after a failed worker start", async (format) => {
    vi.useFakeTimers();
    const t = table(format, [6, 4, 2]);
    vi.spyOn(Worker.prototype, "create").mockRejectedValueOnce(new Error("Test start failed"));
    const start = await t.post("start");
    if (format === "ffa3") {
      await vi.advanceTimersByTimeAsync(3000);
      await vi.waitFor(() => expect(t.duels.openingState(t.slug, "g")).toBeNull());
    } else expect(start.status).toBe(500);
    const view = await t.post("view");
    expect(view.data.starting).toBeUndefined();
    expect(view.data.session.status).toBe("lobby");
    expect(t.changes.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
