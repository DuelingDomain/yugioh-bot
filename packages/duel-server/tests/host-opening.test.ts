import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "@yugidraft/shared/db";
import type { DuelAnswer, DuelCardInfo, DuelDeck, DuelEngineView } from "@yugidraft/shared/duels";
import { createDuelSeriesService, createDuelService } from "@yugidraft/shared/services";
import { createDuelHost, type DuelHost } from "../src/host.js";
import { buildPracticeBotDeck } from "../src/practice-bot.js";
import type { DuelGameWorker, GameOptions } from "../src/worker-client.js";
import { engineDataDirectory as DATA } from "./engine-data-dir.js";

const SECRET = "duel-host-opening-secret";
const GUILD = "g1";

function fakeView(viewer: number | null, result: DuelEngineView["result"]): DuelEngineView {
  const seat = (index: number) => ({
    seat: index, lp: 8000, hand: [], deckCount: 35, extraCount: 0, extra: [], monsters: [], spells: [],
    graveyard: [], banished: [],
  });
  return {
    revision: 1, turn: 1, turnSeat: 0, phase: "main1", seats: [seat(0), seat(1)],
    // The practice bot has nothing to answer in these tests.
    prompt: null, chain: [], events: [], log: [], result,
  };
}

class FakeWorker implements DuelGameWorker {
  createdOptions: GameOptions | null = null;
  result: DuelEngineView["result"] = null;
  private stopped = false;
  get running() { return !this.stopped; }
  async create(options: GameOptions) { this.createdOptions = options; }
  async view(seat: number | null) { return fakeView(seat, this.result); }
  async answer(_seat: number, _promptId: string, _answer: DuelAnswer) {}
  async search(_query: string): Promise<DuelCardInfo[]> { return []; }
  async close() { this.stopped = true; }
}

const hosts: DuelHost[] = [];
afterEach(async () => {
  vi.useRealTimers();
  while (hosts.length > 0) await hosts.pop()?.close();
});

function setup() {
  const db = new Database(":memory:");
  migrate(db);
  const player = (id: string, name: string) =>
    Number(db.prepare("insert into players (guild_id, discord_user_id, display_name) values (?, ?, ?)").run(GUILD, id, name).lastInsertRowid);
  return { db, duels: createDuelService(db), series: createDuelSeriesService(db), p1: player("u1", "Yugi"), p2: player("u2", "Kaiba") };
}
type App = ReturnType<typeof setup>;

function openHost(app: App, random: () => number = Math.random) {
  const workers: FakeWorker[] = [];
  const host = createDuelHost({
    db: app.db, dataDirectory: DATA, secret: SECRET, searchCards: () => [],
    archiveAfterMs: 60 * 60 * 1000, idleWorkerMs: 60 * 60 * 1000, pollIntervalMs: 60 * 60 * 1000,
    openingRps: true, random,
    createWorker: () => { const worker = new FakeWorker(); workers.push(worker); return worker; },
  });
  hosts.push(host);
  return { host, workers };
}

async function post(host: DuelHost, body: Record<string, unknown>) {
  const raw = JSON.stringify({ guildId: GUILD, ...body });
  const signature = "sha256=" + createHmac("sha256", SECRET).update(raw).digest("hex");
  const response = await host.handle(new Request("http://localhost/internal/duel", {
    method: "POST", headers: { "content-type": "application/json", "x-announce-signature": signature }, body: raw,
  }));
  let data: any = null;
  try { data = JSON.parse(await response.text()); } catch { data = null; }
  return { status: response.status, data };
}

async function settle() {
  for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(1);
}

function deckFor(reverse = false): DuelDeck {
  const base = buildPracticeBotDeck("normal", DATA);
  return { main: reverse ? [...base.main].reverse() : base.main, extra: [], side: [] };
}

/** An open table with two ready players; p1 is the organizer in seat 0. */
function openTable(app: App) {
  const table = app.duels.create({ guildId: GUILD, organizerPlayerId: app.p1, name: "Table", mode: "normal" });
  app.duels.join(table.slug, GUILD, app.p2);
  app.duels.setDeck(table.slug, GUILD, app.p1, deckFor());
  app.duels.setDeck(table.slug, GUILD, app.p2, deckFor(true));
  return table.slug;
}

function seatPlayer(app: App, slug: string, seat: number) {
  return app.duels.get(slug, GUILD).seats.find((entry) => entry.seat === seat)?.playerId;
}

describe("rock-paper-scissors opening", () => {
  it("holds the duel in the lobby until the players have played", async () => {
    const app = setup();
    const { host, workers } = openHost(app);
    const slug = openTable(app);
    const start = await post(host, { op: "start", slug, playerId: app.p1 });
    expect(start.status).toBe(200);
    expect(start.data.session.status).toBe("lobby");
    expect(start.data.opening.phase).toBe("rps");
    expect(workers).toHaveLength(0);
  });

  it("hides a pick from the other player, then lets the winner choose to go second", async () => {
    const app = setup();
    const { host, workers } = openHost(app);
    const slug = openTable(app);
    await post(host, { op: "start", slug, playerId: app.p1 });

    const first = await post(host, { op: "opening-pick", slug, playerId: app.p1, move: "rock" });
    expect(first.status).toBe(200);
    expect(first.data.opening.myPick).toBe("rock");
    const seen = await post(host, { op: "view", slug, playerId: app.p2 });
    expect(seen.data.opening.myPick).toBeNull();
    expect(JSON.stringify(seen.data.opening)).not.toContain("rock");

    const again = await post(host, { op: "opening-pick", slug, playerId: app.p1, move: "paper" });
    expect(again.status).toBe(409);

    const second = await post(host, { op: "opening-pick", slug, playerId: app.p2, move: "paper" });
    expect(second.data.opening.phase).toBe("choose");
    expect(second.data.opening.winnerSeat).toBe(1);
    expect(second.data.opening.reveal.picks).toEqual(["rock", "paper"]);

    const wrong = await post(host, { op: "opening-choose", slug, playerId: app.p1, choice: "first" });
    expect(wrong.status).toBe(403);

    const chosen = await post(host, { op: "opening-choose", slug, playerId: app.p2, choice: "first" });
    expect(chosen.status).toBe(200);
    expect(chosen.data.session.status).toBe("active");
    expect(workers).toHaveLength(1);
    // The winner (p2) goes first: seat 0, with p2's deck.
    expect(seatPlayer(app, slug, 0)).toBe(app.p2);
    expect(workers[0]!.createdOptions?.decks[0]?.main).toEqual(deckFor(true).main);
    expect(app.duels.openingState(slug, GUILD)).toBeNull();
  });

  it("keeps the organizer in seat 0 when the winner is there and goes first", async () => {
    const app = setup();
    const { host } = openHost(app);
    const slug = openTable(app);
    await post(host, { op: "start", slug, playerId: app.p1 });
    await post(host, { op: "opening-pick", slug, playerId: app.p1, move: "scissors" });
    await post(host, { op: "opening-pick", slug, playerId: app.p2, move: "paper" });
    const chosen = await post(host, { op: "opening-choose", slug, playerId: app.p1, choice: "first" });
    expect(chosen.data.session.status).toBe("active");
    expect(seatPlayer(app, slug, 0)).toBe(app.p1);
  });

  it("replays a tie", async () => {
    const app = setup();
    const { host } = openHost(app);
    const slug = openTable(app);
    await post(host, { op: "start", slug, playerId: app.p1 });
    await post(host, { op: "opening-pick", slug, playerId: app.p1, move: "rock" });
    const tie = await post(host, { op: "opening-pick", slug, playerId: app.p2, move: "rock" });
    expect(tie.data.opening.phase).toBe("rps");
    expect(tie.data.opening.round).toBe(2);
    expect(tie.data.opening.reveal.winnerSeat).toBeNull();
    expect(tie.data.opening.myPick).toBeNull();
  });

  it("makes a missing pick at random after about 30 seconds, and a winner who does not choose goes first", async () => {
    vi.useFakeTimers();
    const app = setup();
    const randoms = [0.5];
    const { host, workers } = openHost(app, () => randoms.shift() ?? 0);
    const slug = openTable(app);
    await post(host, { op: "start", slug, playerId: app.p1 });
    await post(host, { op: "opening-pick", slug, playerId: app.p1, move: "rock" });

    await vi.advanceTimersByTimeAsync(29_000);
    expect(app.duels.openingState(slug, GUILD)?.phase).toBe("rps");
    await vi.advanceTimersByTimeAsync(2_000);
    await settle();
    // The random pick was paper, which beats rock: seat 1 won and now chooses.
    const afterPicks = app.duels.openingState(slug, GUILD);
    expect(afterPicks?.phase).toBe("choose");
    expect(afterPicks?.winnerSeat).toBe(1);

    await vi.advanceTimersByTimeAsync(34_000);
    await settle();
    expect(app.duels.get(slug, GUILD).status).toBe("active");
    expect(workers).toHaveLength(1);
    expect(seatPlayer(app, slug, 0)).toBe(app.p2);
  });

  it("applies a timeout the first time somebody looks at the room", async () => {
    const app = setup();
    const { host } = openHost(app, () => 0);
    const slug = openTable(app);
    await post(host, { op: "start", slug, playerId: app.p1 });
    app.db.prepare("update duels set opening_json = json_set(opening_json, '$.deadline', 1) where web_slug = ?").run(slug);
    const view = await post(host, { op: "view", slug, playerId: app.p2 });
    // Both picks were random zeros (rock): a tie, so round 2.
    expect(view.data.opening.round).toBe(2);
  });

  it("plays against the practice bot: the bot picks at random and goes first when it wins", async () => {
    const app = setup();
    // The bot's random pick: index 1 is paper.
    const randoms = [0.5];
    const { host, workers } = openHost(app, () => randoms.shift() ?? 0);
    const table = app.duels.create({ guildId: GUILD, organizerPlayerId: app.p1, name: "Bot", mode: "normal" });
    app.duels.setDeck(table.slug, GUILD, app.p1, deckFor());
    app.duels.markReady(table.slug, GUILD, app.p1);
    const added = await post(host, { op: "add-bot", slug: table.slug, playerId: app.p1 });
    expect(added.status).toBe(200);

    const start = await post(host, { op: "start", slug: table.slug, playerId: app.p1 });
    expect(start.data.opening.picked).toEqual([false, true]);
    expect(start.data.opening.myPick).toBeNull();

    const won = await post(host, { op: "opening-pick", slug: table.slug, playerId: app.p1, move: "rock" });
    // Rock loses to paper, the bot won and chose to go first: the bot sits in seat 0.
    expect(won.data.session.status).toBe("active");
    expect(won.data.session.seats.find((seat: any) => seat.seat === 0).isBot).toBe(true);
    expect(workers).toHaveLength(1);
  });

  it("lets the human choose after beating the practice bot", async () => {
    const app = setup();
    const randoms = [0];
    const { host } = openHost(app, () => randoms.shift() ?? 0);
    const table = app.duels.create({ guildId: GUILD, organizerPlayerId: app.p1, name: "Bot", mode: "normal" });
    app.duels.setDeck(table.slug, GUILD, app.p1, deckFor());
    app.duels.markReady(table.slug, GUILD, app.p1);
    await post(host, { op: "add-bot", slug: table.slug, playerId: app.p1 });
    await post(host, { op: "start", slug: table.slug, playerId: app.p1 });
    // The bot picked rock; paper wins.
    const result = await post(host, { op: "opening-pick", slug: table.slug, playerId: app.p1, move: "paper" });
    expect(result.data.session.status).toBe("lobby");
    expect(result.data.opening.phase).toBe("choose");
    expect(result.data.opening.winnerSeat).toBe(0);
    const chosen = await post(host, { op: "opening-choose", slug: table.slug, playerId: app.p1, choice: "second" });
    expect(chosen.data.session.status).toBe("active");
    expect(chosen.data.session.seats.find((seat: any) => seat.seat === 1).playerId).toBe(app.p1);
  });

  it("plays the opening for game 1 of a match, and not for game 2", async () => {
    const app = setup();
    const { host, workers } = openHost(app);
    const { duel, series } = app.series.createChallenge({
      guildId: GUILD, challengerPlayerId: app.p1, opponentPlayerId: app.p2, bestOf: 3, ranked: false, mode: "normal",
    });
    await post(host, { op: "deck", slug: duel.slug, playerId: app.p1, deck: deckFor() });
    const ready = await post(host, { op: "deck", slug: duel.slug, playerId: app.p2, deck: deckFor(true) });
    expect(ready.data.session.status).toBe("lobby");
    expect(app.duels.openingState(duel.slug, GUILD)?.phase).toBe("rps");
    const seat0 = seatPlayer(app, duel.slug, 0)!;
    const seat1 = seatPlayer(app, duel.slug, 1)!;
    await post(host, { op: "opening-pick", slug: duel.slug, playerId: seat0, move: "rock" });
    await post(host, { op: "opening-pick", slug: duel.slug, playerId: seat1, move: "scissors" });
    const chosen = await post(host, { op: "opening-choose", slug: duel.slug, playerId: seat0, choice: "first" });
    expect(chosen.data.session.status).toBe("active");
    expect(workers).toHaveLength(1);

    workers[0]!.result = { winnerSeat: 0, reason: "test" };
    await post(host, { op: "view", slug: duel.slug, playerId: seat0 });
    const next = app.series.createNextGame(series.id, GUILD);
    const second = await post(host, { op: "ready", slug: next.slug, playerId: seat0 });
    expect(app.duels.openingState(next.slug, GUILD)).toBeNull();
    expect(second.data.session.status).toBe("active");
  });

  it("starts at once when the opening is switched off", async () => {
    const app = setup();
    const workers: FakeWorker[] = [];
    const host = createDuelHost({
      db: app.db, dataDirectory: DATA, secret: SECRET, searchCards: () => [], pollIntervalMs: 60 * 60 * 1000,
      createWorker: () => { const worker = new FakeWorker(); workers.push(worker); return worker; },
    });
    hosts.push(host);
    const slug = openTable(app);
    const start = await post(host, { op: "start", slug, playerId: app.p1 });
    expect(start.data.session.status).toBe("active");
  });
});
