import { signedHeaders } from "./helpers/signed-request.js";
import { seedIdentity, seedUser } from "./helpers/identity.js";
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
  constructor(private readonly failCreate = false, private readonly createGate?: Promise<void>) {}
  async create(options: GameOptions) {
    if (this.failCreate) throw new Error("engine did not start");
    await this.createGate;
    this.createdOptions = options;
  }
  async view(seat: number | null) { return fakeView(seat, this.result); }
  async answer(_seat: number, _promptId: string, _answer: DuelAnswer) {}
  async search(_query: string): Promise<DuelCardInfo[]> { return []; }
  async close() { this.stopped = true; }
}

const hosts: DuelHost[] = [];
afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  while (hosts.length > 0) await hosts.pop()?.close();
});

function setup() {
  const db = new Database(":memory:");
  migrate(db);
  const player = (id: string, name: string) =>
    seedIdentity(db, { guildId: GUILD, name: name, userId: seedUser(db, id).userId, discordUserId: seedUser(db, id).discordUserId ?? id }).playerId;
  return { db, duels: createDuelService(db), series: createDuelSeriesService(db), p1: player("u1", "Yugi"), p2: player("u2", "Kaiba") };
}
type App = ReturnType<typeof setup>;

/** Await timer-driven activation without polling the room or advancing the fake opening clock. */
function startNotice(app: App) {
  let resolveStarted!: () => void;
  const started = new Promise<void>(resolve => { resolveStarted = resolve; });
  return { started, onChange: (slug: string, guildId: string) => {
    if (app.duels.get(slug, guildId).status === "active") resolveStarted();
  } };
}

function openHost(app: App, random: () => number = Math.random, onChange?: (slug: string, guildId: string) => void, pollIntervalMs: number | null = 60 * 60 * 1000) {
  const workers: FakeWorker[] = [];
  let resolveCreating!: () => void;
  const creating = new Promise<void>(resolve => { resolveCreating = resolve; });
  const control = { failCreate: false, createGate: undefined as Promise<void> | undefined, creating };
  const host = createDuelHost({
    db: app.db, dataDirectory: DATA, secret: SECRET, searchCards: () => [],
    archiveAfterMs: 60 * 60 * 1000, idleWorkerMs: 60 * 60 * 1000, pollIntervalMs: pollIntervalMs ?? undefined,
    openingRps: true, random, onChange,
    createWorker: () => {
      const worker = new FakeWorker(control.failCreate, control.createGate);
      workers.push(worker);
      resolveCreating();
      return worker;
    },
  });
  hosts.push(host);
  return { host, workers, control };
}

async function post(host: DuelHost, body: Record<string, unknown>) {
  const raw = JSON.stringify({ guildId: GUILD, ...body });

  const response = await host.handle(new Request("http://localhost/internal/duel", {
    method: "POST", headers: { "content-type": "application/json", ...await signedHeaders(raw, SECRET, "http://localhost/internal/duel", "duel-host") }, body: raw,
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
  app.duels.takeSeat(table.slug, GUILD, app.p2);
  app.duels.setDeck(table.slug, GUILD, app.p1, deckFor());
  app.duels.setDeck(table.slug, GUILD, app.p2, deckFor(true));
  return table.slug;
}

function seatPlayer(app: App, slug: string, seat: number) {
  return app.duels.get(slug, GUILD).seats.find((entry) => entry.seat === seat)?.playerId;
}

describe("rock-paper-scissors opening", () => {
  it.each([
    { winnerSeat: 0, choice: "first" }, { winnerSeat: 0, choice: "second" },
    { winnerSeat: 1, choice: "first" }, { winnerSeat: 1, choice: "second" },
  ] as const)("resolves picks and starts at once for both seats (winner $winnerSeat, $choice)", async ({ winnerSeat, choice }) => {
    vi.useFakeTimers();
    vi.stubEnv("DUEL_1V1_ENGINE", "legacy");
    const startedAt = Date.now();
    const app = setup();
    const changed = vi.fn((slug: string, guildId: string) => app.duels.room(slug, guildId, app.p1));
    const { host, workers } = openHost(app, Math.random, changed);
    const slug = openTable(app);
    const players = [app.p1, app.p2];
    await post(host, { op: "start", slug, playerId: app.p1 });
    changed.mockClear();
    const moves = winnerSeat === 0 ? ["rock", "scissors"] : ["paper", "scissors"];
    await post(host, { op: "opening-pick", slug, playerId: app.p1, move: moves[0] });
    changed.mockClear();
    await post(host, { op: "opening-pick", slug, playerId: app.p2, move: moves[1] });
    expect(changed).toHaveBeenCalledWith(slug, GUILD);
    expect(changed.mock.results.at(-1)?.value.opening?.phase).toBe("choose");
    for (const [seat, playerId] of players.entries()) {
      const view = await post(host, { op: "view", slug, playerId });
      expect(view.status).toBe(200);
      expect(view.data.mySeat).toBe(seat);
      expect(view.data.opening).toMatchObject({ phase: "choose", winnerSeat, reveal: { picks: moves, winnerSeat } });
      expect(Date.parse(view.data.opening.deadlineAt)).toBeGreaterThan(startedAt);
    }
    changed.mockClear();
    const chosen = await post(host, { op: "opening-choose", slug, playerId: players[winnerSeat], choice });
    expect(chosen.status).toBe(200);
    expect(chosen.data.session.status).toBe("active");
    expect(changed).toHaveBeenCalledWith(slug, GUILD);
    expect(changed.mock.results.at(-1)?.value.session.status).toBe("active");
    expect(workers).toHaveLength(1);
    expect(workers[0]!.createdOptions?.engine).toBe("legacy");
    for (const [seat, playerId] of players.entries()) {
      const view = await post(host, { op: "view", slug, playerId });
      const firstSeat = choice === "first" ? winnerSeat : 1 - winnerSeat;
      expect(view.data.mySeat).toBe(seat === firstSeat ? 0 : 1);
      expect(view.data.session.status).toBe("active");
      expect(view.data.opening).toBeNull();
      expect(view.data.engine.turn).toBe(1);
    }
    expect(Date.now()).toBe(startedAt);
  });

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
    const notice = startNotice(app);
    const randoms = [0.5];
    const { host, workers } = openHost(app, () => randoms.shift() ?? 0, notice.onChange);
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
    if (!afterPicks || !("winnerSeat" in afterPicks)) throw new Error("Expected RPS opening");
    expect(afterPicks.winnerSeat).toBe(1);

    await vi.advanceTimersByTimeAsync(34_000);
    await settle();
    await notice.started;
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

  it("chooses for the winning practice bot within 1.5 seconds without a room read or sweep", async () => {
    vi.useFakeTimers();
    const app = setup();
    const notice = startNotice(app);
    // The bot's random pick: index 1 is paper.
    const randoms = [0.5];
    const { host, workers } = openHost(app, () => randoms.shift() ?? 0, notice.onChange);
    const table = app.duels.create({ guildId: GUILD, organizerPlayerId: app.p1, name: "Bot", mode: "normal" });
    app.duels.setDeck(table.slug, GUILD, app.p1, deckFor());
    app.duels.markReady(table.slug, GUILD, app.p1);
    const added = await post(host, { op: "add-bot", slug: table.slug, playerId: app.p1 });
    expect(added.status).toBe(200);

    const start = await post(host, { op: "start", slug: table.slug, playerId: app.p1 });
    expect(start.data.opening.picked).toEqual([false, true]);
    expect(start.data.opening.myPick).toBeNull();

    const lost = await post(host, { op: "opening-pick", slug: table.slug, playerId: app.p1, move: "rock" });
    // Rock loses to paper. The bot won, but the human first gets to see both hands and the result.
    expect(lost.data.session.status).toBe("lobby");
    expect(lost.data.opening.phase).toBe("choose");
    expect(lost.data.opening.winnerSeat).toBe(1);
    expect(lost.data.opening.reveal.picks).toEqual(["rock", "paper"]);
    expect(workers).toHaveLength(0);

    // The human can see the result during the short pause; no host read advances it.
    await vi.advanceTimersByTimeAsync(750);
    expect(app.duels.room(table.slug, GUILD, app.p1).session.status).toBe("lobby");
    expect(workers).toHaveLength(0);

    // The bot's short pause ends, long before the one-hour sweep or the human choice timeout.
    await vi.advanceTimersByTimeAsync(300);
    await settle();
    await notice.started;
    expect(app.duels.get(table.slug, GUILD).status).toBe("active");
    expect(app.duels.get(table.slug, GUILD).seats.find((seat) => seat.seat === 0)?.isBot).toBe(true);
    expect(workers).toHaveLength(1);
  });

  it("invalidates at the bot's choice and again when the first active view is ready", async () => {
    vi.useFakeTimers();
    const app = setup();
    const notice = startNotice(app);
    const changed = vi.fn((slug: string, guildId: string) => {
      notice.onChange(slug, guildId);
      return { slug, guildId, phase: app.duels.openingState(slug, guildId)?.phase ?? null,
        status: app.duels.get(slug, guildId).status };
    });
    const { host, workers, control } = openHost(app, () => 0.5, changed);
    let release!: () => void;
    control.createGate = new Promise<void>((resolve) => { release = resolve; });
    const table = app.duels.create({ guildId: GUILD, organizerPlayerId: app.p1, name: "Bot", mode: "normal" });
    app.duels.setDeck(table.slug, GUILD, app.p1, deckFor());
    app.duels.markReady(table.slug, GUILD, app.p1);
    await post(host, { op: "add-bot", slug: table.slug, playerId: app.p1 });
    await post(host, { op: "start", slug: table.slug, playerId: app.p1 });
    await post(host, { op: "opening-pick", slug: table.slug, playerId: app.p1, move: "rock" });
    changed.mockClear();
    try {
      await vi.advanceTimersByTimeAsync(1_050);
      await control.creating;
      expect(changed.mock.results.map((result) => result.value)).toEqual([
        { slug: table.slug, guildId: GUILD, phase: "start", status: "lobby" },
      ]);
      expect(workers).toHaveLength(1);
      expect(workers[0]!.createdOptions).toBeNull();
      release();
      await notice.started;
      expect(changed.mock.results.map((result) => result.value)).toEqual([
        { slug: table.slug, guildId: GUILD, phase: "start", status: "lobby" },
        { slug: table.slug, guildId: GUILD, phase: null, status: "active" },
      ]);
      const view = await post(host, { op: "view", slug: table.slug, playerId: app.p1 });
      expect(view.data.session.status).toBe("active");
      expect(view.data.engine).not.toBeNull();
    } finally {
      release();
    }
  });

  it("keeps a room view at 750 ms in the bot result pause", async () => {
    vi.useFakeTimers();
    const app = setup();
    const { host, workers } = openHost(app, () => 0.5);
    const table = app.duels.create({ guildId: GUILD, organizerPlayerId: app.p1, name: "Bot", mode: "normal" });
    app.duels.setDeck(table.slug, GUILD, app.p1, deckFor());
    app.duels.markReady(table.slug, GUILD, app.p1);
    await post(host, { op: "add-bot", slug: table.slug, playerId: app.p1 });
    await post(host, { op: "start", slug: table.slug, playerId: app.p1 });
    await post(host, { op: "opening-pick", slug: table.slug, playerId: app.p1, move: "rock" });
    await vi.advanceTimersByTimeAsync(750);
    const view = await post(host, { op: "view", slug: table.slug, playerId: app.p1 });
    expect(view.status).toBe(200);
    expect(view.data.session.status).toBe("lobby");
    expect(view.data.opening).toMatchObject({ phase: "choose", winnerSeat: 1, choice: null });
    expect(view.data.engine).toBeNull();
    expect(workers).toHaveLength(0);
  });

  it.each(["bot", "human"] as const)("serves the saved %s choice while engine creation waits, and keeps mutations queued", async (winner) => {
    vi.useFakeTimers();
    const app = setup();
    const { host, workers, control } = openHost(app, () => 0.5);
    let release!: () => void;
    control.createGate = new Promise<void>((resolve) => { release = resolve; });
    let slug: string;
    if (winner === "bot") {
      const table = app.duels.create({ guildId: GUILD, organizerPlayerId: app.p1, name: "Bot", mode: "normal" });
      slug = table.slug;
      app.duels.setDeck(slug, GUILD, app.p1, deckFor());
      app.duels.markReady(slug, GUILD, app.p1);
      await post(host, { op: "add-bot", slug, playerId: app.p1 });
    } else slug = openTable(app);
    await post(host, { op: "start", slug, playerId: app.p1 });
    await post(host, { op: "opening-pick", slug, playerId: app.p1, move: "rock" });
    let chosen: ReturnType<typeof post> | undefined;
    if (winner === "human") {
      await post(host, { op: "opening-pick", slug, playerId: app.p2, move: "paper" });
      chosen = post(host, { op: "opening-choose", slug, playerId: app.p2, choice: "second" });
    }
    try {
      await vi.advanceTimersByTimeAsync(1_050);
      await control.creating;
      expect(workers).toHaveLength(1);
      expect(workers[0]!.createdOptions).toBeNull();
      let room: Awaited<ReturnType<typeof post>> | undefined;
      const reading = post(host, { op: "view", slug, playerId: app.p1 }).then((value) => { room = value; });
      let mutationDone = false;
      const mutating = post(host, { op: "opening-choose", slug, playerId: app.p1, choice: "first" }).then(() => { mutationDone = true; });
      await settle();
      expect(room?.status).toBe(200);
      expect(room?.data.session.status).toBe("lobby");
      expect(room?.data.opening).toMatchObject({ phase: "start", choice: winner === "bot" ? "first" : "second" });
      expect(room?.data.engine).toBeNull();
      expect(room?.data.myDeck).toEqual(deckFor());
      expect(mutationDone).toBe(false);
      expect(workers).toHaveLength(1);
      // Authentication and guild scoping still apply to reads that skip the engine queue.
      const invalid = await post(host, { op: "view", slug, playerId: 0 });
      expect(invalid.status).toBe(400);
      const wrongGuild = await post(host, { op: "view", slug, guildId: "other", playerId: app.p1 });
      expect(wrongGuild.status).toBe(404);
      release();
      await settle();
      await Promise.all([reading, mutating, chosen]);
      expect(mutationDone).toBe(true);
      const active = await post(host, { op: "view", slug, playerId: app.p1 });
      expect(active.data.session.status).toBe("active");
      expect(active.data.engine).not.toBeNull();
      expect(workers).toHaveLength(1);
    } finally {
      release();
      await chosen;
    }
  });

  it("starts the duel on a room read after the bot's short choice pause if the timer was lost", async () => {
    vi.useFakeTimers();
    const app = setup();
    const randoms = [0.5];
    const { host, workers } = openHost(app, () => randoms.shift() ?? 0);
    const table = app.duels.create({ guildId: GUILD, organizerPlayerId: app.p1, name: "Bot", mode: "normal" });
    app.duels.setDeck(table.slug, GUILD, app.p1, deckFor());
    app.duels.markReady(table.slug, GUILD, app.p1);
    await post(host, { op: "add-bot", slug: table.slug, playerId: app.p1 });
    await post(host, { op: "start", slug: table.slug, playerId: app.p1 });
    await post(host, { op: "opening-pick", slug: table.slug, playerId: app.p1, move: "rock" });
    // The timer is lost (a restart): only the room view can notice the bot's choice is due.
    vi.setSystemTime(Date.now() + 1_050);
    const view = await post(host, { op: "view", slug: table.slug, playerId: app.p1 });
    expect(view.data.session.status).toBe("active");
    expect(workers).toHaveLength(1);
  });

  it.each([1_500, 2_000, 2_500])("schedules an overdue bot choice after a %i ms restart gap with the default poll", async (gap) => {
    vi.useFakeTimers();
    const app = setup();
    const { host } = openHost(app, () => 0.5);
    const table = app.duels.create({ guildId: GUILD, organizerPlayerId: app.p1, name: "Bot", mode: "normal" });
    app.duels.setDeck(table.slug, GUILD, app.p1, deckFor());
    app.duels.markReady(table.slug, GUILD, app.p1);
    await post(host, { op: "add-bot", slug: table.slug, playerId: app.p1 });
    await post(host, { op: "start", slug: table.slug, playerId: app.p1 });
    await post(host, { op: "opening-pick", slug: table.slug, playerId: app.p1, move: "rock" });
    await host.close();
    vi.setSystemTime(Date.now() + gap);
    const notice = startNotice(app);
    const restarted = openHost(app, () => 0.5, notice.onChange, null);
    // The recovery scan must arm an immediate timer, rather than wait for the human deadline.
    await settle();
    await notice.started;
    expect(app.duels.get(table.slug, GUILD).status).toBe("active");
    expect(restarted.workers).toHaveLength(1);
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

  it("does not start a series game again on every room view after a failed start", async () => {
    const app = setup();
    const { host, workers, control } = openHost(app);
    const { duel } = app.series.createChallenge({
      guildId: GUILD, challengerPlayerId: app.p1, opponentPlayerId: app.p2, bestOf: 3, ranked: false, mode: "normal",
    });
    await post(host, { op: "deck", slug: duel.slug, playerId: app.p1, deck: deckFor() });
    await post(host, { op: "deck", slug: duel.slug, playerId: app.p2, deck: deckFor(true) });
    const seat0 = seatPlayer(app, duel.slug, 0)!;
    const seat1 = seatPlayer(app, duel.slug, 1)!;
    await post(host, { op: "opening-pick", slug: duel.slug, playerId: seat0, move: "rock" });
    await post(host, { op: "opening-pick", slug: duel.slug, playerId: seat1, move: "scissors" });
    control.failCreate = true;
    const chosen = await post(host, { op: "opening-choose", slug: duel.slug, playerId: seat0, choice: "first" });
    expect(chosen.data.session.status).toBe("lobby");
    expect(workers).toHaveLength(1);
    // The settled opening is past its deadline, but the start waits out its backoff.
    for (let i = 0; i < 4; i++) await post(host, { op: "view", slug: duel.slug, playerId: seat1 });
    await post(host, { op: "start", slug: duel.slug, playerId: seat1 });
    expect(workers).toHaveLength(1);
    expect(app.duels.openingState(duel.slug, GUILD)?.phase).toBe("start");
  });

  it("frees a table that failed to start after the opening, and shows the error", async () => {
    const app = setup();
    const { host, workers, control } = openHost(app);
    const slug = openTable(app);
    await post(host, { op: "start", slug, playerId: app.p1 });
    await post(host, { op: "opening-pick", slug, playerId: app.p1, move: "rock" });
    await post(host, { op: "opening-pick", slug, playerId: app.p2, move: "scissors" });
    control.failCreate = true;
    const failed = await post(host, { op: "opening-choose", slug, playerId: app.p1, choice: "first" });
    expect(failed.status).toBeGreaterThanOrEqual(400);
    expect(workers).toHaveLength(1);
    expect(app.duels.get(slug, GUILD).status).toBe("lobby");
    expect(app.duels.openingState(slug, GUILD)).toBeNull();
    // The lobby is editable again and the organizer can start over.
    const swapped = await post(host, { op: "deck", slug, playerId: app.p2, deck: deckFor() });
    expect(swapped.status).toBe(200);
    control.failCreate = false;
    const again = await post(host, { op: "start", slug, playerId: app.p1 });
    expect(again.data.opening.phase).toBe("rps");
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

  it("logs one safe timing record per engine start", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const app = setup();
    const { host } = openHost(app);
    const slug = openTable(app);
    try {
      await post(host, { op: "start", slug, playerId: app.p1 });
      expect(info).not.toHaveBeenCalled();
      await post(host, { op: "opening-pick", slug, playerId: app.p1, move: "rock" });
      await post(host, { op: "opening-pick", slug, playerId: app.p2, move: "paper" });
      await post(host, { op: "opening-choose", slug, playerId: app.p2, choice: "first" });
      await post(host, { op: "view", slug, playerId: app.p1 });
      expect(info).toHaveBeenCalledTimes(1);
      const log = JSON.parse(info.mock.calls[0]![0]);
      expect(log).toEqual({
        event: "duel_start", slug, outcome: "ready", totalMs: expect.any(Number),
        resourceChecksMs: expect.any(Number), workerSpawnMs: expect.any(Number),
        cardDbLoadMs: null, engineCreateMs: expect.any(Number), firstViewMs: expect.any(Number),
      });
      expect(JSON.stringify(log)).not.toContain(DATA);
      expect(JSON.stringify(log)).not.toContain(SECRET);
    } finally { info.mockRestore(); }
  });
});
