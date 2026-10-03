import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import { migrate } from "../../src/db/index.js";
import type { DuelDeck, DuelEngineView, DuelSession } from "../../src/duels/index.js";
import { createDuelSeriesService, createSeriesStore, SERIES_SIDE_WINDOW_MS } from "../../src/services/duel-series.js";
import { createDuelService, DuelServiceError } from "../../src/services/duels.js";
import { createTournamentDuelService, TournamentDuelError } from "../../src/services/tournament-duels.js";
import { createTournamentService } from "../../src/services/tournaments.js";

function insertPlayer(db: Database.Database, guildId: string, discordUserId: string, displayName: string) {
  return Number(
    db.prepare("insert into players (guild_id, discord_user_id, display_name) values (?, ?, ?)").run(guildId, discordUserId, displayName)
      .lastInsertRowid,
  );
}

function validDeck(start = 1, side = 2): DuelDeck {
  return {
    main: Array.from({ length: 40 }, (_, index) => start + index),
    extra: [start + 100, start + 101],
    side: Array.from({ length: side }, (_, index) => start + 200 + index),
  };
}

function setup() {
  const db = new Database(":memory:");
  migrate(db);
  const p1 = insertPlayer(db, "g1", "u1", "Yugi");
  const p2 = insertPlayer(db, "g1", "u2", "Kaiba");
  const p3 = insertPlayer(db, "g1", "u3", "Joey");
  const outsider = insertPlayer(db, "g2", "u9", "Marik");
  return {
    db,
    duels: createDuelService(db),
    series: createDuelSeriesService(db),
    tournaments: createTournamentService(db),
    p1,
    p2,
    p3,
    outsider,
  };
}

type App = ReturnType<typeof setup>;

function expectStatus(work: () => unknown, status: number) {
  try {
    work();
  } catch (error) {
    expect(error).toBeInstanceOf(DuelServiceError);
    expect((error as DuelServiceError).status).toBe(status);
    return;
  }
  throw new Error(`expected status ${status}`);
}

function seatOf(session: DuelSession, playerId: number): number {
  const seat = session.seats.find((entry) => entry.playerId === playerId);
  if (!seat) throw new Error("player has no seat");
  return seat.seat;
}

function start(app: App, slug: string, actor: number | null = null) {
  return app.duels.activate(slug, "g1", actor, ["s"], "v", null);
}

/** Starts a game, then ends it: winner null = draw. */
function playGame(app: App, slug: string, winnerPlayerId: number | null) {
  const before = app.duels.get(slug, "g1");
  start(app, slug);
  const winnerSeat = winnerPlayerId === null ? null : seatOf(before, winnerPlayerId);
  return app.duels.complete(slug, "g1", winnerSeat, "done");
}

function challenge(app: App, bestOf: 1 | 3, ranked = false) {
  const started = app.series.createChallenge({
    guildId: "g1",
    challengerPlayerId: app.p1,
    opponentPlayerId: app.p2,
    bestOf,
    ranked,
    mode: "normal",
  });
  app.duels.setDeck(started.duel.slug, "g1", app.p1, validDeck(1));
  app.duels.setDeck(started.duel.slug, "g1", app.p2, validDeck(1000));
  return started;
}

function matchRows(app: App) {
  return app.db.prepare("select * from matches").all() as Array<Record<string, any>>;
}

function awardCount(app: App) {
  return (app.db.prepare("select count(*) as c from point_awards").get() as { c: number }).c;
}

function seriesRow(app: App, seriesId: number) {
  return app.db.prepare("select * from duel_series where id = ?").get(seriesId) as Record<string, any>;
}

describe("createChallenge", () => {
  it("makes a private game 1 with both seats taken and no decks", () => {
    const app = setup();
    const { series, duel, created } = app.series.createChallenge({
      guildId: "g1",
      challengerPlayerId: app.p1,
      opponentPlayerId: app.p2,
      bestOf: 3,
      ranked: true,
      mode: "normal",
      settings: { visibility: "public" },
    });
    expect(created).toBe(true);
    expect(series).toMatchObject({
      bestOf: 3,
      ranked: true,
      status: "active",
      wins: [0, 0],
      gameNumber: 1,
      currentDuelSlug: duel.slug,
      playerIds: [app.p1, app.p2],
      displayNames: ["Yugi", "Kaiba"],
      tournamentId: null,
    });
    expect(duel.settings.visibility).toBe("private");
    expect(duel.organizerPlayerId).toBe(app.p1);
    expect(duel.seriesId).toBe(series.id);
    expect(duel.gameNumber).toBe(1);
    expect(duel.bestOf).toBe(3);
    expect(duel.ranked).toBe(true);
    expect(duel.seats.map((seat) => seat.playerId).sort()).toEqual([app.p1, app.p2].sort());
    expect(duel.seats.every((seat) => !seat.ready)).toBe(true);
    const row = app.db.prepare("select invite_code from duels where id = ?").get(duel.id) as { invite_code: string | null };
    expect(row.invite_code).toBeTruthy();
    // The named opponent already has a seat; entry preserves it.
    expect(app.duels.room(duel.slug, "g1", app.p2).session.seats).toHaveLength(2);
    expect(app.series.forDuel(duel.id)?.id).toBe(series.id);
  });

  it("rejects bad input", () => {
    const app = setup();
    const base = { guildId: "g1", challengerPlayerId: app.p1, opponentPlayerId: app.p2, bestOf: 1 as const, ranked: false, mode: "normal" as const };
    expectStatus(() => app.series.createChallenge({ ...base, opponentPlayerId: app.p1 }), 400);
    expectStatus(() => app.series.createChallenge({ ...base, opponentPlayerId: app.outsider }), 400);
    expectStatus(() => app.series.createChallenge({ ...base, bestOf: 5 as 1 }), 400);
  });

  it("does not let an uninvited third player take the fixed seats", () => {
    const app = setup();
    const { duel } = challenge(app, 1);
    expectStatus(() => app.duels.takeSeat(duel.slug, "g1", app.p3), 403);
    expectStatus(() => app.duels.leave(duel.slug, "g1", app.p2), 409);
  });
});

describe("system start and ready", () => {
  it("allows a system start only for a series game", () => {
    const app = setup();
    const { duel } = challenge(app, 1);
    const active = start(app, duel.slug, null);
    expect(active.status).toBe("active");

    const open = app.duels.create({ guildId: "g1", organizerPlayerId: app.p1, name: "Open", mode: "normal" });
    app.duels.takeSeat(open.slug, "g1", app.p2);
    app.duels.setDeck(open.slug, "g1", app.p1, validDeck(1));
    app.duels.setDeck(open.slug, "g1", app.p2, validDeck(1000));
    expectStatus(() => start(app, open.slug, null), 403);
    expectStatus(() => start(app, open.slug, app.p2), 403);
  });

  it("lets any player of the series start a game, not an outsider", () => {
    const app = setup();
    const { duel } = challenge(app, 1);
    expectStatus(() => start(app, duel.slug, app.p3), 403);
    expect(start(app, duel.slug, app.p2).status).toBe("active");
  });

  it("markReady needs a seat and a deck", () => {
    const app = setup();
    const { duel } = app.series.createChallenge({
      guildId: "g1",
      challengerPlayerId: app.p1,
      opponentPlayerId: app.p2,
      bestOf: 1,
      ranked: false,
      mode: "normal",
    });
    expectStatus(() => app.duels.markReady(duel.slug, "g1", app.p1), 400);
    expectStatus(() => app.duels.markReady(duel.slug, "g1", app.p3), 403);
    app.db.prepare("update duel_seats set deck_json = ? where duel_id = ? and player_id = ?").run(JSON.stringify(validDeck(1)), duel.id, app.p1);
    const session = app.duels.markReady(duel.slug, "g1", app.p1);
    expect(session.seats.find((seat) => seat.playerId === app.p1)?.ready).toBe(true);
    expect(session.seats.find((seat) => seat.playerId === app.p2)?.ready).toBe(false);
    expect(app.series.dueStarts(10)).toEqual([]);
  });

  it("lists a series game with two ready seats as a due start", () => {
    const app = setup();
    const { duel } = challenge(app, 1);
    expect(app.series.dueStarts(10)).toEqual([{ slug: duel.slug, guildId: "g1" }]);
    start(app, duel.slug);
    expect(app.series.dueStarts(10)).toEqual([]);
  });
});

describe("open table attach", () => {
  it("creates a series when two humans start an open table", () => {
    const app = setup();
    const open = app.duels.create({ guildId: "g1", organizerPlayerId: app.p1, name: "Open", mode: "normal", bestOf: 3, ranked: true });
    expect(open.bestOf).toBe(3);
    expect(open.ranked).toBe(true);
    expect(open.seriesId).toBeNull();
    app.duels.takeSeat(open.slug, "g1", app.p2);
    app.duels.setDeck(open.slug, "g1", app.p1, validDeck(1));
    app.duels.setDeck(open.slug, "g1", app.p2, validDeck(1000));
    const active = start(app, open.slug, app.p1);
    expect(active.seriesId).not.toBeNull();
    expect(active.gameNumber).toBe(1);
    const summary = app.series.get(active.seriesId as number, "g1");
    expect(summary).toMatchObject({ bestOf: 3, ranked: true, status: "active", playerIds: [app.p1, app.p2], hasSide: [true, true] });
    const row = seriesRow(app, summary.id);
    expect(row.created_by_player_id).toBe(app.p1);
    expect(row.base_deck0_json).toBe(row.deck0_json);
  });

  it("defaults to Best of 1 unranked and validates the options", () => {
    const app = setup();
    const open = app.duels.create({ guildId: "g1", organizerPlayerId: app.p1, name: "Open", mode: "normal" });
    expect(open.bestOf).toBe(1);
    expect(open.ranked).toBe(false);
    expectStatus(() => app.duels.create({ guildId: "g1", organizerPlayerId: app.p1, name: "Bad", mode: "normal", bestOf: 2 as 1 }), 400);
    expectStatus(() => app.duels.create({ guildId: "g1", organizerPlayerId: app.p1, name: "Bad", mode: "normal", ranked: "yes" as unknown as boolean }), 400);
  });

  it("gives a practice bot duel no series", () => {
    const app = setup();
    const open = app.duels.create({ guildId: "g1", organizerPlayerId: app.p1, name: "Practice", mode: "normal" });
    app.duels.addPracticeBot(open.slug, "g1", app.p1, validDeck(1000));
    app.duels.setDeck(open.slug, "g1", app.p1, validDeck(1));
    const active = start(app, open.slug, app.p1);
    expect(active.seriesId).toBeNull();
    app.duels.complete(open.slug, "g1", 0, "done");
    expect(app.db.prepare("select count(*) as c from duel_series").get()).toEqual({ c: 0 });
    expect(matchRows(app)).toHaveLength(0);
  });
});

describe("Best of 1", () => {
  it("unranked: the win completes the series and writes no match", () => {
    const app = setup();
    const { duel, series } = challenge(app, 1);
    playGame(app, duel.slug, app.p2);
    const done = app.series.get(series.id, "g1");
    expect(done).toMatchObject({ status: "completed", wins: [0, 1], winnerPlayerId: app.p2 });
    expect(matchRows(app)).toHaveLength(0);
    expect(awardCount(app)).toBe(0);
    const store = createSeriesStore(app.db);
    expect(store.listUnrecordedResults("g1")).toEqual([]);
    expect(store.retryResult(series.id, "g1")).toMatchObject({ ok: false, error: expect.any(String) });
  });

  it("ranked: the win writes one approved match and scoring", () => {
    const app = setup();
    const { duel, series } = challenge(app, 1, true);
    playGame(app, duel.slug, app.p1);
    const rows = matchRows(app);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "approved", source: "casual", winner_id: app.p1, tournament_id: null, approver_id: null });
    expect(seriesRow(app, series.id)).toMatchObject({ status: "completed", wins0: 1, wins1: 0, winner_player_id: app.p1, match_id: rows[0]?.id });
    expect(awardCount(app)).toBeGreaterThan(0);
    const awards = awardCount(app);
    app.duels.complete(duel.slug, "g1", seatOf(duel, app.p1), "done");
    createSeriesStore(app.db).onGameFinished({ id: duel.id, series_id: series.id, game_number: 1 }, "completed", app.p1);
    expect(matchRows(app)).toHaveLength(1);
    expect(awardCount(app)).toBe(awards);
  });

  it("a casual draw completes the series with no winner and no match", () => {
    const app = setup();
    const { duel, series } = challenge(app, 1, true);
    playGame(app, duel.slug, null);
    expect(app.series.get(series.id, "g1")).toMatchObject({ status: "completed", winnerPlayerId: null, wins: [0, 0] });
    expect(matchRows(app)).toHaveLength(0);
    const store = createSeriesStore(app.db);
    expect(store.listUnrecordedResults("g1")).toEqual([]);
    expect(store.retryResult(series.id, "g1")).toMatchObject({ ok: false, error: expect.any(String) });
  });

  it("an interrupted game waits for both players to ready", () => {
    const app = setup();
    const { duel, series } = challenge(app, 1);
    start(app, duel.slug);
    app.duels.interrupt(duel.slug, "g1", "host restart");
    const summary = app.series.get(series.id, "g1");
    expect(summary).toMatchObject({ status: "between_games", nextGameAt: null, sideReady: [false, false], wins: [0, 0] });
    expect(app.series.dueNextGames(Date.now() + 10 * SERIES_SIDE_WINDOW_MS, 10)).toEqual([]);
    app.series.setSideReady(series.id, "g1", app.p1);
    expect(app.series.dueNextGames(Date.now(), 10)).toEqual([]);
    app.series.setSideReady(series.id, "g1", app.p2);
    expect(app.series.dueNextGames(Date.now(), 10)).toEqual([{ seriesId: series.id, guildId: "g1" }]);
  });
});

describe("series result recording", () => {
  it("rolls back failed ranked scoring, including season creation, and retries it once", () => {
    const app = setup();
    const { duel, series } = challenge(app, 1, true);
    start(app, duel.slug);
    app.db.exec(`
      create temp trigger fail_scoring before insert on point_awards
      when new.kind = 'match_win'
      begin select raise(abort, 'forced scoring failure'); end;
    `);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => app.duels.complete(duel.slug, "g1", seatOf(duel, app.p1), "done")).not.toThrow();
    } finally {
      spy.mockRestore();
    }
    expect(app.duels.get(duel.slug, "g1")).toMatchObject({ status: "completed", winnerPlayerId: app.p1, archivedAt: expect.any(String) });
    expect(seriesRow(app, series.id)).toMatchObject({ status: "completed", winner_player_id: app.p1, match_id: null });
    const store = createSeriesStore(app.db);
    expect(store.listUnrecordedResults("g1").map((row) => row.id)).toEqual([series.id]);
    expect(store.retryResult(series.id, "g1")).toEqual({ ok: false, error: "forced scoring failure" });
    expect(matchRows(app)).toEqual([]);
    for (const table of ["point_awards", "player_ratings", "season_standings", "seasons", "player_achievements"]) {
      expect(app.db.prepare(`select * from ${table}`).all()).toEqual([]);
    }
    app.db.exec("drop trigger fail_scoring");
    const repaired = store.retryResult(series.id, "g1");
    expect(repaired).toMatchObject({ ok: true, match: { winnerId: app.p1 } });
    expect(awardCount(app)).toBe(1);
    const ratings = app.db.prepare("select * from player_ratings order by player_id").all();
    expect(ratings).toHaveLength(2);
    expect(store.retryResult(series.id, "g1")).toEqual(repaired);
    expect(awardCount(app)).toBe(1);
    expect(app.db.prepare("select * from player_ratings order by player_id").all()).toEqual(ratings);
    expect(store.listUnrecordedResults("g1")).toEqual([]);
  });

  it.each([1, 3] as const)("keeps a ranked Bo%i completion when recording fails and repairs it once", (bestOf) => {
    const app = setup();
    const { duel, series } = challenge(app, bestOf, true);
    let finalGame = duel;
    if (bestOf === 3) {
      playGame(app, duel.slug, app.p1);
      finalGame = app.series.createNextGame(series.id, "g1");
    }
    start(app, finalGame.slug);
    const store = createSeriesStore(app.db);
    app.db.exec(`
      create temp trigger fail_match_save before insert on matches
      begin
        select raise(abort, 'forced match save failure');
      end;
    `);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => app.duels.complete(finalGame.slug, "g1", seatOf(finalGame, app.p1), "done"))
        .not.toThrow();
    } finally {
      spy.mockRestore();
    }
    expect(seriesRow(app, series.id)).toMatchObject({
      status: "completed", wins0: bestOf === 3 ? 2 : 1, wins1: 0, winner_player_id: app.p1, match_id: null, ended_at: expect.any(String),
    });
    expect(app.duels.get(finalGame.slug, "g1")).toMatchObject({
      status: "completed", winnerPlayerId: app.p1, resultReason: "done", endedAt: expect.any(String), archivedAt: expect.any(String),
    });
    expect(matchRows(app)).toHaveLength(0);
    expect(awardCount(app)).toBe(0);
    expect(app.db.prepare("select * from player_ratings").all()).toEqual([]);
    expect(store.listUnrecordedResults("g1").map((row) => row.id)).toEqual([series.id]);
    expect(store.listUnrecordedResults("g2")).toEqual([]);
    expect(store.retryResult(series.id, "g1")).toEqual({ ok: false, error: "forced match save failure" });
    expect(store.retryResult(series.id, "g2")).toEqual({ ok: false, error: "Duel series not found" });
    expect(store.retryResult(9999, "g1")).toEqual({ ok: false, error: "Duel series not found" });
    // Repeating completion cannot replace the saved winner or repair the result.
    app.duels.complete(finalGame.slug, "g1", seatOf(finalGame, app.p2), "different result");
    expect(matchRows(app)).toHaveLength(0);

    app.db.exec("drop trigger fail_match_save");
    const terminalSeries = seriesRow(app, series.id);
    const terminalDuel = app.duels.get(finalGame.slug, "g1");
    const repaired = store.retryResult(series.id, "g1");
    const match = matchRows(app)[0]!;
    expect(repaired).toMatchObject({ ok: true, match: { id: match.id, winnerId: app.p1, status: "approved", source: "casual" } });
    expect(seriesRow(app, series.id)).toEqual({ ...terminalSeries, match_id: match.id });
    expect(app.duels.get(finalGame.slug, "g1")).toEqual(terminalDuel);
    expect(awardCount(app)).toBe(1);
    const ratings = app.db.prepare("select * from player_ratings order by player_id").all();
    expect(ratings).toHaveLength(2);
    expect(store.retryResult(series.id, "g1")).toEqual(repaired);
    expect(matchRows(app)).toHaveLength(1);
    expect(awardCount(app)).toBe(1);
    expect(app.db.prepare("select * from player_ratings order by player_id").all()).toEqual(ratings);
    expect(store.listUnrecordedResults("g1")).toEqual([]);
  });

  it("rolls back the match and scoring when linking fails, while keeping completion", () => {
    const app = setup();
    const { duel, series } = challenge(app, 1, true);
    start(app, duel.slug);
    const store = createSeriesStore(app.db);
    app.db.exec(`
      create temp trigger fail_series_link before update of match_id on duel_series
      when new.match_id is not null
      begin
        select raise(abort, 'forced series link failure');
      end;
    `);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => app.duels.complete(duel.slug, "g1", seatOf(duel, app.p1), "done")).not.toThrow();
    } finally {
      spy.mockRestore();
    }
    expect(seriesRow(app, series.id)).toMatchObject({ status: "completed", winner_player_id: app.p1, match_id: null });
    expect(app.duels.get(duel.slug, "g1").status).toBe("completed");
    expect(matchRows(app)).toHaveLength(0);
    expect(awardCount(app)).toBe(0);
    for (const table of ["player_ratings", "season_standings", "seasons", "player_achievements"]) {
      expect(app.db.prepare(`select * from ${table}`).all()).toEqual([]);
    }
    expect(store.listUnrecordedResults("g1").map((row) => row.id)).toEqual([series.id]);

    app.db.exec("drop trigger fail_series_link");
    expect(store.retryResult(series.id, "g1")).toMatchObject({ ok: true });
    expect(matchRows(app)).toHaveLength(1);
    expect(seriesRow(app, series.id).match_id).toBe(matchRows(app)[0]?.id);
  });

  it.each(["Surrender", "Time limit"])("preserves a %s outcome, snapshots and the stopped clock when recording fails", (reason) => {
    const app = setup();
    const { duel, series } = challenge(app, 1, true);
    start(app, duel.slug);
    const loserSeat = seatOf(duel, app.p1) === 0 ? 0 : 1;
    app.duels.setClock(duel.slug, "g1", {
      turn: 1, remainingMs: loserSeat === 0 ? [0, 1000] : [1000, 0], activeSeat: loserSeat, startedAt: Date.now(),
    });
    const board: DuelEngineView = {
      revision: 4, turn: 1, turnSeat: 0, phase: "end",
      seats: [0, 1].map((seat) => ({ seat, lp: 1000, hand: [], deckCount: 30, extraCount: 0, extra: [], monsters: [], spells: [], graveyard: [], banished: [] })),
      prompt: null, chain: [], events: [], log: [], result: null,
    };
    app.db.exec(`
      create temp trigger fail_match_save before insert on matches
      begin select raise(abort, 'forced match save failure'); end;
    `);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => app.duels.complete(duel.slug, "g1", seatOf(duel, app.p2), reason, { public: board, seat0: board, seat1: board }))
        .not.toThrow();
    } finally {
      spy.mockRestore();
    }
    expect(app.duels.get(duel.slug, "g1")).toMatchObject({ status: "completed", winnerPlayerId: app.p2, resultReason: reason });
    expect(app.series.get(series.id, "g1")).toMatchObject({ status: "completed", wins: [0, 1], winnerPlayerId: app.p2 });
    for (const playerId of [app.p1, app.p2]) {
      expect(app.duels.room(duel.slug, "g1", playerId).engine?.result).toEqual({ winnerSeat: seatOf(duel, app.p2), reason });
    }
    const row = app.db.prepare("select clock_json, snapshot_public_json from duels where id = ?").get(duel.id) as Record<string, any>;
    expect(row.clock_json).toBeNull();
    expect(JSON.parse(row.snapshot_public_json).result).toEqual({ winnerSeat: seatOf(duel, app.p2), reason });
    expect(app.duels.dueClocks(Date.now() + 1000, 10)).toEqual([]);
    expect(createSeriesStore(app.db).listUnrecordedResults("g1").map((row) => row.id)).toEqual([series.id]);
    expect(matchRows(app)).toHaveLength(0);
  });

  it("an interrupted ranked Bo3 at 1-1 still waits for readiness without recording", () => {
    const app = setup();
    const { duel, series } = challenge(app, 3, true);
    playGame(app, duel.slug, app.p1);
    const game2 = app.series.createNextGame(series.id, "g1");
    playGame(app, game2.slug, app.p2);
    const game3 = app.series.createNextGame(series.id, "g1");
    start(app, game3.slug);
    app.db.exec(`
      create temp trigger fail_match_save before insert on matches
      begin select raise(abort, 'forced match save failure'); end;
    `);
    app.duels.interrupt(game3.slug, "g1", "host restart");
    expect(app.duels.get(game3.slug, "g1")).toMatchObject({ status: "interrupted", winnerPlayerId: null, resultReason: "host restart" });
    expect(app.series.get(series.id, "g1")).toMatchObject({ status: "between_games", wins: [1, 1], winnerPlayerId: null, sideReady: [false, false], nextGameAt: null });
    expect(app.series.dueNextGames(Date.now() + 10 * SERIES_SIDE_WINDOW_MS, 10)).toEqual([]);
    expect(createSeriesStore(app.db).listUnrecordedResults("g1")).toEqual([]);
    expect(createSeriesStore(app.db).retryResult(series.id, "g1")).toMatchObject({ ok: false, error: expect.any(String) });
    expect(matchRows(app)).toHaveLength(0);
    app.series.setSideReady(series.id, "g1", app.p1);
    app.series.setSideReady(series.id, "g1", app.p2);
    const next = app.series.createNextGame(series.id, "g1");
    expect(next.seats.map((seat) => seat.playerId)).toEqual([game3.seats[1]?.playerId, game3.seats[0]?.playerId]);
    expect(app.series.get(series.id, "g1").wins).toEqual([1, 1]);
  });
});

describe("Best of 3", () => {
  it.each(["first", "second"] as const)("carries only admitted spectators into games 2 and 3 when the loser chooses %s, without sharing invite codes", (choice) => {
    const app = setup();
    const { duel, series } = challenge(app, 3);
    const spectator2 = insertPlayer(app.db, "g1", "u4", "Tea");
    const uninvited = insertPlayer(app.db, "g1", "u5", "Tristan");
    const laterSpectator = insertPlayer(app.db, "g1", "u6", "Bakura");
    const inviteCode = (game: DuelSession) =>
      (app.db.prepare("select invite_code from duels where id = ?").get(game.id) as { invite_code: string }).invite_code;
    const grants = (game: DuelSession) =>
      app.db.prepare("select player_id from duel_invite_grants where duel_id = ? order by player_id").all(game.id);
    const unrelated = app.duels.create({
      guildId: "g1", organizerPlayerId: app.p1, name: "Other table", mode: "normal", settings: { visibility: "private" },
    });
    app.duels.admit(unrelated.slug, "g1", uninvited, inviteCode(unrelated));
    for (const playerId of [app.p3, spectator2]) {
      app.duels.admit(duel.slug, "g1", playerId, inviteCode(duel));
      expect(app.duels.room(duel.slug, "g1", playerId).role).toBe("spectator");
    }
    expectStatus(() => app.duels.room(duel.slug, "g1", uninvited), 403);

    playGame(app, duel.slug, app.p1);
    app.series.setFirstChoice(series.id, "g1", app.p2, choice);
    const game2 = app.series.createNextGame(series.id, "g1");
    expect(game2.seats.map((seat) => seat.playerId)).toEqual(choice === "first" ? [app.p2, app.p1] : [app.p1, app.p2]);
    for (const playerId of [app.p3, spectator2]) {
      expect(app.duels.room(game2.slug, "g1", playerId)).toMatchObject({ role: "spectator", mySeat: null });
      expect(app.duels.room(game2.slug, "g1", playerId).inviteCode).toBeUndefined();
    }
    expect(grants(game2)).toEqual([{ player_id: app.p3 }, { player_id: spectator2 }]);
    expectStatus(() => app.duels.room(game2.slug, "g1", uninvited), 403);
    expectStatus(() => app.duels.room(game2.slug, "g1", laterSpectator), 403);
    expectStatus(() => app.duels.admit(game2.slug, "g1", uninvited, inviteCode(duel)), 403);
    expect(app.series.createNextGame(series.id, "g1").id).toBe(game2.id);

    app.duels.admit(game2.slug, "g1", laterSpectator, inviteCode(game2));
    playGame(app, game2.slug, app.p2);
    app.series.setFirstChoice(series.id, "g1", app.p1, "second");
    const game3 = app.series.createNextGame(series.id, "g1");
    expect(game3.seats.map((seat) => seat.playerId)).toEqual([app.p2, app.p1]);
    for (const playerId of [app.p3, spectator2, laterSpectator]) {
      expect(app.duels.room(game3.slug, "g1", playerId)).toMatchObject({ role: "spectator", mySeat: null });
      expect(app.duels.room(game3.slug, "g1", playerId).inviteCode).toBeUndefined();
    }
    expect(grants(game3)).toEqual([{ player_id: app.p3 }, { player_id: spectator2 }, { player_id: laterSpectator }]);
    expectStatus(() => app.duels.room(game3.slug, "g1", uninvited), 403);
    expect(new Set([inviteCode(duel), inviteCode(game2), inviteCode(game3)]).size).toBe(3);
  });

  it("rolls back the next game if carrying spectator grants fails", () => {
    const app = setup();
    const { duel, series } = challenge(app, 3);
    const code = (app.db.prepare("select invite_code from duels where id = ?").get(duel.id) as { invite_code: string }).invite_code;
    app.duels.admit(duel.slug, "g1", app.p3, code);
    playGame(app, duel.slug, app.p1);
    app.db.exec(`
      create temp trigger fail_grant_copy before insert on duel_invite_grants
      begin select raise(abort, 'forced grant copy failure'); end;
    `);
    expect(() => app.series.createNextGame(series.id, "g1")).toThrow("forced grant copy failure");
    expect(app.series.get(series.id, "g1")).toMatchObject({ status: "between_games", currentDuelSlug: duel.slug, gameNumber: 1 });
    expect(app.db.prepare("select id from duels where series_id = ?").all(series.id)).toEqual([{ id: duel.id }]);
    app.db.exec("drop trigger fail_grant_copy");
    const next = app.series.createNextGame(series.id, "g1");
    expect(app.duels.room(next.slug, "g1", app.p3).role).toBe("spectator");
  });

  it("runs 2-0: the second win completes the series and records once", () => {
    const app = setup();
    const { duel, series } = challenge(app, 3, true);
    playGame(app, duel.slug, app.p1);
    let summary = app.series.get(series.id, "g1");
    expect(summary).toMatchObject({ status: "between_games", wins: [1, 0] });
    expect(summary.nextGameAt).not.toBeNull();
    const deadline = Date.parse(summary.nextGameAt as string);
    expect(Math.abs(deadline - (Date.now() + SERIES_SIDE_WINDOW_MS))).toBeLessThan(5000);
    expect(matchRows(app)).toHaveLength(0);

    const next = app.series.createNextGame(series.id, "g1");
    expect(next.gameNumber).toBe(2);
    playGame(app, next.slug, app.p1);
    summary = app.series.get(series.id, "g1");
    expect(summary).toMatchObject({ status: "completed", wins: [2, 0], winnerPlayerId: app.p1 });
    expect(matchRows(app)).toHaveLength(1);
  });

  it("runs 1-1-1 and puts the loser of the last game in seat 0", () => {
    const app = setup();
    const { duel, series } = challenge(app, 3);
    playGame(app, duel.slug, app.p1);

    const game2 = app.series.createNextGame(series.id, "g1");
    expect(seatOf(game2, app.p2)).toBe(0);
    expect(game2.seats.every((seat) => seat.ready)).toBe(true);
    playGame(app, game2.slug, app.p2);
    expect(app.series.get(series.id, "g1")).toMatchObject({ status: "between_games", wins: [1, 1] });

    const game3 = app.series.createNextGame(series.id, "g1");
    expect(seatOf(game3, app.p1)).toBe(0);
    playGame(app, game3.slug, app.p1);
    expect(app.series.get(series.id, "g1")).toMatchObject({ status: "completed", wins: [2, 1], winnerPlayerId: app.p1 });
  });

  it("a draw does not count and swaps the seats of the last game", () => {
    const app = setup();
    const { duel, series } = challenge(app, 3);
    const first = app.duels.get(duel.slug, "g1");
    playGame(app, duel.slug, null);
    expect(app.series.get(series.id, "g1")).toMatchObject({ status: "between_games", wins: [0, 0] });
    const game2 = app.series.createNextGame(series.id, "g1");
    expect(seatOf(game2, first.seats[0]?.playerId as number)).toBe(1);
    expect(seatOf(game2, first.seats[1]?.playerId as number)).toBe(0);
  });

  it("an interrupted game does not count and swaps the seats", () => {
    const app = setup();
    const { duel, series } = challenge(app, 3);
    const first = app.duels.get(duel.slug, "g1");
    start(app, duel.slug);
    app.duels.interrupt(duel.slug, "g1", "crash");
    const game2 = app.series.createNextGame(series.id, "g1");
    expect(game2.seats.map((seat) => seat.playerId)).toEqual([first.seats[1]?.playerId, first.seats[0]?.playerId]);
    expect(app.series.get(series.id, "g1").wins).toEqual([0, 0]);
  });

  it("createNextGame is idempotent and names the game", () => {
    const app = setup();
    const { duel, series } = challenge(app, 3);
    playGame(app, duel.slug, app.p1);
    const a = app.series.createNextGame(series.id, "g1");
    const b = app.series.createNextGame(series.id, "g1");
    expect(b.slug).toBe(a.slug);
    expect(a.name).toBe(`${duel.name} · Game 2`);
    expect(a.settings.visibility).toBe("private");
    expect(app.series.get(series.id, "g1")).toMatchObject({ status: "active", nextGameAt: null, sideReady: [false, false], currentDuelSlug: a.slug, gameNumber: 2 });
    expect(app.db.prepare("select count(*) as c from duels where series_id = ?").get(series.id)).toEqual({ c: 2 });
  });

  it("waits for explicit Ready even from a player without side cards", () => {
    const app = setup();
    const started = app.series.createChallenge({ guildId: "g1", challengerPlayerId: app.p1, opponentPlayerId: app.p2, bestOf: 3, ranked: false, mode: "normal" });
    app.duels.setDeck(started.duel.slug, "g1", app.p1, validDeck(1, 0));
    app.duels.setDeck(started.duel.slug, "g1", app.p2, validDeck(1000, 2));
    playGame(app, started.duel.slug, app.p1);
    const summary = app.series.get(started.series.id, "g1");
    expect(summary.hasSide).toEqual([false, true]);
    expect(summary.sideReady).toEqual([false, false]);
    expect(app.series.dueNextGames(Date.now(), 10)).toEqual([]);
    expect(app.series.dueNextGames(Date.now() + SERIES_SIDE_WINDOW_MS + 1000, 10)).toHaveLength(1);
  });

  it("a cancelled series ignores a later result", () => {
    const app = setup();
    const { duel, series } = challenge(app, 1, true);
    start(app, duel.slug);
    expect(app.series.cancel(series.id, "g1").changedSlugs).toEqual([]);
    app.duels.complete(duel.slug, "g1", 0, "done");
    expect(app.series.get(series.id, "g1")).toMatchObject({ status: "cancelled", wins: [0, 0], winnerPlayerId: null });
    expect(matchRows(app)).toHaveLength(0);
  });

  it("a lobby cancel by either player cancels the series", () => {
    const app = setup();
    const { duel, series } = challenge(app, 3);
    expectStatus(() => app.duels.cancel(duel.slug, "g1", app.p3), 403);
    const cancelled = app.duels.cancel(duel.slug, "g1", app.p2);
    expect(cancelled.status).toBe("cancelled");
    expect(app.series.get(series.id, "g1").status).toBe("cancelled");
  });

  it("ignores the result of a game that is not the latest", () => {
    const app = setup();
    const { duel, series } = challenge(app, 3);
    start(app, duel.slug);
    // Simulate a newer game 2 in the series while game 1 is still live.
    app.db.prepare("update duels set game_number = 1 where id = ?").run(duel.id);
    app.db.prepare(
      "insert into duels (guild_id, web_slug, name, organizer_player_id, mode, master_rule, status, settings_json, series_id, game_number) values ('g1', 'zzzzzzzz', 'x', ?, 'normal', 5, 'lobby', ?, ?, 2)",
    ).run(app.p1, JSON.stringify(duel.settings), series.id);
    app.duels.complete(duel.slug, "g1", 0, "done");
    expect(app.series.get(series.id, "g1")).toMatchObject({ status: "active", wins: [0, 0] });
  });
});

describe("the loser chooses first or second", () => {
  it("names the loser as the chooser after a decided game, and nobody after a draw or an interrupt", () => {
    const app = setup();
    const { duel, series } = challenge(app, 3);
    expect(app.series.get(series.id, "g1")).toMatchObject({ firstChooser: null, firstChoice: null });
    playGame(app, duel.slug, app.p1);
    const index = (playerId: number) => app.series.get(series.id, "g1").playerIds.indexOf(playerId);
    expect(app.series.get(series.id, "g1")).toMatchObject({ firstChooser: index(app.p2), firstChoice: null });

    const game2 = app.series.createNextGame(series.id, "g1");
    expect(app.series.get(series.id, "g1")).toMatchObject({ firstChooser: null, firstChoice: null });
    playGame(app, game2.slug, null);
    expect(app.series.get(series.id, "g1")).toMatchObject({ status: "between_games", firstChooser: null });
    expectStatus(() => app.series.setFirstChoice(series.id, "g1", app.p1, "second"), 409);
  });

  it("puts the loser in seat 1 when they choose second, and in seat 0 when they choose first", () => {
    const app = setup();
    const { duel, series } = challenge(app, 3);
    playGame(app, duel.slug, app.p1);
    const summary = app.series.setFirstChoice(series.id, "g1", app.p2, "second");
    expect(summary.firstChoice).toBe("second");
    const game2 = app.series.createNextGame(series.id, "g1");
    expect(seatOf(game2, app.p2)).toBe(1);
    expect(seatOf(game2, app.p1)).toBe(0);

    playGame(app, game2.slug, app.p2);
    app.series.setFirstChoice(series.id, "g1", app.p1, "second");
    app.series.setFirstChoice(series.id, "g1", app.p1, "first");
    const game3 = app.series.createNextGame(series.id, "g1");
    expect(seatOf(game3, app.p1)).toBe(0);
  });

  it("lets the loser change the choice until the next game is made", () => {
    const app = setup();
    const { duel, series } = challenge(app, 3);
    playGame(app, duel.slug, app.p1);
    const readied = app.series.setSideReady(series.id, "g1", app.p2);
    app.series.setFirstChoice(series.id, "g1", app.p2, "second");
    const changed = app.series.setFirstChoice(series.id, "g1", app.p2, "first");
    expect(changed.firstChoice).toBe("first");
    expect(changed.sideReady).toEqual(readied.sideReady);
    expect(seatOf(app.series.createNextGame(series.id, "g1"), app.p2)).toBe(0);
  });

  it("goes first by default when the window ends without a choice", () => {
    const app = setup();
    const { duel, series } = challenge(app, 3);
    playGame(app, duel.slug, app.p1);
    expect(app.series.dueNextGames(Date.now() + SERIES_SIDE_WINDOW_MS + 1000, 10)).toHaveLength(1);
    expect(seatOf(app.series.createNextGame(series.id, "g1"), app.p2)).toBe(0);
  });

  it("refuses the winner, a stranger, a bad value and a series that is not between games", () => {
    const app = setup();
    const { duel, series } = challenge(app, 3);
    expectStatus(() => app.series.setFirstChoice(series.id, "g1", app.p2, "first"), 409);
    playGame(app, duel.slug, app.p1);
    expectStatus(() => app.series.setFirstChoice(series.id, "g1", app.p1, "second"), 403);
    expectStatus(() => app.series.setFirstChoice(series.id, "g1", app.p3, "second"), 403);
    expectStatus(() => app.series.setFirstChoice(series.id, "g1", app.p2, "third" as never), 400);
    app.series.createNextGame(series.id, "g1");
    expectStatus(() => app.series.setFirstChoice(series.id, "g1", app.p2, "second"), 409);
  });

  it.each(["first", "second"] as const)("records %s without readying either player when neither has side cards", (choice) => {
    const app = setup();
    const started = app.series.createChallenge({ guildId: "g1", challengerPlayerId: app.p1, opponentPlayerId: app.p2, bestOf: 3, ranked: false, mode: "normal" });
    app.duels.setDeck(started.duel.slug, "g1", app.p1, validDeck(1, 0));
    app.duels.setDeck(started.duel.slug, "g1", app.p2, validDeck(1000, 0));
    playGame(app, started.duel.slug, app.p1);
    expect(app.series.get(started.series.id, "g1").sideReady).toEqual([false, false]);
    expect(app.series.dueNextGames(Date.now(), 10)).toEqual([]);
    expect(app.series.setFirstChoice(started.series.id, "g1", app.p2, choice)).toMatchObject({
      firstChoice: choice, sideReady: [false, false], status: "between_games",
    });
    expect(app.series.dueNextGames(Date.now(), 10)).toEqual([]);
    app.series.setSideReady(started.series.id, "g1", app.p1);
    app.series.setFirstChoice(started.series.id, "g1", app.p2, choice);
    expect(app.series.get(started.series.id, "g1").sideReady).toEqual([true, false]);
    expect(app.series.dueNextGames(Date.now(), 10)).toEqual([]);
    app.series.setSideReady(started.series.id, "g1", app.p2);
    expect(app.series.dueNextGames(Date.now(), 10)).toHaveLength(1);
  });

  it("Ready from the loser keeps the default and releases the game", () => {
    const app = setup();
    const { duel, series } = challenge(app, 3);
    playGame(app, duel.slug, app.p1);
    app.series.setSideReady(series.id, "g1", app.p1);
    expect(app.series.dueNextGames(Date.now(), 10)).toEqual([]);
    const summary = app.series.setSideReady(series.id, "g1", app.p2);
    expect(summary.firstChoice).toBe("first");
    expect(app.series.dueNextGames(Date.now(), 10)).toHaveLength(1);
  });

  it("Ready after a choice keeps the choice", () => {
    const app = setup();
    const { duel, series } = challenge(app, 3);
    playGame(app, duel.slug, app.p1);
    app.series.setFirstChoice(series.id, "g1", app.p2, "second");
    expect(app.series.setSideReady(series.id, "g1", app.p2).firstChoice).toBe("second");
  });
});

describe("Best of 3 against the practice bot", () => {
  /** An open Best of 3 table with the bot in the other seat and the human's deck set. */
  function botTable(app: App, bestOf: 1 | 3 = 3, ranked = false) {
    const open = app.duels.create({ guildId: "g1", organizerPlayerId: app.p1, name: "Practice", mode: "normal", bestOf, ranked });
    app.duels.addPracticeBot(open.slug, "g1", app.p1, validDeck(1000, 0));
    app.duels.setDeck(open.slug, "g1", app.p1, validDeck(1, 0));
    return open;
  }
  /** Starts a game of the bot series and ends it; `humanWins` false means the bot wins. */
  function playBotGame(app: App, slug: string, humanWins: boolean | null) {
    const active = start(app, slug, app.p1);
    const humanSeat = seatOf(active, app.p1);
    const winnerSeat = humanWins === null ? null : humanWins ? humanSeat : humanSeat === 0 ? 1 : 0;
    return app.duels.complete(slug, "g1", winnerSeat, "done");
  }
  const botSeatOf = (session: DuelSession) => session.seats.find((seat) => seat.isBot)!.seat;

  it("makes a series with the human at index 0 and the bot at index 1", () => {
    const app = setup();
    const open = botTable(app);
    const active = start(app, open.slug, app.p1);
    expect(active.seriesId).not.toBeNull();
    const summary = app.series.get(active.seriesId!, "g1");
    expect(summary).toMatchObject({
      bestOf: 3, ranked: false, status: "active", wins: [0, 0], gameNumber: 1, vsBot: true,
      playerIds: [app.p1, 0], displayNames: ["Yugi", "Practice Bot"],
    });
    expect(summary.hasSide).toEqual([false, false]);
  });

  it("is never ranked, even on a ranked table, and records no match", () => {
    const app = setup();
    const open = botTable(app, 3, true);
    const active = start(app, open.slug, app.p1);
    expect(app.series.get(active.seriesId!, "g1").ranked).toBe(false);
    expect(app.duels.get(open.slug, "g1").ranked).toBe(false);
    app.duels.complete(open.slug, "g1", seatOf(active, app.p1), "done");
    const game2 = app.series.createNextGame(active.seriesId!, "g1");
    expect(game2.ranked).toBe(false);
    playBotGame(app, game2.slug, true);
    expect(app.series.get(active.seriesId!, "g1")).toMatchObject({ status: "completed", wins: [2, 0], winnerPlayerId: app.p1 });
    expect(matchRows(app)).toHaveLength(0);
    expect(awardCount(app)).toBe(0);
  });

  it("keeps a Best of 1 against the bot a lone duel", () => {
    const app = setup();
    const open = botTable(app, 1);
    expect(start(app, open.slug, app.p1).seriesId).toBeNull();
  });

  it("after a human win the bot is ready at once and chose to go first", () => {
    const app = setup();
    const open = botTable(app);
    const done = playBotGame(app, open.slug, true);
    const summary = app.series.get(done.seriesId!, "g1");
    expect(summary).toMatchObject({ status: "between_games", wins: [1, 0], sideReady: [false, true], firstChooser: 1, firstChoice: "first" });
    expect(summary.nextGameAt).not.toBeNull();
    expect(app.series.dueNextGames(Date.now(), 10)).toEqual([]);
    app.series.setSideReady(done.seriesId!, "g1", app.p1);
    expect(app.series.dueNextGames(Date.now(), 10)).toHaveLength(1);
    const game2 = app.series.createNextGame(done.seriesId!, "g1");
    expect(game2.seats.find((seat) => seat.isBot)).toMatchObject({ seat: 0, isBot: true, displayName: "Practice Bot" });
    expect(seatOf(game2, app.p1)).toBe(1);
    expect(game2.seriesId).toBe(done.seriesId);
    expect(game2.gameNumber).toBe(2);
  });

  it("after a bot win the human chooses; the bot is ready and does not side", () => {
    const app = setup();
    const open = app.duels.create({ guildId: "g1", organizerPlayerId: app.p1, name: "Practice", mode: "normal", bestOf: 3 });
    app.duels.addPracticeBot(open.slug, "g1", app.p1, validDeck(1000, 0));
    app.duels.setDeck(open.slug, "g1", app.p1, validDeck(1, 3));
    const done = playBotGame(app, open.slug, false);
    const summary = app.series.get(done.seriesId!, "g1");
    expect(summary).toMatchObject({ status: "between_games", wins: [0, 1], sideReady: [false, true], hasSide: [true, false], firstChooser: 0, firstChoice: null });
    // The bot is ready, the human is not: the window decides.
    expect(app.series.dueNextGames(Date.now(), 10)).toEqual([]);
    expect(app.series.dueNextGames(Date.now() + SERIES_SIDE_WINDOW_MS + 1000, 10)).toHaveLength(1);

    // The human sides and picks second; the bot keeps its deck.
    const state = app.series.sideState(done.seriesId!, "g1", app.p1);
    const swapped = { main: [...state.currentDeck.main.slice(1), state.currentDeck.side[0]!], extra: state.currentDeck.extra, side: [state.currentDeck.main[0]!, ...state.currentDeck.side.slice(1)] };
    app.series.setSideDeck(done.seriesId!, "g1", app.p1, swapped);
    app.series.setFirstChoice(done.seriesId!, "g1", app.p1, "second");
    expect(app.series.setSideReady(done.seriesId!, "g1", app.p1)).toMatchObject({ sideReady: [true, true], firstChoice: "second" });
    expect(app.series.dueNextGames(Date.now(), 10)).toHaveLength(1);
    // The human can take Ready back while editing; the bot stays ready with its unchanged deck.
    const cleared = app.series.clearSideReady(done.seriesId!, "g1", app.p1);
    expect(cleared).toMatchObject({ readyCleared: true, series: { vsBot: true, sideReady: [false, true] } });
    expect(app.series.dueNextGames(Date.now(), 10)).toEqual([]);
    expect(app.series.sideState(done.seriesId!, "g1", app.p1).currentDeck).toEqual(swapped);
    app.series.setSideReady(done.seriesId!, "g1", app.p1);
    const game2 = app.series.createNextGame(done.seriesId!, "g1");
    expect(seatOf(game2, app.p1)).toBe(1);
    expect(botSeatOf(game2)).toBe(0);
    // The bot plays the same deck every game; the human plays the sided deck.
    const decks = app.db.prepare("select is_bot, deck_json from duel_seats where duel_id = (select id from duels where web_slug = ?)").all(game2.slug) as Array<{ is_bot: number; deck_json: string }>;
    expect(JSON.parse(decks.find((seat) => seat.is_bot === 1)!.deck_json)).toEqual(validDeck(1000, 0));
    expect(JSON.parse(decks.find((seat) => seat.is_bot === 0)!.deck_json)).toEqual(swapped);
  });

  it("refuses a side deck or a choice from anyone but the human", () => {
    const app = setup();
    const open = botTable(app);
    const done = playBotGame(app, open.slug, false);
    expectStatus(() => app.series.setFirstChoice(done.seriesId!, "g1", app.p2, "second"), 403);
    expectStatus(() => app.series.setSideReady(done.seriesId!, "g1", app.p2), 403);
  });

  it.each(["first", "second"] as const)("keeps the human unready after choosing %s without a Side Deck", (choice) => {
    const app = setup();
    const open = botTable(app);
    const done = playBotGame(app, open.slug, false);
    const selected = app.series.setFirstChoice(done.seriesId!, "g1", app.p1, choice);
    expect(selected).toMatchObject({ sideReady: [false, true], firstChoice: choice });
    const deadline = Date.parse(selected.nextGameAt!);
    expect(app.series.dueNextGames(deadline - 1, 10)).toEqual([]);
    expect(app.series.dueNextGames(deadline, 10)).toEqual([{ seriesId: done.seriesId!, guildId: "g1" }]);
    expect(seatOf(app.series.createNextGame(done.seriesId!, "g1"), app.p1)).toBe(choice === "first" ? 0 : 1);
  });

  it("goes first by default when the human loses and the window ends", () => {
    const app = setup();
    const open = botTable(app);
    const done = playBotGame(app, open.slug, false);
    const game2 = app.series.createNextGame(done.seriesId!, "g1");
    expect(seatOf(game2, app.p1)).toBe(0);
    expect(botSeatOf(game2)).toBe(1);
  });

  it("ends at 2 wins: the bot can win the match and the series records nothing", () => {
    const app = setup();
    const open = botTable(app);
    let slug = open.slug;
    for (let game = 1; game <= 2; game += 1) {
      const done = playBotGame(app, slug, false);
      if (game === 1) {
        expect(app.series.get(done.seriesId!, "g1")).toMatchObject({ status: "between_games", wins: [0, 1] });
        slug = app.series.createNextGame(done.seriesId!, "g1").slug;
      } else {
        expect(app.series.get(done.seriesId!, "g1")).toMatchObject({ status: "completed", wins: [0, 2], winnerPlayerId: null, vsBot: true });
      }
    }
    expect(matchRows(app)).toHaveLength(0);
  });

  it("plays to a third game at 1-1", () => {
    const app = setup();
    const open = botTable(app);
    let slug = open.slug;
    let seriesId = 0;
    for (const humanWins of [true, false]) {
      const done = playBotGame(app, slug, humanWins);
      seriesId = done.seriesId!;
      slug = app.series.createNextGame(seriesId, "g1").slug;
    }
    expect(app.series.get(seriesId, "g1")).toMatchObject({ status: "active", wins: [1, 1], gameNumber: 3 });
    const done = playBotGame(app, slug, true);
    expect(app.series.get(done.seriesId!, "g1")).toMatchObject({ status: "completed", wins: [2, 1], winnerPlayerId: app.p1 });
  });

  it("swaps the seats after a draw and waits for the human's Ready", () => {
    const app = setup();
    const open = botTable(app);
    const before = start(app, open.slug, app.p1);
    const firstBot = botSeatOf(before);
    app.duels.complete(open.slug, "g1", null, "draw");
    const summary = app.series.get(before.seriesId!, "g1");
    expect(summary).toMatchObject({ status: "between_games", wins: [0, 0], firstChooser: null, sideReady: [false, true] });
    expect(app.series.dueNextGames(Date.now(), 10)).toEqual([]);
    const game2 = app.series.createNextGame(before.seriesId!, "g1");
    expect(botSeatOf(game2)).toBe(firstBot === 0 ? 1 : 0);
  });

  it("offers the next game from dueStarts, because the bot seat is ready", () => {
    const app = setup();
    const open = botTable(app);
    const done = playBotGame(app, open.slug, true);
    const game2 = app.series.createNextGame(done.seriesId!, "g1");
    expect(app.series.dueStarts(10)).toEqual([{ slug: game2.slug, guildId: "g1" }]);
  });
});

describe("side decking", () => {
  function betweenGames(app: App) {
    const { duel, series } = challenge(app, 3);
    playGame(app, duel.slug, app.p1);
    return series;
  }

  it.each(["grow", "shrink"])("rejects a %s in Main count with the same Side count and card multiset", (direction) => {
    const app = setup();
    const started = app.series.createChallenge({ guildId: "g1", challengerPlayerId: app.p1, opponentPlayerId: app.p2, bestOf: 3, ranked: false, mode: "normal" });
    const deck = { ...validDeck(1), main: [...validDeck(1).main, 500] };
    app.duels.setDeck(started.duel.slug, "g1", app.p1, deck);
    app.duels.setDeck(started.duel.slug, "g1", app.p2, validDeck(1000));
    playGame(app, started.duel.slug, app.p1);
    const unbalanced = direction === "grow"
      ? { ...deck, main: [...deck.main, deck.extra[0]!], extra: deck.extra.slice(1) }
      : { ...deck, main: deck.main.slice(1), extra: [...deck.extra, deck.main[0]!] };
    expect(() => app.series.setSideDeck(started.series.id, "g1", app.p1, unbalanced))
      .toThrow("The main deck must keep the same number of cards");
    expect(app.series.sideState(started.series.id, "g1", app.p1).currentDeck).toEqual(deck);
    // Expiry advances with the last game's stored deck, including after a rejected submission.
    const next = app.series.createNextGame(started.series.id, "g1");
    expect(app.duels.privateState(next.slug, "g1").decks[seatOf(next, app.p1)]).toEqual(deck);
  });

  it("needs the between_games window", () => {
    const app = setup();
    const { series } = challenge(app, 3);
    expectStatus(() => app.series.setSideDeck(series.id, "g1", app.p1, validDeck(1)), 409);
    expectStatus(() => app.series.setSideReady(series.id, "g1", app.p1), 409);
  });

  it("needs a series player", () => {
    const app = setup();
    const series = betweenGames(app);
    expectStatus(() => app.series.setSideDeck(series.id, "g1", app.p3, validDeck(1)), 403);
    expectStatus(() => app.series.setSideReady(series.id, "g1", app.p3), 403);
    expectStatus(() => app.series.sideState(series.id, "g1", app.p3), 403);
    expectStatus(() => app.series.get(series.id, "g2"), 404);
  });

  it("stores a legal swap between main and side and leaves ready alone", () => {
    const app = setup();
    const series = betweenGames(app);
    const deck = validDeck(1);
    const swapped: DuelDeck = {
      ...deck,
      main: [...deck.main.slice(1), deck.side[0] as number],
      side: [deck.main[0] as number, deck.side[1] as number],
    };
    const summary = app.series.setSideDeck(series.id, "g1", app.p1, swapped);
    expect(summary.sideReady).toEqual([false, false]);
    const state = app.series.sideState(series.id, "g1", app.p1);
    expect(state.currentDeck).toEqual(swapped);
    expect(state.baseDeck).toEqual(deck);
    expect(app.series.sideState(series.id, "g1", app.p2).currentDeck).toEqual(validDeck(1000));
    app.series.setSideReady(series.id, "g1", app.p1);
    expect(app.series.get(series.id, "g1").sideReady).toEqual([true, false]);
    // The sided deck carries into the next game.
    const next = app.series.createNextGame(series.id, "g1");
    const priv = app.duels.privateState(next.slug, "g1");
    const seat = seatOf(next, app.p1);
    expect(priv.decks[seat]).toEqual(swapped);
  });

  it("clears the player's Ready when they change their deck after Ready", () => {
    const app = setup();
    const series = betweenGames(app);
    const index = series.playerIds.indexOf(app.p1);
    const deck = validDeck(1);
    const swapped: DuelDeck = {
      ...deck,
      main: [...deck.main.slice(1), deck.side[0] as number],
      side: [deck.main[0] as number, deck.side[1] as number],
    };
    app.series.setSideReady(series.id, "g1", app.p1);
    app.series.setSideReady(series.id, "g1", app.p2);
    expect(app.series.get(series.id, "g1").sideReady).toEqual([true, true]);
    expect(app.series.dueNextGames(Date.now(), 10)).toEqual([{ seriesId: series.id, guildId: "g1" }]);

    // Saving the same deck again is not a change and keeps Ready.
    expect(app.series.setSideDeck(series.id, "g1", app.p1, deck).sideReady).toEqual([true, true]);

    const summary = app.series.setSideDeck(series.id, "g1", app.p1, swapped);
    expect(summary.sideReady[index]).toBe(false);
    expect(summary.sideReady[index === 0 ? 1 : 0]).toBe(true);
    // The series is no longer due: neither the ready path nor the sweep may start the next game.
    expect(app.series.dueNextGames(Date.now(), 10)).toEqual([]);
  });

  it("clears Ready on request while the player edits, before anything is saved", () => {
    const app = setup();
    expectStatus(() => app.series.clearSideReady(challenge(app, 3).series.id, "g1", app.p1), 409);
    const series = betweenGames(app);
    const index = series.playerIds.indexOf(app.p1);
    expectStatus(() => app.series.clearSideReady(series.id, "g1", app.p3), 403);
    app.series.setSideReady(series.id, "g1", app.p1);
    app.series.setSideReady(series.id, "g1", app.p2);
    expect(app.series.dueNextGames(Date.now(), 10)).toHaveLength(1);

    const cleared = app.series.clearSideReady(series.id, "g1", app.p1);
    expect(cleared.readyCleared).toBe(true);
    expect(cleared.series.sideReady[index]).toBe(false);
    expect(cleared.series.sideReady[index === 0 ? 1 : 0]).toBe(true);
    expect(app.series.dueNextGames(Date.now(), 10)).toEqual([]);
    expect(app.series.clearSideReady(series.id, "g1", app.p1).readyCleared).toBe(false);
  });

  it("reports whether a save cleared Ready, read inside the save", () => {
    const app = setup();
    const series = betweenGames(app);
    const deck = validDeck(1);
    const swapped: DuelDeck = {
      ...deck,
      main: [...deck.main.slice(1), deck.side[0] as number],
      side: [deck.main[0] as number, deck.side[1] as number],
    };
    // Not ready: a change clears nothing.
    expect(app.series.saveSideDeck(series.id, "g1", app.p1, swapped).readyCleared).toBe(false);
    // Ready lands after any snapshot the caller took: the save still sees it.
    app.series.setSideReady(series.id, "g1", app.p1);
    expect(app.series.saveSideDeck(series.id, "g1", app.p1, swapped).readyCleared).toBe(false);
    const saved = app.series.saveSideDeck(series.id, "g1", app.p1, deck);
    expect(saved.readyCleared).toBe(true);
    expect(saved.series.sideReady[series.playerIds.indexOf(app.p1)]).toBe(false);
    expect(saved.series).toEqual(app.series.get(series.id, "g1"));
  });

  it("rejects different cards, a changed side count and a small main deck", () => {
    const app = setup();
    const series = betweenGames(app);
    const deck = validDeck(1);
    expectStatus(() => app.series.setSideDeck(series.id, "g1", app.p1, { ...deck, main: [...deck.main.slice(1), 99999] }), 400);
    expectStatus(
      () => app.series.setSideDeck(series.id, "g1", app.p1, { ...deck, main: [...deck.main, deck.side[0] as number], side: [deck.side[1] as number] }),
      400,
    );
    expectStatus(
      () => app.series.setSideDeck(series.id, "g1", app.p1, { ...deck, main: deck.main.slice(2), side: [...deck.side, deck.main[0] as number, deck.main[1] as number] }),
      400,
    );
    // The same multiset and Side count do not permit Main or Extra to change size.
    expect(() =>
      app.series.setSideDeck(series.id, "g1", app.p1, { ...deck, main: [...deck.main, deck.extra[0] as number], extra: [deck.extra[1] as number] }),
    ).toThrow("The main deck must keep the same number of cards");
  });

  it("checks the main deck size against the base deck", () => {
    const app = setup();
    const started = app.series.createChallenge({ guildId: "g1", challengerPlayerId: app.p1, opponentPlayerId: app.p2, bestOf: 3, ranked: false, mode: "normal", settings: { validateDeck: false } });
    const small: DuelDeck = { main: Array.from({ length: 10 }, (_, i) => i + 1), extra: [], side: [500, 501] };
    app.duels.setDeck(started.duel.slug, "g1", app.p1, small);
    app.duels.setDeck(started.duel.slug, "g1", app.p2, validDeck(1000));
    playGame(app, started.duel.slug, app.p2);
    // Base main is 10, so the minimum is 10: moving a main card to side is not allowed (side count), but a swap is.
    const swapped: DuelDeck = { main: [...small.main.slice(1), 500], extra: [], side: [1, 501] };
    expect(() => app.series.setSideDeck(started.series.id, "g1", app.p1, swapped)).not.toThrow();
    const tooMany: DuelDeck = { main: Array.from({ length: 61 }, (_, i) => i + 1), extra: [], side: [] };
    expectStatus(() => app.series.setSideDeck(started.series.id, "g1", app.p2, tooMany), 400);
  });
});

describe("tournament series", () => {
  function tournamentSetup(bestOf: 1 | 3 = 3) {
    const app = setup();
    const t = app.tournaments.create("g1", "Cup", "single_elim", "u3", { bestOf });
    app.tournaments.join(t.id, app.p1);
    app.tournaments.join(t.id, app.p2);
    app.tournaments.start(t.id);
    const slot = app.db.prepare("select * from tournament_matches where tournament_id = ?").get(t.id) as Record<string, any>;
    const register = (playerId: number, deck: DuelDeck) =>
      app.db.prepare("update tournament_participants set deck_json = ? where tournament_id = ? and player_id = ?").run(JSON.stringify(deck), t.id, playerId);
    return { app, t, slot, register };
  }

  it("rejects a missing deck, a stranger, a BYE and an inactive tournament", () => {
    const { app, t, slot, register } = tournamentSetup();
    expectStatus(() => app.series.startTournamentMatch({ guildId: "g1", tournamentMatchId: slot.id, actorPlayerId: app.p1 }), 409);
    register(app.p1, validDeck(1));
    register(app.p2, validDeck(1000));
    const stranger = insertPlayer(app.db, "g1", "u7", "Tea");
    expectStatus(() => app.series.startTournamentMatch({ guildId: "g1", tournamentMatchId: slot.id, actorPlayerId: stranger }), 403);
    expectStatus(() => app.series.startTournamentMatch({ guildId: "g2", tournamentMatchId: slot.id, actorPlayerId: app.p1 }), 404);
    expectStatus(() => app.series.startTournamentMatch({ guildId: "g1", tournamentMatchId: 9999, actorPlayerId: app.p1 }), 404);
    app.db.prepare("update tournament_matches set player_two_id = null where id = ?").run(slot.id);
    expectStatus(() => app.series.startTournamentMatch({ guildId: "g1", tournamentMatchId: slot.id, actorPlayerId: app.p1 }), 400);
    app.db.prepare("update tournament_matches set player_two_id = ? where id = ?").run(app.p2, slot.id);
    app.db.prepare("update tournaments set status = 'completed' where id = ?").run(t.id);
    expectStatus(() => app.series.startTournamentMatch({ guildId: "g1", tournamentMatchId: slot.id, actorPlayerId: app.p1 }), 409);
  });

  it("rejects a slot with a pending manual report", () => {
    const { app, t, slot, register } = tournamentSetup();
    register(app.p1, validDeck(1));
    register(app.p2, validDeck(1000));
    app.tournaments.report(t.id, app.p1, app.p2, app.p1);
    expectStatus(() => app.series.startTournamentMatch({ guildId: "g1", tournamentMatchId: slot.id, actorPlayerId: app.p1 }), 409);
  });

  it("starts a series with preloaded decks, is idempotent, and lets the organizer start it", () => {
    const { app, t, slot, register } = tournamentSetup();
    register(app.p1, validDeck(1));
    register(app.p2, validDeck(1000));
    const first = app.series.startTournamentMatch({ guildId: "g1", tournamentMatchId: slot.id, actorPlayerId: app.p2 });
    expect(first.created).toBe(true);
    expect(first.series).toMatchObject({
      bestOf: 3,
      status: "active",
      tournamentId: t.id,
      tournamentMatchId: slot.id,
      playerIds: [slot.player_one_id, slot.player_two_id],
    });
    expect(first.series.tournamentSlug).toBeTruthy();
    expect(first.duel.name).toBe(`Cup · Round ${slot.round_number}`);
    expect(first.duel.organizerPlayerId).toBe(slot.player_one_id);
    expect(first.duel.settings.visibility).toBe("private");
    expect(first.duel.seats.every((seat) => !seat.ready)).toBe(true);
    expect(app.duels.privateState(first.duel.slug, "g1").decks).toHaveLength(2);
    expect(app.series.openForTournamentMatch(slot.id)?.id).toBe(first.series.id);

    const again = app.series.startTournamentMatch({ guildId: "g1", tournamentMatchId: slot.id, actorPlayerId: app.p1 });
    expect(again.created).toBe(false);
    expect(again.series.id).toBe(first.series.id);
    expect(again.duel.slug).toBe(first.duel.slug);

    const organizer = insertPlayer(app.db, "g1", "u3-org", "Organizer");
    app.db.prepare("update tournaments set created_by_user_id = 'u3-org' where id = ?").run(t.id);
    expect(app.series.startTournamentMatch({ guildId: "g1", tournamentMatchId: slot.id, actorPlayerId: organizer }).created).toBe(false);
  });

  it("markReady then start locks both decks", () => {
    const { app, t, slot, register } = tournamentSetup();
    register(app.p1, validDeck(1));
    register(app.p2, validDeck(1000));
    const { duel } = app.series.startTournamentMatch({ guildId: "g1", tournamentMatchId: slot.id, actorPlayerId: app.p1 });
    app.duels.markReady(duel.slug, "g1", app.p1);
    expect(app.series.dueStarts(10)).toEqual([]);
    app.duels.markReady(duel.slug, "g1", app.p2);
    expect(app.series.dueStarts(10)).toHaveLength(1);
    const locked = () =>
      app.db.prepare("select deck_locked_at from tournament_participants where tournament_id = ?").all(t.id) as Array<{ deck_locked_at: string | null }>;
    // The decks lock when the series snapshots them, so before the first activation too.
    expect(locked().every((row) => row.deck_locked_at !== null)).toBe(true);
    const stamp = locked().map((row) => row.deck_locked_at);
    start(app, duel.slug);
    expect(locked().map((row) => row.deck_locked_at)).toEqual(stamp);
  });

  it("a won Bo3 completes the slot, advances the bracket and scores", () => {
    const { app, t, slot, register } = tournamentSetup();
    register(app.p1, validDeck(1));
    register(app.p2, validDeck(1000));
    const { duel, series } = app.series.startTournamentMatch({ guildId: "g1", tournamentMatchId: slot.id, actorPlayerId: app.p1 });
    app.duels.markReady(duel.slug, "g1", app.p1);
    app.duels.markReady(duel.slug, "g1", app.p2);
    playGame(app, duel.slug, app.p2);
    expect((app.db.prepare("select status from tournament_matches where id = ?").get(slot.id) as { status: string }).status).toBe("open");
    const game2 = app.series.createNextGame(series.id, "g1");
    playGame(app, game2.slug, app.p2);

    const done = app.series.get(series.id, "g1");
    expect(done).toMatchObject({ status: "completed", winnerPlayerId: app.p2 });
    expect(app.series.openForTournamentMatch(slot.id)).toBeNull();
    const row = app.db.prepare("select * from tournament_matches where id = ?").get(slot.id) as Record<string, any>;
    expect(row.status).toBe("completed");
    const match = matchRows(app)[0] as Record<string, any>;
    expect(match).toMatchObject({ status: "approved", source: "tournament", tournament_id: t.id, winner_id: app.p2 });
    expect(row.match_id).toBe(match.id);
    expect(seriesRow(app, series.id).match_id).toBe(match.id);
    // Two-player single elimination: the final is done, so the tournament completes.
    expect((app.db.prepare("select status from tournaments where id = ?").get(t.id) as { status: string }).status).toBe("completed");
    expect(awardCount(app)).toBeGreaterThan(0);
  });

  it("a tournament Bo1 draw replays at once", () => {
    const { app, slot, register } = tournamentSetup(1);
    register(app.p1, validDeck(1));
    register(app.p2, validDeck(1000));
    const { duel, series } = app.series.startTournamentMatch({ guildId: "g1", tournamentMatchId: slot.id, actorPlayerId: app.p1 });
    app.duels.markReady(duel.slug, "g1", app.p1);
    app.duels.markReady(duel.slug, "g1", app.p2);
    playGame(app, duel.slug, null);
    const summary = app.series.get(series.id, "g1");
    expect(summary).toMatchObject({ status: "between_games", sideReady: [true, true], wins: [0, 0] });
    expect(app.series.dueNextGames(Date.now() + 1000, 10)).toEqual([{ seriesId: series.id, guildId: "g1" }]);
    expect(matchRows(app)).toHaveLength(0);
  });

  it("cancel frees the slot for a new series", () => {
    const { app, slot, register } = tournamentSetup();
    register(app.p1, validDeck(1));
    register(app.p2, validDeck(1000));
    const first = app.series.startTournamentMatch({ guildId: "g1", tournamentMatchId: slot.id, actorPlayerId: app.p1 });
    const { changedSlugs } = app.series.cancel(first.series.id, "g1");
    expect(changedSlugs).toEqual([first.duel.slug]);
    expect(app.series.openForTournamentMatch(slot.id)).toBeNull();
    const second = app.series.startTournamentMatch({ guildId: "g1", tournamentMatchId: slot.id, actorPlayerId: app.p1 });
    expect(second.created).toBe(true);
    expect(second.series.id).not.toBe(first.series.id);
  });
});

describe("tournament series guards", () => {
  function guardSetup(bestOf: 1 | 3 = 3, format: "single_elim" | "round_robin" = "single_elim") {
    const app = setup();
    const t = app.tournaments.create("g1", "Cup", format, "u3", { bestOf });
    app.tournaments.join(t.id, app.p1);
    app.tournaments.join(t.id, app.p2);
    app.tournaments.start(t.id);
    const slot = app.db.prepare("select * from tournament_matches where tournament_id = ?").get(t.id) as Record<string, any>;
    for (const [playerId, deck] of [[app.p1, validDeck(1)], [app.p2, validDeck(1000)]] as const) {
      app.db
        .prepare("update tournament_participants set deck_json = ? where tournament_id = ? and player_id = ?")
        .run(JSON.stringify(deck), t.id, playerId);
    }
    const started = app.series.startTournamentMatch({ guildId: "g1", tournamentMatchId: slot.id, actorPlayerId: app.p1 });
    const ready = () => {
      app.duels.markReady(started.duel.slug, "g1", app.p1);
      app.duels.markReady(started.duel.slug, "g1", app.p2);
    };
    return { app, t, slot, started, ready };
  }

  const duelRow = (app: App, slug: string) =>
    app.db.prepare("select status, result_reason, archived_at from duels where web_slug = ?").get(slug) as Record<string, any>;

  it("refuses a Discord report while an online series is open", () => {
    const { app, t, slot, started } = guardSetup();
    expect.assertions(9);
    for (const work of [
      () => app.tournaments.report(t.id, app.p1, app.p2, app.p1),
      () => app.tournaments.reportTournamentMatch(slot.id, app.p1, app.p1),
    ]) {
      try {
        work();
      } catch (error) {
        expect(error).toBeInstanceOf(TournamentDuelError);
        expect((error as TournamentDuelError).status).toBe(409);
        expect((error as Error).message).toMatch(/online duel series/);
      }
    }
    expect(matchRows(app)).toHaveLength(0);
    expect((app.db.prepare("select status from tournament_matches where id = ?").get(slot.id) as { status: string }).status).toBe("open");
    // Cancelling the series frees the slot for a manual report.
    app.series.cancel(started.series.id, "g1");
    expect(app.tournaments.reportTournamentMatch(slot.id, app.p1, app.p1).status).toBe("pending");
  });

  it("cancelling a tournament cancels its open series and lobby game", () => {
    const { app, t, slot, started } = guardSetup();
    const result = app.tournaments.cancelWithChanges(t.id);
    expect(result.tournament.status).toBe("cancelled");
    expect(result.changedDuelSlugs).toEqual([started.duel.slug]);
    expect(app.series.get(started.series.id, "g1").status).toBe("cancelled");
    expect(duelRow(app, started.duel.slug)).toMatchObject({ status: "cancelled", result_reason: "Series cancelled" });
    expect(duelRow(app, started.duel.slug).archived_at).toBeTruthy();
    expect(app.series.openForTournamentMatch(slot.id)).toBeNull();
  });

  it("completing a tournament cancels its open series", () => {
    const { app, t, started } = guardSetup();
    const result = app.tournaments.completeWithChanges(t.id);
    expect(result.tournament.status).toBe("completed");
    expect(result.changedDuelSlugs).toEqual([started.duel.slug]);
    expect(app.series.get(started.series.id, "g1").status).toBe("cancelled");
  });

  it("closing a tournament at its deadline cancels its open series", () => {
    const { app, t, started } = guardSetup();
    app.tournaments.closeForDeadline(t.id);
    expect(app.series.get(started.series.id, "g1").status).toBe("cancelled");
    expect(duelRow(app, started.duel.slug).status).toBe("cancelled");
  });

  it("closeForDeadlineWithChanges returns the games to notify", () => {
    const { app, t, started } = guardSetup();
    const result = app.tournaments.closeForDeadlineWithChanges(t.id);
    expect(result.tournament.status).toBe("completed");
    expect(result.changedDuelSlugs).toEqual([started.duel.slug]);
    expect(app.series.get(started.series.id, "g1").status).toBe("cancelled");
    // A second close finds the tournament already closed and changes nothing.
    expect(app.tournaments.closeForDeadlineWithChanges(t.id).changedDuelSlugs).toEqual([]);
  });

  it("a game that ends after the tournament closed records nothing", () => {
    const { app, t, slot, started, ready } = guardSetup(1);
    ready();
    start(app, started.duel.slug);
    // The tournament closes by a path that does not touch the series.
    app.db.prepare("update tournaments set status = 'completed' where id = ?").run(t.id);
    app.duels.complete(started.duel.slug, "g1", 0, "done");
    expect(app.series.get(started.series.id, "g1")).toMatchObject({ status: "cancelled", wins: [0, 0], winnerPlayerId: null });
    expect(matchRows(app)).toHaveLength(0);
    expect((app.db.prepare("select status from tournament_matches where id = ?").get(slot.id) as { status: string }).status).toBe("open");
  });

  it("createNextGame closes the series when the tournament is no longer active", () => {
    const { app, t, started, ready } = guardSetup(3);
    ready();
    playGame(app, started.duel.slug, app.p1);
    app.db.prepare("update tournaments set status = 'cancelled' where id = ?").run(t.id);
    expectStatus(() => app.series.createNextGame(started.series.id, "g1"), 409);
    // The close must survive the thrown error.
    expect(app.series.get(started.series.id, "g1").status).toBe("cancelled");
    expect(app.db.prepare("select count(*) as c from duels where series_id = ?").get(started.series.id)).toEqual({ c: 1 });
  });

  it("logs a tournament result failure and preserves the completed duel and series", () => {
    const { app, slot, started, ready } = guardSetup(1);
    ready();
    start(app, started.duel.slug);
    app.db.prepare("update tournament_matches set status = 'completed' where id = ?").run(slot.id);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => app.duels.complete(started.duel.slug, "g1", seatOf(started.duel, app.p1), "done")).not.toThrow();
      expect(seriesRow(app, started.series.id)).toMatchObject({ status: "completed", wins0: 1, wins1: 0, winner_player_id: app.p1, match_id: null, ended_at: expect.any(String) });
      expect(duelRow(app, started.duel.slug)).toMatchObject({ status: "completed", archived_at: expect.any(String) });
      expect(matchRows(app)).toHaveLength(0);
      expect(app.series.openForTournamentMatch(slot.id)).toBeNull();
      expect(spy).toHaveBeenCalledTimes(1);
      const logged = spy.mock.calls[0]!
        .map((arg) => JSON.stringify(arg, (_key, value) => (value instanceof Error ? value.message : value)))
        .join(" ");
      expect(logged).toContain(`"seriesId":${started.series.id}`);
      expect(logged).toContain(`"tournamentMatchId":${slot.id}`);
      expect(logged).toContain(`"duelId":${started.duel.id}`);
      expect(logged).toContain("already completed");
    } finally {
      spy.mockRestore();
    }
    app.db.prepare("update tournament_matches set status = 'open' where id = ?").run(slot.id);
    const store = createSeriesStore(app.db);
    expect(store.listUnrecordedResults("g1").map((row) => row.id)).toEqual([started.series.id]);
    expect(store.retryResult(started.series.id, "g1")).toMatchObject({ ok: true });
    const match = matchRows(app)[0]!;
    expect(seriesRow(app, started.series.id)).toMatchObject({ status: "completed", match_id: match.id });
    expect(app.db.prepare("select status, match_id from tournament_matches where id = ?").get(slot.id))
      .toEqual({ status: "completed", match_id: match.id });
    expect(store.retryResult(started.series.id, "g1")).toMatchObject({ ok: true, match: { id: match.id } });
    expect(matchRows(app)).toHaveLength(1);
  });

  it("a failed series link rolls back slot completion, tournament progression and scoring", () => {
    const { app, t, slot, started, ready } = guardSetup(1);
    ready();
    start(app, started.duel.slug);
    const beforeSlot = app.db.prepare("select * from tournament_matches where id = ?").get(slot.id);
    const beforeTournament = app.db.prepare("select * from tournaments where id = ?").get(t.id);
    app.db.exec(`
      create temp trigger fail_series_link before update of match_id on duel_series
      when new.match_id is not null
      begin select raise(abort, 'forced series link failure'); end;
    `);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => app.duels.complete(started.duel.slug, "g1", seatOf(started.duel, app.p1), "done")).not.toThrow();
    } finally {
      spy.mockRestore();
    }
    expect(app.duels.get(started.duel.slug, "g1").status).toBe("completed");
    expect(seriesRow(app, started.series.id)).toMatchObject({ status: "completed", winner_player_id: app.p1, match_id: null });
    expect(app.db.prepare("select * from tournament_matches where id = ?").get(slot.id)).toEqual(beforeSlot);
    expect(app.db.prepare("select * from tournaments where id = ?").get(t.id)).toEqual(beforeTournament);
    expect(matchRows(app)).toHaveLength(0);
    expect(awardCount(app)).toBe(0);
    expect(app.db.prepare("select * from player_ratings").all()).toEqual([]);
    const store = createSeriesStore(app.db);
    expect(store.listUnrecordedResults("g1").map((row) => row.id)).toEqual([started.series.id]);
    app.db.exec("drop trigger fail_series_link");
    expect(() => app.series.startTournamentMatch({ guildId: "g1", tournamentMatchId: slot.id, actorPlayerId: app.p2 }))
      .toThrow(/awaiting.*record/);
    expect(app.db.prepare("select count(*) as c from duel_series where tournament_match_id = ?").get(slot.id)).toEqual({ c: 1 });
    const repaired = store.retryResult(started.series.id, "g1");
    const match = matchRows(app)[0]!;
    expect(repaired).toMatchObject({ ok: true, match: { id: match.id, winnerId: app.p1, source: "tournament" } });
    expect(app.db.prepare("select status, match_id from tournament_matches where id = ?").get(slot.id)).toEqual({ status: "completed", match_id: match.id });
    expect((app.db.prepare("select status from tournaments where id = ?").get(t.id) as { status: string }).status).toBe("completed");
    const awards = app.db.prepare("select * from point_awards").all();
    const ratings = app.db.prepare("select * from player_ratings").all();
    expect(awards.length).toBeGreaterThan(0);
    expect(store.retryResult(started.series.id, "g1")).toEqual(repaired);
    expect(matchRows(app)).toHaveLength(1);
    expect(app.db.prepare("select * from point_awards").all()).toEqual(awards);
    expect(app.db.prepare("select * from player_ratings").all()).toEqual(ratings);
  });

  it.each(["single_elim", "round_robin"] as const)("rolls back failed %s placement scoring and season creation", (format) => {
    const { app, t, slot, started, ready } = guardSetup(1, format);
    ready();
    start(app, started.duel.slug);
    const beforeSlot = app.db.prepare("select * from tournament_matches where id = ?").get(slot.id);
    const beforeTournament = app.db.prepare("select * from tournaments where id = ?").get(t.id);
    app.db.exec(`
      create temp trigger fail_scoring before insert on point_awards
      when new.kind = 'placement'
      begin select raise(abort, 'forced placement failure'); end;
    `);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => app.duels.complete(started.duel.slug, "g1", seatOf(started.duel, app.p1), "done")).not.toThrow();
    } finally {
      spy.mockRestore();
    }
    expect(app.duels.get(started.duel.slug, "g1").status).toBe("completed");
    expect(seriesRow(app, started.series.id)).toMatchObject({ status: "completed", winner_player_id: app.p1, match_id: null });
    expect(app.db.prepare("select * from tournament_matches where id = ?").get(slot.id)).toEqual(beforeSlot);
    expect(app.db.prepare("select * from tournaments where id = ?").get(t.id)).toEqual(beforeTournament);
    const store = createSeriesStore(app.db);
    expect(store.listUnrecordedResults("g1").map((row) => row.id)).toEqual([started.series.id]);
    expect(store.retryResult(started.series.id, "g1")).toEqual({ ok: false, error: "forced placement failure" });
    expect(matchRows(app)).toEqual([]);
    for (const table of ["point_awards", "player_ratings", "season_standings", "seasons", "player_achievements"]) {
      expect(app.db.prepare(`select * from ${table}`).all()).toEqual([]);
    }
    app.db.exec("drop trigger fail_scoring");
    const repaired = store.retryResult(started.series.id, "g1");
    expect(repaired).toMatchObject({ ok: true, match: { winnerId: app.p1 } });
    expect(app.db.prepare("select status from tournaments where id = ?").get(t.id)).toEqual({ status: "completed" });
    expect(app.db.prepare("select kind from point_awards order by id").all()).toEqual([{ kind: "placement" }, { kind: "match_win" }]);
    const ratings = app.db.prepare("select * from player_ratings order by player_id").all();
    expect(store.retryResult(started.series.id, "g1")).toEqual(repaired);
    expect(awardCount(app)).toBe(2);
    expect(app.db.prepare("select * from player_ratings order by player_id").all()).toEqual(ratings);
    expect(store.listUnrecordedResults("g1")).toEqual([]);
  });

  it.each([
    ["organizer", false], ["manual report", false],
    ["organizer", true], ["manual report", true],
  ] as const)("retry retires an existing %s result without changing it (legacy: %s)", (resultKind, legacy) => {
    const { app, slot, started, ready } = guardSetup(1);
    ready();
    start(app, started.duel.slug);
    app.db.exec(`
      create temp trigger fail_match_save before insert on matches
      begin select raise(abort, 'forced match save failure'); end;
    `);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => app.duels.complete(started.duel.slug, "g1", seatOf(started.duel, app.p1), "done")).not.toThrow();
    } finally {
      spy.mockRestore();
    }
    app.db.exec("drop trigger fail_match_save");
    if (legacy) {
      app.db.prepare("update duel_series set settings_json = json_remove(settings_json, '$.resultMatchIdWatermark') where id = ?")
        .run(started.series.id);
    }
    if (resultKind === "organizer") {
      createTournamentDuelService(app.db).setResultByOrganizer({ tournamentMatchId: slot.id, organizerUserId: "u3", winnerPlayerId: app.p2 });
    } else {
      app.tournaments.reportTournamentMatch(slot.id, app.p2, app.p2);
    }
    const existingSlot = app.db.prepare("select * from tournament_matches where id = ?").get(slot.id);
    const existingMatches = matchRows(app);
    const existingAwards = app.db.prepare("select * from point_awards").all();
    const existingRatings = app.db.prepare("select * from player_ratings").all();
    const store = createSeriesStore(app.db);
    expect(store.retryResult(started.series.id, "g1")).toEqual({
      ok: false,
      error: "superseded",
      code: "superseded",
    });
    expect(app.db.prepare("select * from tournament_matches where id = ?").get(slot.id)).toEqual(existingSlot);
    expect(matchRows(app)).toEqual(existingMatches);
    expect(app.db.prepare("select * from point_awards").all()).toEqual(existingAwards);
    expect(app.db.prepare("select * from player_ratings").all()).toEqual(existingRatings);
    expect(seriesRow(app, started.series.id)).toMatchObject({ status: "completed", winner_player_id: app.p1, match_id: null });
    expect(store.listUnrecordedResults("g1")).toEqual([]);
  });

  it.each([false, true])("retires a pending result when a newer series exists, even if the newer series was cancelled (legacy: %s)", (legacy) => {
    const { app, slot, started, ready } = guardSetup(1);
    ready();
    app.db.exec(`
      create temp trigger fail_match_save before insert on matches
      begin select raise(abort, 'forced match save failure'); end;
    `);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      playGame(app, started.duel.slug, app.p1);
    } finally {
      spy.mockRestore();
    }
    app.db.exec("drop trigger fail_match_save");
    if (legacy) {
      app.db.prepare("update duel_series set settings_json = json_remove(settings_json, '$.resultMatchIdWatermark') where id = ?")
        .run(started.series.id);
    }
    const store = createSeriesStore(app.db);
    const terminalSeries = seriesRow(app, started.series.id);
    expect(store.listUnrecordedResults("g1").map((row) => row.id)).toEqual([started.series.id]);
    // Seed a later cancelled replay to exercise supersession without a manual match.
    store.insertSeries("g1", 1, 0, app.p1, app.p2, "cancelled", "normal", 5, terminalSeries.settings_json,
      null, null, null, null, app.p1, slot.id);
    expect(store.listUnrecordedResults("g1")).toEqual([]);
    expect(store.retryResult(started.series.id, "g1")).toEqual({ ok: false, error: "superseded", code: "superseded" });
    expect(seriesRow(app, started.series.id)).toEqual(terminalSeries);
    expect(matchRows(app)).toEqual([]);
    expect(awardCount(app)).toBe(0);
    expect(app.db.prepare("select status, match_id from tournament_matches where id = ?").get(slot.id)).toEqual({ status: "open", match_id: null });
  });

  it("retries a legacy result when the slot has no match history", () => {
    const { app, slot, started, ready } = guardSetup(1);
    ready();
    app.db.exec(`
      create temp trigger fail_match_save before insert on matches
      begin select raise(abort, 'forced match save failure'); end;
    `);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      playGame(app, started.duel.slug, app.p1);
    } finally {
      spy.mockRestore();
    }
    app.db.exec("drop trigger fail_match_save");
    app.db.prepare("update duel_series set settings_json = json_remove(settings_json, '$.resultMatchIdWatermark') where id = ?")
      .run(started.series.id);
    expect(matchRows(app)).toEqual([]);
    const store = createSeriesStore(app.db);
    expect(store.listUnrecordedResults("g1").map((row) => row.id)).toEqual([started.series.id]);
    const repaired = store.retryResult(started.series.id, "g1");
    expect(repaired).toMatchObject({ ok: true, match: { winnerId: app.p1, status: "approved" } });
    const match = matchRows(app)[0]!;
    expect(seriesRow(app, started.series.id).match_id).toBe(match.id);
    expect(app.db.prepare("select status, match_id from tournament_matches where id = ?").get(slot.id))
      .toEqual({ status: "completed", match_id: match.id });
    expect(store.retryResult(started.series.id, "g1")).toEqual(repaired);
    expect(matchRows(app)).toHaveLength(1);
    expect(store.listUnrecordedResults("g1")).toEqual([]);
  });

  it.each(["-1 day", "+0 seconds", "+1 day"])("keeps a legacy result visible for reconciliation after resolve and reopen (match timestamp: %s)", (offset) => {
    const { app, slot, started, ready } = guardSetup(1, "round_robin");
    ready();
    app.db.exec(`
      create temp trigger fail_match_save before insert on matches
      begin select raise(abort, 'forced match save failure'); end;
    `);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      playGame(app, started.duel.slug, app.p1);
    } finally {
      spy.mockRestore();
    }
    app.db.exec("drop trigger fail_match_save");
    app.db.prepare("update duel_series set settings_json = json_remove(settings_json, '$.resultMatchIdWatermark') where id = ?")
      .run(started.series.id);
    createTournamentDuelService(app.db).setResultByOrganizer({ tournamentMatchId: slot.id, organizerUserId: "u3", winnerPlayerId: app.p2 });
    app.tournaments.reopenTournamentMatch(slot.id, "u3");
    const terminalSeries = seriesRow(app, started.series.id);
    app.db.prepare("update matches set created_at = datetime(?, ?), resolved_at = datetime(?, ?)")
      .run(terminalSeries.ended_at, offset, terminalSeries.ended_at, offset);
    const beforeRetry = {
      matches: matchRows(app),
      awards: app.db.prepare("select * from point_awards").all(),
      ratings: app.db.prepare("select * from player_ratings").all(),
      slots: app.db.prepare("select * from tournament_matches").all(),
    };
    expect(beforeRetry.matches[0]).toMatchObject({ status: "denied", winner_id: app.p2 });
    const store = createSeriesStore(app.db);
    expect(store.listUnrecordedResults("g1")).toEqual([{ ...terminalSeries, needsReconciliation: true }]);
    expect(store.retryResult(started.series.id, "g1")).toEqual({ ok: false, error: "needs_reconciliation", code: "needs_reconciliation" });
    expect({
      matches: matchRows(app),
      awards: app.db.prepare("select * from point_awards").all(),
      ratings: app.db.prepare("select * from player_ratings").all(),
      slots: app.db.prepare("select * from tournament_matches").all(),
    }).toEqual(beforeRetry);
    expect(seriesRow(app, started.series.id)).toEqual(terminalSeries);
    expect(() => app.series.startTournamentMatch({ guildId: "g1", tournamentMatchId: slot.id, actorPlayerId: app.p1 }))
      .toThrow(/awaiting.*record/);
  });

  it.each([[false, false], [true, false], [false, true], [true, true]] as const)("allows an organizer to resolve, reopen and replay a failed result (replay recording fails: %s, legacy: %s)", (failReplay, legacy) => {
    const { app, t, slot, started, ready } = guardSetup(1, "round_robin");
    ready();
    app.db.exec(`
      create temp trigger fail_match_save before insert on matches
      begin select raise(abort, 'forced match save failure'); end;
    `);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      playGame(app, started.duel.slug, app.p1);
    } finally {
      spy.mockRestore();
    }
    app.db.exec("drop trigger fail_match_save");
    const terminalSeries = seriesRow(app, started.series.id);
    const terminalDuel = app.duels.get(started.duel.slug, "g1");
    const store = createSeriesStore(app.db);
    createTournamentDuelService(app.db).setResultByOrganizer({ tournamentMatchId: slot.id, organizerUserId: "u3", winnerPlayerId: app.p2 });
    app.tournaments.reopenTournamentMatch(slot.id, "u3");
    if (legacy) {
      app.db.prepare("update matches set created_at = ?, resolved_at = ?")
        .run(terminalSeries.ended_at, terminalSeries.ended_at);
    }
    expect(matchRows(app)[0]).toMatchObject({ status: "denied", winner_id: app.p2 });
    const reconciledMatches = matchRows(app);
    expect(store.listUnrecordedResults("g1")).toEqual([]);
    expect(store.retryResult(started.series.id, "g1")).toEqual({ ok: false, error: "superseded", code: "superseded" });
    expect(matchRows(app)).toEqual(reconciledMatches);
    expect(app.db.prepare("select status, match_id from tournament_matches where id = ?").get(slot.id)).toEqual({ status: "open", match_id: null });
    const replay = app.series.startTournamentMatch({ guildId: "g1", tournamentMatchId: slot.id, actorPlayerId: app.p1 });
    expect(replay.created).toBe(true);
    expect(replay.series.id).not.toBe(started.series.id);
    app.duels.markReady(replay.duel.slug, "g1", app.p1);
    app.duels.markReady(replay.duel.slug, "g1", app.p2);
    if (failReplay) {
      app.db.exec(`
        create temp trigger fail_replay_scoring before insert on point_awards
        when new.kind = 'match_win'
        begin select raise(abort, 'forced replay scoring failure'); end;
      `);
    }
    const replaySpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      playGame(app, replay.duel.slug, failReplay && legacy ? app.p1 : app.p2);
    } finally {
      replaySpy.mockRestore();
    }
    if (legacy) {
      // Simulate a replay completed before result watermarks were introduced.
      app.db.prepare("update duel_series set settings_json = json_remove(settings_json, '$.resultMatchIdWatermark') where id = ?")
        .run(replay.series.id);
    }
    if (failReplay) {
      // Equal timestamps must not make the earlier denied result supersede the replay.
      const endedAt = seriesRow(app, replay.series.id).ended_at;
      app.db.prepare("update matches set created_at = ?, resolved_at = ? where id = ?").run(endedAt, endedAt, reconciledMatches[0]!.id);
      expect(store.listUnrecordedResults("g1").map((row) => row.id)).toEqual([replay.series.id]);
      app.db.exec("drop trigger fail_replay_scoring");
      if (legacy) {
        const terminalReplay = seriesRow(app, replay.series.id);
        expect(terminalReplay).toMatchObject({ status: "completed", winner_player_id: app.p1, match_id: null });
        const beforeRetry = {
          matches: matchRows(app),
          awards: app.db.prepare("select * from point_awards").all(),
          ratings: app.db.prepare("select * from player_ratings").all(),
          slots: app.db.prepare("select * from tournament_matches").all(),
        };
        expect(store.listUnrecordedResults("g1")).toEqual([{ ...terminalReplay, needsReconciliation: true }]);
        expect(store.retryResult(replay.series.id, "g1")).toEqual({ ok: false, error: "needs_reconciliation", code: "needs_reconciliation" });
        expect({
          matches: matchRows(app),
          awards: app.db.prepare("select * from point_awards").all(),
          ratings: app.db.prepare("select * from player_ratings").all(),
          slots: app.db.prepare("select * from tournament_matches").all(),
        }).toEqual(beforeRetry);
        expect(seriesRow(app, replay.series.id)).toEqual(terminalReplay);
        expect(app.db.prepare("select status, match_id from tournament_matches where id = ?").get(slot.id)).toEqual({ status: "open", match_id: null });
        expect(store.retryResult(started.series.id, "g1")).toEqual({ ok: false, error: "superseded", code: "superseded" });
        expect(seriesRow(app, started.series.id)).toEqual(terminalSeries);
        expect(app.duels.get(started.duel.slug, "g1")).toEqual(terminalDuel);
        return;
      }
      expect(store.retryResult(replay.series.id, "g1")).toMatchObject({ ok: true, match: { winnerId: app.p2 } });
    }
    expect(app.series.get(replay.series.id, "g1")).toMatchObject({ status: "completed", winnerPlayerId: app.p2 });
    expect(app.db.prepare("select status from tournaments where id = ?").get(t.id)).toEqual({ status: "completed" });
    const recordedMatchId = seriesRow(app, replay.series.id).match_id;
    expect(recordedMatchId).not.toBeNull();
    expect(app.db.prepare("select status, match_id from tournament_matches where id = ?").get(slot.id)).toEqual({ status: "completed", match_id: recordedMatchId });
    const beforeRetry = {
      matches: matchRows(app),
      awards: app.db.prepare("select * from point_awards").all(),
      ratings: app.db.prepare("select * from player_ratings").all(),
      slots: app.db.prepare("select * from tournament_matches").all(),
    };
    expect(store.retryResult(started.series.id, "g1")).toEqual({ ok: false, error: "superseded", code: "superseded" });
    expect({
      matches: matchRows(app),
      awards: app.db.prepare("select * from point_awards").all(),
      ratings: app.db.prepare("select * from player_ratings").all(),
      slots: app.db.prepare("select * from tournament_matches").all(),
    }).toEqual(beforeRetry);
    expect(seriesRow(app, started.series.id)).toEqual(terminalSeries);
    expect(app.duels.get(started.duel.slug, "g1")).toEqual(terminalDuel);
    expect(store.listUnrecordedResults("g1")).toEqual([]);
  });

  it("retries a saved winner after corrupt bracket metadata is repaired", () => {
    const { app, t, started, ready } = guardSetup(1);
    ready();
    start(app, started.duel.slug);
    // A completed bye in the same round supplies a winner through metadata.
    const bye = app.db.prepare(`
      insert into tournament_matches (tournament_id, player_one_id, round_number, status, metadata_json)
      values (?, ?, 1, 'completed', 'not json')
    `).run(t.id, app.p3);
    const beforeSlots = app.db.prepare("select * from tournament_matches order by id").all();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => app.duels.complete(started.duel.slug, "g1", seatOf(started.duel, app.p1), "done")).not.toThrow();
    } finally {
      spy.mockRestore();
    }
    expect(app.duels.get(started.duel.slug, "g1").status).toBe("completed");
    expect(app.db.prepare("select * from tournament_matches order by id").all()).toEqual(beforeSlots);
    expect(matchRows(app)).toHaveLength(0);
    expect(awardCount(app)).toBe(0);
    const store = createSeriesStore(app.db);
    expect(store.retryResult(started.series.id, "g1")).toMatchObject({ ok: false, error: expect.any(String) });
    app.db.prepare("update tournament_matches set metadata_json = ? where id = ?")
      .run(JSON.stringify({ bye: true, winnerId: app.p3 }), Number(bye.lastInsertRowid));
    expect(store.retryResult(started.series.id, "g1")).toMatchObject({ ok: true, match: { winnerId: app.p1 } });
    expect(matchRows(app)).toHaveLength(1);
    expect(app.db.prepare("select count(*) as c from tournament_matches where tournament_id = ? and round_number = 2").get(t.id)).toEqual({ c: 1 });
    expect(store.listUnrecordedResults("g1")).toEqual([]);
  });

  it("a corrupt series deck does not stop a game from finishing", () => {
    const { app, started, ready } = guardSetup(3);
    ready();
    start(app, started.duel.slug);
    app.db.prepare("update duel_series set deck0_json = 'not json' where id = ?").run(started.series.id);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      app.duels.complete(started.duel.slug, "g1", seatOf(started.duel, app.p1), "done");
    } finally {
      spy.mockRestore();
    }
    expect(app.duels.get(started.duel.slug, "g1").status).toBe("completed");
    expect(seriesRow(app, started.series.id)).toMatchObject({ status: "between_games", wins0: 1 });
  });

  it("refuses a player cancel of a tournament series lobby", () => {
    const { app, started } = guardSetup();
    for (const playerId of [app.p1, app.p2]) {
      expectStatus(() => app.duels.cancel(started.duel.slug, "g1", playerId), 403);
    }
    expect(app.series.get(started.series.id, "g1").status).toBe("active");
    expect(duelRow(app, started.duel.slug).status).toBe("lobby");
  });

  it("refuses a player cancel of a later casual game lobby and keeps the wins", () => {
    const app = setup();
    const { duel, series } = challenge(app, 3);
    playGame(app, duel.slug, app.p1);
    const game2 = app.series.createNextGame(series.id, "g1");
    expect(game2.status).toBe("lobby");
    expectStatus(() => app.duels.cancel(game2.slug, "g1", app.p1), 403);
    expectStatus(() => app.duels.cancel(game2.slug, "g1", app.p2), 403);
    expect(app.series.get(series.id, "g1")).toMatchObject({ status: "active", wins: [1, 0] });
    // The explicit series cancel still works.
    app.series.cancel(series.id, "g1");
    expect(app.series.get(series.id, "g1").status).toBe("cancelled");
  });

  it("locks both decks when the series starts, before any game", () => {
    const { app, t, started } = guardSetup();
    const rows = app.db
      .prepare("select deck_locked_at from tournament_participants where tournament_id = ?")
      .all(t.id) as Array<{ deck_locked_at: string | null }>;
    expect(rows.every((row) => row.deck_locked_at !== null)).toBe(true);
    expect(started.duel.status).toBe("lobby");
    const duelsService = createTournamentDuelService(app.db);
    try {
      duelsService.registerDeck({ tournamentId: t.id, playerId: app.p1, savedDeckId: null, deck: validDeck(5) });
      throw new Error("expected a lock error");
    } catch (error) {
      expect(error).toBeInstanceOf(TournamentDuelError);
      expect((error as TournamentDuelError).status).toBe(409);
    }
  });

  it("returns the open series when a concurrent start wins the race", () => {
    const { app, slot, started } = guardSetup();
    let hide = true;
    const racy = new Proxy(app.db, {
      get(target, prop) {
        if (prop === "prepare") {
          return (sql: string) => {
            const statement = target.prepare(sql);
            if (!/select id from duel_series where tournament_match_id/.test(sql)) return statement;
            return new Proxy(statement, {
              get(inner, key) {
                if (key === "get") {
                  return (...args: unknown[]) => {
                    if (hide) {
                      hide = false;
                      return undefined;
                    }
                    return (inner.get as (...a: unknown[]) => unknown)(...args);
                  };
                }
                const value = Reflect.get(inner, key) as unknown;
                return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(inner) : value;
              },
            });
          };
        }
        const value = Reflect.get(target, prop) as unknown;
        return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
      },
    });
    const service = createDuelSeriesService(racy);
    const result = service.startTournamentMatch({ guildId: "g1", tournamentMatchId: slot.id, actorPlayerId: app.p2 });
    expect(hide).toBe(false);
    expect(result.created).toBe(false);
    expect(result.series.id).toBe(started.series.id);
    expect(result.duel.slug).toBe(started.duel.slug);
  });

  it("gives an open series with no game its first game instead of a second series", () => {
    const { app, slot, started } = guardSetup();
    app.db.prepare("delete from duel_seats where duel_id = ?").run(started.duel.id);
    app.db.prepare("delete from duels where id = ?").run(started.duel.id);
    const again = app.series.startTournamentMatch({ guildId: "g1", tournamentMatchId: slot.id, actorPlayerId: app.p1 });
    expect(again.created).toBe(false);
    expect(again.series.id).toBe(started.series.id);
    expect(again.duel.gameNumber).toBe(1);
    expect(again.duel.status).toBe("lobby");
    expect(again.duel.seats.every((seat) => !seat.ready)).toBe(true);
    expect(app.db.prepare("select count(*) as c from duel_series where tournament_match_id = ?").get(slot.id)).toEqual({ c: 1 });
  });
});

describe("room and list", () => {
  it("fills series for everyone and mySide only for a series player", () => {
    const app = setup();
    const { duel, series } = challenge(app, 3);
    const mine = app.duels.room(duel.slug, "g1", app.p1);
    expect(mine.series?.id).toBe(series.id);
    expect(mine.mySide?.currentDeck).toEqual(validDeck(1));
    expect(mine.mySide?.baseDeck).toEqual(validDeck(1));
    expect(app.duels.room(duel.slug, "g1", app.p2).mySide?.currentDeck).toEqual(validDeck(1000));
    app.duels.admit(duel.slug, "g1", app.p3, (app.db.prepare("select invite_code from duels where id = ?").get(duel.id) as { invite_code: string }).invite_code);
    const spectator = app.duels.room(duel.slug, "g1", app.p3);
    expect(spectator.series?.id).toBe(series.id);
    expect(spectator.mySide).toBeNull();
    const plain = app.duels.create({ guildId: "g1", organizerPlayerId: app.p3, name: "Plain", mode: "normal" });
    const plainRoom = app.duels.room(plain.slug, "g1", app.p3);
    expect(plainRoom.series).toBeNull();
    expect(plainRoom.mySide).toBeNull();
  });

  it("lists the series on its games", () => {
    const app = setup();
    const { duel, series } = challenge(app, 3);
    app.duels.create({ guildId: "g1", organizerPlayerId: app.p1, name: "Plain", mode: "normal" });
    const items = app.duels.list("g1", app.p1);
    expect(items.find((item) => item.slug === duel.slug)?.series?.id).toBe(series.id);
    expect(items.find((item) => item.name === "Plain")?.series).toBeNull();
  });
});
