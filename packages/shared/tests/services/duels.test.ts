import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { migrate } from "../../src/db/index.js";
import type { DuelCommand, DuelDeck, DuelEngineView } from "../../src/duels/index.js";
import { createDuelService, DuelServiceError, DUEL_LIVE_IDLE_AFTER_MS } from "../../src/services/duels.js";

function insertPlayer(db: Database.Database, guildId: string, discordUserId: string, displayName: string) {
  return Number(
    db.prepare("insert into players (guild_id, discord_user_id, display_name) values (?, ?, ?)").run(guildId, discordUserId, displayName)
      .lastInsertRowid,
  );
}

function validDeck(start = 1, deckMaster?: number): DuelDeck {
  const deck: DuelDeck = {
    main: Array.from({ length: 40 }, (_, index) => start + index),
    extra: [start + 100, start + 101],
    side: [start + 200],
  };
  if (deckMaster) deck.deckMaster = deckMaster;
  return deck;
}

function command(promptId: string): DuelCommand {
  return { promptId, revision: 1, answer: { choice: promptId } };
}

function board(viewer: 0 | 1 | null): DuelEngineView {
  const hand = (seat: 0 | 1) =>
    viewer === seat
      ? [{ controller: seat, location: 1, sequence: 0, position: 1, code: seat === 0 ? 111 : 222 }]
      : [{ controller: seat, location: 1, sequence: 0, position: 1 }];
  return {
    revision: 4,
    turn: 1,
    turnSeat: 0,
    phase: "end",
    seats: [
      {
        seat: 0,
        lp: 1000,
        hand: hand(0),
        deckCount: 30,
        extraCount: 0,
        extra: [],
        monsters: [],
        spells: [],
        graveyard: [],
        banished: [],
      },
      {
        seat: 1,
        lp: 0,
        hand: hand(1),
        deckCount: 30,
        extraCount: 0,
        extra: [],
        monsters: [],
        spells: [],
        graveyard: [],
        banished: [],
      },
    ],
    prompt: { id: "strip-me", seat: 0, kind: "choice", title: "Go", options: [] },
    chain: [],
    events: [],
    log: [],
    result: null,
  };
}

function setup() {
  const db = new Database(":memory:");
  migrate(db);
  const p1 = insertPlayer(db, "g1", "u1", "Yugi");
  const p2 = insertPlayer(db, "g1", "u2", "Kaiba");
  const p3 = insertPlayer(db, "g1", "u3", "Joey");
  const outsider = insertPlayer(db, "g2", "u9", "Marik");
  return { db, duels: createDuelService(db), p1, p2, p3, outsider };
}

function readyDuel(app: ReturnType<typeof setup>, mode: "normal" | "domain" = "normal") {
  const session = app.duels.create({ guildId: "g1", organizerPlayerId: app.p1, name: "Duel", mode });
  app.duels.takeSeat(session.slug, "g1", app.p2);
  app.duels.setDeck(session.slug, "g1", app.p1, validDeck(1));
  app.duels.setDeck(session.slug, "g1", app.p2, validDeck(1000, 12345678));
  return session;
}

function start(app: ReturnType<typeof setup>, slug: string, seed: string[] = ["s"], bundle = "v") {
  return app.duels.activate(slug, "g1", app.p1, seed, bundle, null);
}


describe("duel persistence invariants", () => {
  it("claims distinct relational seats and refuses a third occupant", () => {
    const app = setup();
    const created = app.duels.create({ guildId: "g1", organizerPlayerId: app.p1, name: "Seat claim", mode: "normal" });
    expect(created.seats[0]?.playerId).toBe(app.p1);
    expect(created.seats[0]?.isBot).toBe(false);
    expect(created.masterRule).toBe(5);

    const joined = app.duels.takeSeat(created.slug, "g1", app.p2);
    expect(joined.seats.map((seat) => [seat.seat, seat.playerId])).toEqual([
      [0, app.p1],
      [1, app.p2],
    ]);
    expect(app.duels.takeSeat(created.slug, "g1", app.p2).seats).toHaveLength(2);

    try {
      app.duels.takeSeat(created.slug, "g1", app.p3);
      throw new Error("expected join to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(DuelServiceError);
      expect((error as DuelServiceError).status).toBe(409);
    }

    expect(() =>
      app.db.prepare("insert into duel_seats (duel_id, seat, player_id, ready) values (?, 0, ?, 0)").run(created.id, app.p3),
    ).toThrow();
    expect(app.duels.get(created.slug, "g1").seats.map((seat) => seat.playerId).sort()).toEqual([app.p1, app.p2]);
  });

  it("stores a chosen master rule, defaults to 5, and rejects illegal values", () => {
    const app = setup();
    const mr3 = app.duels.create({ guildId: "g1", organizerPlayerId: app.p1, name: "MR3", mode: "normal", masterRule: 3 });
    expect(mr3.masterRule).toBe(3);
    expect(app.duels.get(mr3.slug, "g1").masterRule).toBe(3);

    const domain = app.duels.create({ guildId: "g1", organizerPlayerId: app.p1, name: "Domain", mode: "domain" });
    expect(domain.masterRule).toBe(5);

    try {
      app.duels.create({ guildId: "g1", organizerPlayerId: app.p1, name: "Bad", mode: "normal", masterRule: 6 as 5 });
      throw new Error("expected invalid master rule to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(DuelServiceError);
      expect((error as DuelServiceError).status).toBe(400);
    }

    const domainMr1 = app.duels.create({
      guildId: "g1",
      organizerPlayerId: app.p1,
      name: "Domain MR1",
      mode: "domain",
      masterRule: 1,
    });
    expect(domainMr1.masterRule).toBe(1);
  });

  it("lets only the seated owner set a shaped deck before start and marks ready", () => {
    const app = setup();
    const session = app.duels.create({ guildId: "g1", organizerPlayerId: app.p1, name: "Decks", mode: "domain" });
    app.duels.takeSeat(session.slug, "g1", app.p2);

    try {
      app.duels.setDeck(session.slug, "g1", app.p3, validDeck());
      throw new Error("expected unseated setDeck to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(DuelServiceError);
      expect((error as DuelServiceError).status).toBe(403);
    }

    try {
      app.duels.setDeck(session.slug, "g1", app.p1, { main: [1], extra: [], side: [] });
      throw new Error("expected undersized deck to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(DuelServiceError);
      expect((error as DuelServiceError).status).toBe(400);
    }

    const ready = app.duels.setDeck(session.slug, "g1", app.p1, validDeck(1, 99));
    expect(ready.seats.find((seat) => seat.playerId === app.p1)?.ready).toBe(true);
    expect(ready.seats.find((seat) => seat.playerId === app.p1)?.deckMaster).toBe(99);
    expect(JSON.stringify(ready)).not.toContain("seed");
    expect(ready).not.toHaveProperty("decks");
  });

  it("starts only with the organizer and exactly two ready seats, then locks decks", () => {
    const app = setup();
    const session = app.duels.create({ guildId: "g1", organizerPlayerId: app.p1, name: "Start", mode: "normal" });

    try {
      start(app, session.slug, ["seed-a"], "bundle-1");
      throw new Error("expected activate without two ready seats to fail");
    } catch (error) {
      expect((error as DuelServiceError).message).toMatch(/two ready players/);
    }

    app.duels.takeSeat(session.slug, "g1", app.p2);
    app.duels.setDeck(session.slug, "g1", app.p1, validDeck(1));

    try {
      start(app, session.slug, ["seed-a"], "bundle-1");
      throw new Error("expected activate with one ready seat to fail");
    } catch (error) {
      expect((error as DuelServiceError).status).toBe(400);
    }

    app.duels.setDeck(session.slug, "g1", app.p2, validDeck(500));

    try {
      app.duels.activate(session.slug, "g1", app.p2, ["seed-a"], "bundle-1", null);
      throw new Error("expected non-organizer activate to fail");
    } catch (error) {
      expect((error as DuelServiceError).status).toBe(403);
    }

    const active = start(app, session.slug, ["seed-a", "seed-b"], "bundle-1");
    expect(active.status).toBe("active");

    try {
      app.duels.setDeck(session.slug, "g1", app.p1, validDeck(8000));
      throw new Error("expected setDeck after start to fail");
    } catch (error) {
      expect((error as DuelServiceError).status).toBe(400);
    }

    const privateState = app.duels.privateState(session.slug, "g1");
    expect(privateState.decks[0]?.main[0]).toBe(1);
    expect(privateState.decks[1]?.main[0]).toBe(500);
    expect(privateState.seed).toEqual(["seed-a", "seed-b"]);
    expect(privateState.bundleVersion).toBe("bundle-1");
  });

  it("scopes reads and writes to guild and seated players", () => {
    const app = setup();
    const session = readyDuel(app);
    start(app, session.slug);

    try {
      app.duels.get(session.slug, "g2");
      throw new Error("expected cross-guild get to fail");
    } catch (error) {
      expect((error as DuelServiceError).status).toBe(404);
    }

    try {
      app.duels.takeSeat(session.slug, "g1", app.outsider);
      throw new Error("expected outsider join to fail");
    } catch (error) {
      expect((error as DuelServiceError).status).toBe(400);
    }

    const publicRoom = app.duels.room(session.slug, "g1", app.p1);
    expect(publicRoom.mySeat).toBe(0);
    expect(publicRoom.role).toBe("player");
    expect(publicRoom.myDeck?.main[0]).toBe(1);
    expect(publicRoom.engine).toBeNull();
    expect(publicRoom.metadataOnly).toBe(false);
    expect(publicRoom.session).not.toHaveProperty("seed");
    expect(publicRoom.session.archivedAt).toBeNull();

    const spectator = app.duels.room(session.slug, "g1", app.p3);
    expect(spectator.role).toBe("spectator");
    expect(spectator.mySeat).toBeNull();
    expect(spectator.myDeck).toBeNull();
    expect(spectator.engine).toBeNull();

    try {
      app.duels.room(session.slug, "g1", app.outsider);
      throw new Error("expected outsider room to fail");
    } catch (error) {
      expect((error as DuelServiceError).status).toBe(400);
    }

    const reentered = app.duels.join(session.slug, "g1", app.p1);
    expect(reentered.status).toBe("active");
    expect(reentered.seats.map((seat) => seat.playerId)).toEqual([app.p1, app.p2]);

    try {
      app.duels.takeSeat(session.slug, "g1", app.p3);
      throw new Error("expected unseated active claim to fail");
    } catch (error) {
      expect((error as DuelServiceError).status).toBe(409);
    }

    const lobby = app.duels.create({ guildId: "g1", organizerPlayerId: app.p1, name: "Open", mode: "normal" });
    const spectatorLobby = app.duels.room(lobby.slug, "g1", app.p3);
    expect(spectatorLobby.role).toBe("spectator");
    expect(spectatorLobby.mySeat).toBeNull();
    expect(spectatorLobby.myDeck).toBeNull();
  });

  it("journals accepted commands in order for replay and keeps public views free of foreign decks", () => {
    const app = setup();
    const session = readyDuel(app);
    start(app, session.slug, ["alpha"], "bundle-9");
    app.duels.recordCommand(session.slug, "g1", 0, command("first"), null);
    app.duels.recordCommand(session.slug, "g1", 1, command("second"), null);
    app.duels.recordCommand(session.slug, "g1", 0, command("third"), null);

    const privateState = app.duels.privateState(session.slug, "g1");
    expect(privateState.commands.map((entry) => [entry.seat, entry.command.promptId])).toEqual([
      [0, "first"],
      [1, "second"],
      [0, "third"],
    ]);

    const opponentRoom = app.duels.room(session.slug, "g1", app.p2);
    expect(opponentRoom.myDeck?.main[0]).toBe(1000);
    expect(JSON.stringify(opponentRoom)).not.toContain(JSON.stringify(privateState.decks[0]?.main));
    expect(JSON.stringify(app.duels.get(session.slug, "g1"))).not.toContain("alpha");
  });

  it("finalizes outcomes once without touching matches", () => {
    const app = setup();
    const session = readyDuel(app);
    start(app, session.slug);

    const completed = app.duels.complete(session.slug, "g1", 1, "life points");
    expect(completed.status).toBe("completed");
    expect(completed.winnerPlayerId).toBe(app.p2);
    expect(completed.winnerSeat).toBe(1);
    expect(completed.resultReason).toBe("life points");
    expect(completed.endedAt).toBeTruthy();

    const again = app.duels.complete(session.slug, "g1", 0, "should not overwrite");
    expect(again.status).toBe("completed");
    expect(again.winnerPlayerId).toBe(app.p2);
    expect(again.winnerSeat).toBe(1);
    expect(again.resultReason).toBe("life points");

    const interruptedAttempt = app.duels.interrupt(session.slug, "g1", "disconnect");
    expect(interruptedAttempt.status).toBe("completed");
    expect(interruptedAttempt.winnerPlayerId).toBe(app.p2);

    const other = readyDuel(app);
    start(app, other.slug, ["s2"]);
    const interrupted = app.duels.interrupt(other.slug, "g1", "engine crash");
    expect(interrupted.status).toBe("interrupted");
    expect(interrupted.winnerPlayerId).toBeNull();
    expect(interrupted.winnerSeat).toBeNull();
    const interruptAgain = app.duels.interrupt(other.slug, "g1", "later");
    expect(interruptAgain.resultReason).toBe("engine crash");
    const completeAfterInterrupt = app.duels.complete(other.slug, "g1", 0, "too late");
    expect(completeAfterInterrupt.status).toBe("interrupted");

    const drawDuel = readyDuel(app);
    start(app, drawDuel.slug, ["s3"]);
    const draw = app.duels.complete(drawDuel.slug, "g1", null, "draw");
    expect(draw.winnerPlayerId).toBeNull();
    expect(draw.winnerSeat).toBeNull();

    const matchCount = app.db.prepare<[], { n: number }>("select count(*) as n from matches").get();
    const awardCount = app.db.prepare<[], { n: number }>("select count(*) as n from point_awards").get();
    expect(matchCount?.n).toBe(0);
    expect(awardCount?.n).toBe(0);

    const terminalPublic = app.duels.room(session.slug, "g1", app.p3);
    expect(terminalPublic.session.status).toBe("completed");
    expect(terminalPublic.role).toBe("spectator");
    expect(terminalPublic.myDeck).toBeNull();
    expect(terminalPublic.engine).toBeNull();
    expect(terminalPublic.metadataOnly).toBe(true);
  });
});

describe("practice bot seats", () => {
  it("lets the organizer add a ready bot without creating a player row", () => {
    const app = setup();
    const session = app.duels.create({ guildId: "g1", organizerPlayerId: app.p1, name: "Solo", mode: "normal" });
    const playersBefore = app.db.prepare<[], { n: number }>("select count(*) as n from players").get();
    const withBot = app.duels.addPracticeBot(session.slug, "g1", app.p1, validDeck(9000));
    const playersAfter = app.db.prepare<[], { n: number }>("select count(*) as n from players").get();

    expect(playersAfter?.n).toBe(playersBefore?.n);
    expect(withBot.seats).toHaveLength(2);
    const bot = withBot.seats.find((seat) => seat.isBot);
    const human = withBot.seats.find((seat) => !seat.isBot);
    expect(human?.playerId).toBe(app.p1);
    expect(human?.isBot).toBe(false);
    expect(bot?.playerId).toBeNull();
    expect(bot?.isBot).toBe(true);
    expect(bot?.ready).toBe(true);
    expect(bot?.displayName).toBe("Practice Bot");
    expect(bot?.seat).not.toBe(human?.seat);

    try {
      app.duels.takeSeat(session.slug, "g1", app.p2);
      throw new Error("expected join to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(DuelServiceError);
      expect((error as DuelServiceError).status).toBe(409);
    }
  });

  it("rejects adding a bot unless the organizer has a vacant lobby seat", () => {
    const app = setup();
    const session = app.duels.create({ guildId: "g1", organizerPlayerId: app.p1, name: "Solo", mode: "normal" });

    try {
      app.duels.addPracticeBot(session.slug, "g1", app.p2, validDeck(9000));
      throw new Error("expected non-organizer add to fail");
    } catch (error) {
      expect((error as DuelServiceError).status).toBe(403);
    }

    app.duels.takeSeat(session.slug, "g1", app.p2);
    try {
      app.duels.addPracticeBot(session.slug, "g1", app.p1, validDeck(9000));
      throw new Error("expected occupied add to fail");
    } catch (error) {
      expect((error as DuelServiceError).status).toBe(409);
    }

    const open = app.duels.create({ guildId: "g1", organizerPlayerId: app.p1, name: "Open", mode: "normal" });
    app.duels.addPracticeBot(open.slug, "g1", app.p1, validDeck(9000));
    try {
      app.duels.addPracticeBot(open.slug, "g1", app.p1, validDeck(8000));
      throw new Error("expected second bot to fail");
    } catch (error) {
      expect((error as DuelServiceError).status).toBe(409);
    }

    const started = readyDuel(app);
    start(app, started.slug);
    try {
      app.duels.addPracticeBot(started.slug, "g1", app.p1, validDeck(7000));
      throw new Error("expected active add to fail");
    } catch (error) {
      expect((error as DuelServiceError).status).toBe(400);
    }
  });

  it("lets the organizer remove the bot, leaving the seat open for a human and the bot addable again", () => {
    const app = setup();
    const session = app.duels.create({ guildId: "g1", organizerPlayerId: app.p1, name: "Solo", mode: "normal" });
    app.duels.addPracticeBot(session.slug, "g1", app.p1, validDeck(9000));
    const without = app.duels.removePracticeBot(session.slug, "g1", app.p1);

    expect(without.seats).toHaveLength(1);
    expect(without.seats[0].playerId).toBe(app.p1);
    expect(app.db.prepare<[], { n: number }>("select count(*) as n from duel_seats where is_bot = 1").get()?.n).toBe(0);

    const joined = app.duels.takeSeat(session.slug, "g1", app.p2);
    expect(joined.seats).toHaveLength(2);
    app.duels.leave(session.slug, "g1", app.p2);
    expect(app.duels.addPracticeBot(session.slug, "g1", app.p1, validDeck(8000)).seats.some((seat) => seat.isBot)).toBe(true);
  });

  it("rejects removing a bot for non-organizers, tables without a bot and started duels", () => {
    const app = setup();
    const session = app.duels.create({ guildId: "g1", organizerPlayerId: app.p1, name: "Solo", mode: "normal" });
    const status = (fn: () => unknown) => {
      try {
        fn();
      } catch (error) {
        return (error as DuelServiceError).status;
      }
      return null;
    };
    expect(status(() => app.duels.removePracticeBot(session.slug, "g1", app.p1))).toBe(409);

    app.duels.addPracticeBot(session.slug, "g1", app.p1, validDeck(9000));
    expect(status(() => app.duels.removePracticeBot(session.slug, "g1", app.p2))).toBe(403);
    expect(app.duels.get(session.slug, "g1").seats).toHaveLength(2);

    app.duels.setDeck(session.slug, "g1", app.p1, validDeck(1, 99));
    start(app, session.slug);
    expect(status(() => app.duels.removePracticeBot(session.slug, "g1", app.p1))).toBe(409);
    expect(app.duels.get(session.slug, "g1").seats.some((seat) => seat.isBot)).toBe(true);
  });

  it("starts a human-vs-bot lobby and records a bot win as winnerSeat without a player id", () => {
    const app = setup();
    const session = app.duels.create({ guildId: "g1", organizerPlayerId: app.p1, name: "Solo", mode: "domain" });
    app.duels.addPracticeBot(session.slug, "g1", app.p1, validDeck(9000, 48305365));
    app.duels.setDeck(session.slug, "g1", app.p1, validDeck(1, 99));
    const active = start(app, session.slug, ["seed"], "bundle");
    expect(active.status).toBe("active");
    expect(active.seats.filter((seat) => seat.ready)).toHaveLength(2);

    const botSeat = active.seats.find((seat) => seat.isBot)?.seat;
    expect(botSeat).toBe(1);
    const completed = app.duels.complete(session.slug, "g1", botSeat ?? -1, "life points");
    expect(completed.status).toBe("completed");
    expect(completed.winnerSeat).toBe(botSeat);
    expect(completed.winnerPlayerId).toBeNull();

    const drawDuel = app.duels.create({ guildId: "g1", organizerPlayerId: app.p1, name: "Draw", mode: "normal" });
    app.duels.addPracticeBot(drawDuel.slug, "g1", app.p1, validDeck(5000));
    app.duels.setDeck(drawDuel.slug, "g1", app.p1, validDeck(1));
    start(app, drawDuel.slug);
    const draw = app.duels.complete(drawDuel.slug, "g1", null, "draw");
    expect(draw.winnerSeat).toBeNull();
    expect(draw.winnerPlayerId).toBeNull();
  });
});

describe("duel snapshots archive and cancel", () => {
  it("saves role-redacted boards atomically and keeps opponent cards private", () => {
    const app = setup();
    const session = readyDuel(app);
    start(app, session.slug);
    const completed = app.duels.complete(session.slug, "g1", 1, "Surrender", {
      public: board(null),
      seat0: board(0),
      seat1: board(1),
    });
    expect(completed.status).toBe("completed");
    expect(completed.winnerSeat).toBe(1);

    const p1 = app.duels.room(session.slug, "g1", app.p1);
    const p2 = app.duels.room(session.slug, "g1", app.p2);
    const spec = app.duels.room(session.slug, "g1", app.p3);
    expect(p1.role).toBe("player");
    expect(p1.metadataOnly).toBe(false);
    expect(p1.engine?.prompt).toBeNull();
    expect(p1.engine?.result).toEqual({ winnerSeat: 1, reason: "Surrender" });
    expect(p1.engine?.seats[0]?.hand[0]?.code).toBe(111);
    expect(p1.engine?.seats[1]?.hand[0]?.code).toBeUndefined();
    expect(p2.engine?.seats[1]?.hand[0]?.code).toBe(222);
    expect(p2.engine?.seats[0]?.hand[0]?.code).toBeUndefined();
    expect(spec.role).toBe("spectator");
    expect(spec.engine?.seats[0]?.hand[0]?.code).toBeUndefined();
    expect(spec.engine?.seats[1]?.hand[0]?.code).toBeUndefined();
    expect(JSON.stringify(p1)).not.toContain("222");
    expect(JSON.stringify(p2)).not.toContain("111");
    expect(JSON.stringify(spec)).not.toContain("111");
    expect(JSON.stringify(p1.session)).not.toContain("snapshot");
    expect(p1.myDeck?.main[0]).toBe(1);
    expect(p2.myDeck?.main[0]).toBe(1000);
    expect(spec.myDeck).toBeNull();

    const overwritten = app.duels.complete(session.slug, "g1", 0, "should not replace", {
      public: board(null),
      seat0: board(0),
      seat1: board(1),
    });
    expect(overwritten.winnerSeat).toBe(1);
    expect(app.duels.room(session.slug, "g1", app.p1).engine?.result?.reason).toBe("Surrender");
  });

  it("keeps live listing separate from archived history and forbids active archive", () => {
    const app = setup();
    const liveLobby = app.duels.create({ guildId: "g1", organizerPlayerId: app.p1, name: "Live", mode: "normal" });
    const finished = readyDuel(app);
    start(app, finished.slug);
    app.duels.complete(finished.slug, "g1", 0, "life points", {
      public: board(null),
      seat0: board(0),
      seat1: board(1),
    });

    const live = app.duels.list("g1", app.p1);
    expect(live.map((row) => row.slug)).toEqual([liveLobby.slug]);
    expect(app.duels.get(finished.slug, "g1").archivedAt).toBeTruthy();
    expect(app.duels.list("g1", app.p1, { archived: true }).map((row) => row.slug)).toEqual([finished.slug]);

    try {
      app.duels.archive(liveLobby.slug, "g1", app.p1);
      throw new Error("expected lobby archive to fail");
    } catch (error) {
      expect((error as DuelServiceError).status).toBe(409);
    }

    const active = readyDuel(app);
    start(app, active.slug, ["s2"]);
    try {
      app.duels.archive(active.slug, "g1", app.p1);
      throw new Error("expected active archive to fail");
    } catch (error) {
      expect((error as DuelServiceError).status).toBe(409);
    }

    try {
      app.duels.archive(finished.slug, "g1", app.p2);
      throw new Error("expected non-organizer archive to fail");
    } catch (error) {
      expect((error as DuelServiceError).status).toBe(403);
    }

    const archived = app.duels.archive(finished.slug, "g1", app.p1);
    expect(archived.archivedAt).toBeTruthy();
    expect(archived.status).toBe("completed");
    expect(archived.winnerSeat).toBe(0);
    const again = app.duels.archive(finished.slug, "g1", app.p1);
    expect(again.archivedAt).toBe(archived.archivedAt);

    expect(app.duels.list("g1", app.p1).map((row) => row.slug)).toEqual([active.slug, liveLobby.slug]);
    expect(app.duels.list("g1", app.p1, { archived: true }).map((row) => row.slug)).toEqual([finished.slug]);

    const history = app.duels.room(finished.slug, "g1", app.p1);
    expect(history.engine?.seats[0]?.hand[0]?.code).toBe(111);
    expect(history.session.archivedAt).toBeTruthy();
    expect(app.db.prepare<[], { n: number }>("select count(*) as n from duels").get()?.n).toBeGreaterThanOrEqual(3);
  });

  it("cancels a lobby without inventing a winner and archives due terminals by timestamp", () => {
    const app = setup();
    const lobby = app.duels.create({ guildId: "g1", organizerPlayerId: app.p1, name: "Scratch", mode: "normal" });
    try {
      app.duels.cancel(lobby.slug, "g1", app.p2);
      throw new Error("expected non-organizer cancel to fail");
    } catch (error) {
      expect((error as DuelServiceError).status).toBe(403);
    }

    const cancelled = app.duels.cancel(lobby.slug, "g1", app.p1);
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.winnerPlayerId).toBeNull();
    expect(cancelled.winnerSeat).toBeNull();
    expect(cancelled.endedAt).toBeTruthy();
    expect(app.duels.cancel(lobby.slug, "g1", app.p1).status).toBe("cancelled");

    const seated = app.duels.join(lobby.slug, "g1", app.p1);
    expect(seated.status).toBe("cancelled");
    try {
      app.duels.takeSeat(lobby.slug, "g1", app.p2);
      throw new Error("expected claim after cancel to fail");
    } catch (error) {
      expect((error as DuelServiceError).status).toBe(409);
    }

    const active = readyDuel(app);
    start(app, active.slug);
    try {
      app.duels.cancel(active.slug, "g1", app.p1);
      throw new Error("expected active cancel to fail");
    } catch (error) {
      expect((error as DuelServiceError).status).toBe(409);
    }

    expect(cancelled.archivedAt).toBeTruthy();
    app.db.prepare("update duels set archived_at = null, ended_at = datetime('now', '-20 minutes') where web_slug = ?").run(lobby.slug);
    const due = app.duels.archiveDue(8, 10 * 60 * 1000);
    expect(due.map((row) => row.slug)).toEqual([lobby.slug]);
    expect(app.duels.get(lobby.slug, "g1").archivedAt).toBeTruthy();
    expect(app.duels.list("g1", app.p1).map((row) => row.slug)).toEqual([active.slug]);
    expect(app.duels.archiveDue(8, 10 * 60 * 1000)).toEqual([]);
  });
});

describe("creator settings persistence", () => {
  it("keeps unlimited clock and no banlist on pre-creator rows", () => {
    const app = setup();
    const created = app.duels.create({ guildId: "g1", organizerPlayerId: app.p1, name: "Legacy", mode: "normal" });
    expect(created.settings.turnSeconds).toBe(240);
    expect(created.settings.banlist).toBe("tcg-2026-09");
    app.db.prepare("update duels set settings_json = null, clock_json = null, invite_code = null where id = ?").run(created.id);

    const session = app.duels.get(created.slug, "g1");
    expect(session.settings.banlist).toBe("none");
    expect(session.settings.turnSeconds).toBe(0);
    expect(session.settings.startingLP).toBe(8000);
    expect(session.settings.startingHand).toBe(5);
    expect(session.settings.drawPerTurn).toBe(1);
    expect(session.settings.validateDeck).toBe(true);
    expect(session.settings.shuffleDeck).toBe(true);
    expect(app.duels.room(created.slug, "g1", app.p1).clock).toBeNull();
  });

  it("rejects unknown and out-of-range creator settings on create", () => {
    const app = setup();
    try {
      app.duels.create({
        guildId: "g1",
        organizerPlayerId: app.p1,
        name: "Bad seconds",
        mode: "normal",
        settings: { turnSeconds: 12 },
      });
      throw new Error("expected short turnSeconds to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(DuelServiceError);
      expect((error as DuelServiceError).status).toBe(400);
    }

    try {
      app.duels.create({
        guildId: "g1",
        organizerPlayerId: app.p1,
        name: "Unknown",
        mode: "normal",
        settings: { visibility: "public", extraLife: true },
      });
      throw new Error("expected unknown setting to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(DuelServiceError);
      expect((error as DuelServiceError).status).toBe(400);
    }

    expect(app.duels.list("g1", app.p1)).toEqual([]);
  });

  it("stores submitted settings through start, re-entry, and archive", () => {
    const app = setup();
    const session = app.duels.create({
      guildId: "g1",
      organizerPlayerId: app.p1,
      name: "Custom",
      mode: "domain",
      masterRule: 4,
      settings: { startingLP: 4000, validateDeck: false, shuffleDeck: false, cardPool: "ocg" },
    });
    expect(session.settings.startingLP).toBe(4000);
    expect(session.settings.validateDeck).toBe(false);
    expect(session.settings.banlist).toBe("none");
    expect(session.masterRule).toBe(4);

    app.duels.setDeck(session.slug, "g1", app.p1, { main: [7, 8, 9], extra: [], side: [] });
    expect(app.duels.room(session.slug, "g1", app.p1).myDeck?.main).toEqual([7, 8, 9]);

    app.duels.takeSeat(session.slug, "g1", app.p2);
    app.duels.setDeck(session.slug, "g1", app.p2, { main: [11], extra: [], side: [] });
    start(app, session.slug);
    expect(app.duels.join(session.slug, "g1", app.p1).settings.startingLP).toBe(4000);

    app.duels.complete(session.slug, "g1", 0, "life points");
    const archived = app.duels.archive(session.slug, "g1", app.p1);
    expect(archived.settings.shuffleDeck).toBe(false);
    expect(app.duels.get(session.slug, "g1").settings.cardPool).toBe("ocg");
  });
});

describe("private invite access", () => {
  it("hides private rooms from nonmembers until admit, including after archive", () => {
    const app = setup();
    const session = app.duels.create({
      guildId: "g1",
      organizerPlayerId: app.p1,
      name: "Secret",
      mode: "normal",
      settings: { visibility: "private" },
    });
    const organizerRoom = app.duels.room(session.slug, "g1", app.p1);
    expect(organizerRoom.inviteCode).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(JSON.stringify(session)).not.toContain(organizerRoom.inviteCode);
    expect(JSON.stringify(app.duels.list("g1", app.p3))).not.toContain(session.slug);
    expect(JSON.stringify(app.duels.list("g1", app.p1))).not.toContain("invite");

    try {
      app.duels.room(session.slug, "g1", app.p3);
      throw new Error("expected nonmember room to fail");
    } catch (error) {
      expect((error as DuelServiceError).status).toBe(403);
    }
    try {
      app.duels.takeSeat(session.slug, "g1", app.p3);
      throw new Error("expected nonmember join to fail");
    } catch (error) {
      expect((error as DuelServiceError).status).toBe(403);
    }

    try {
      app.duels.admit(session.slug, "g1", app.p3, "not-the-code");
      throw new Error("expected bad invite to fail");
    } catch (error) {
      expect((error as DuelServiceError).status).toBe(403);
    }
    expect(app.duels.list("g1", app.p3).map((row) => row.slug)).not.toContain(session.slug);

    app.duels.admit(session.slug, "g1", app.p3, organizerRoom.inviteCode!);
    expect(app.duels.list("g1", app.p3).map((row) => row.slug)).toContain(session.slug);
    const admitted = app.duels.room(session.slug, "g1", app.p3);
    expect(admitted.role).toBe("spectator");
    expect(admitted.inviteCode).toBeUndefined();

    const seated = app.duels.takeSeat(session.slug, "g1", app.p3);
    expect(seated.seats.some((seat) => seat.playerId === app.p3)).toBe(true);
    expect(app.duels.takeSeat(session.slug, "g1", app.p3).seats).toHaveLength(2);
    expect(app.duels.list("g1", app.p3).map((row) => row.slug)).toContain(session.slug);

    app.duels.setDeck(session.slug, "g1", app.p1, validDeck(1));
    app.duels.setDeck(session.slug, "g1", app.p3, validDeck(1000));
    start(app, session.slug);
    app.duels.complete(session.slug, "g1", 0, "life points");
    app.duels.archive(session.slug, "g1", app.p1);

    expect(app.duels.list("g1", app.p2, { archived: true }).map((row) => row.slug)).not.toContain(session.slug);
    expect(app.duels.list("g1", app.p3, { archived: true }).map((row) => row.slug)).toContain(session.slug);
    try {
      app.duels.room(session.slug, "g1", app.p2);
      throw new Error("expected archived private room to stay private");
    } catch (error) {
      expect((error as DuelServiceError).status).toBe(403);
    }
    expect(app.duels.room(session.slug, "g1", app.p3).session.settings.visibility).toBe("private");
  });
});

describe("duel clock storage", () => {
  it("persists clock atomically with activate and journal, then clears it on finish", () => {
    const app = setup();
    const session = readyDuel(app);
    const initial = { turn: 1, remainingMs: [240000, 240000] as [number, number], activeSeat: 0 as const, startedAt: 1_000 };
    app.duels.activate(session.slug, "g1", app.p1, ["s"], "v", initial);
    expect(app.duels.privateState(session.slug, "g1").clock).toEqual(initial);
    const roomClock = app.duels.room(session.slug, "g1", app.p1).clock;
    expect(roomClock?.remainingMs).toEqual([240000, 240000]);
    expect(roomClock?.startedAt).toBe(1_000);
    expect(typeof roomClock?.serverNow).toBe("number");

    const next = { turn: 1, remainingMs: [180000, 240000] as [number, number], activeSeat: 1 as const, startedAt: 2_000 };
    app.duels.recordCommand(session.slug, "g1", 0, command("first"), next);
    expect(app.duels.privateState(session.slug, "g1").clock).toEqual(next);
    expect(app.duels.privateState(session.slug, "g1").commands).toHaveLength(1);

    try {
      app.duels.recordCommand(session.slug, "g1", 1, command("bad"), { turn: 1, remainingMs: [1], activeSeat: 0, startedAt: 3 } as never);
      throw new Error("expected invalid clock to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(DuelServiceError);
    }
    expect(app.duels.privateState(session.slug, "g1").clock).toEqual(next);
    expect(app.duels.privateState(session.slug, "g1").commands).toHaveLength(1);

    expect(app.duels.dueClocks(1_000, 8)).toEqual([]);
    app.duels.setClock(session.slug, "g1", { turn: 1, remainingMs: [50, 50], activeSeat: 0, startedAt: 10 });
    expect(app.duels.dueClocks(60, 8)).toEqual([{ slug: session.slug, guildId: "g1" }]);
    app.duels.setClock(session.slug, "g1", { turn: 1, remainingMs: [50, 50], activeSeat: 0, startedAt: null });
    expect(app.duels.dueClocks(10_000, 8)).toEqual([]);

    app.duels.complete(session.slug, "g1", 0, "time");
    expect(app.duels.privateState(session.slug, "g1").clock).toBeNull();
    expect(app.duels.room(session.slug, "g1", app.p1).clock).toBeNull();
  });
});


describe("duel lobby listing, history and leave", () => {
  const finish = (app: ReturnType<typeof setup>, slug: string, how: "complete" | "interrupt" = "complete") => {
    if (how === "complete") app.duels.complete(slug, "g1", 0, "life points");
    else app.duels.interrupt(slug, "g1", "Engine restarted");
  };

  it("auto-archives on complete, interrupt and cancel", () => {
    const app = setup();
    const a = readyDuel(app);
    start(app, a.slug);
    finish(app, a.slug);
    const b = readyDuel(app);
    start(app, b.slug, ["s2"]);
    finish(app, b.slug, "interrupt");
    const c = app.duels.create({ guildId: "g1", organizerPlayerId: app.p1, name: "C", mode: "normal" });
    app.duels.cancel(c.slug, "g1", app.p1);
    for (const slug of [a.slug, b.slug, c.slug]) {
      expect(app.duels.get(slug, "g1").archivedAt).toBeTruthy();
    }
    expect(app.duels.list("g1", app.p1)).toEqual([]);
    const history = app.duels.list("g1", app.p1, { archived: true });
    expect(history.map((row) => row.slug).sort()).toEqual([a.slug, b.slug].sort());
    expect(history.every((row) => row.mySeat === 0)).toBe(true);
  });

  it("stamps last activity on start and on every recorded command", () => {
    const app = setup();
    const d = readyDuel(app);
    expect(app.duels.list("g1", app.p1)[0]?.lastActivityAt).toBeTruthy();
    start(app, d.slug);
    const stamp = () =>
      app.db.prepare<[string], { t: string | null }>("select last_activity_at as t from duels where web_slug = ?").get(d.slug)?.t;
    expect(stamp()).toBeTruthy();
    app.db.prepare("update duels set last_activity_at = '2000-01-01 00:00:00' where web_slug = ?").run(d.slug);
    app.duels.recordCommand(d.slug, "g1", 0, command("x"), null);
    expect(stamp()).not.toBe("2000-01-01 00:00:00");
  });

  it("shows recently active foreign lobbies and hides idle ones", () => {
    const app = setup();
    const lobby = app.duels.create({ guildId: "g1", organizerPlayerId: app.p1, name: "Lobby", mode: "normal" });
    app.db.prepare("update duels set last_activity_at = datetime('now', '-14 minutes') where web_slug = ?").run(lobby.slug);
    expect(app.duels.list("g1", app.p3).map((row) => row.slug)).toEqual([lobby.slug]);

    app.db.prepare("update duels set last_activity_at = datetime('now', '-16 minutes') where web_slug = ?").run(lobby.slug);
    expect(app.duels.list("g1", app.p3)).toEqual([]);
  });

  it("uses creation time for foreign lobbies with no activity stamp", () => {
    const app = setup();
    const lobby = app.duels.create({ guildId: "g1", organizerPlayerId: app.p1, name: "Lobby", mode: "normal" });
    app.db.prepare("update duels set last_activity_at = null, created_at = datetime('now', '-14 minutes') where web_slug = ?").run(lobby.slug);
    expect(app.duels.list("g1", app.p3).map((row) => row.slug)).toEqual([lobby.slug]);

    app.db.prepare("update duels set created_at = datetime('now', '-16 minutes') where web_slug = ?").run(lobby.slug);
    expect(app.duels.list("g1", app.p3)).toEqual([]);
  });

  it("keeps idle lobbies visible to their owner and seated players", () => {
    const app = setup();
    const lobby = app.duels.create({ guildId: "g1", organizerPlayerId: app.p1, name: "Lobby", mode: "normal" });
    app.duels.takeSeat(lobby.slug, "g1", app.p2, 1);
    app.db.prepare("update duels set last_activity_at = '2000-01-01 00:00:00' where web_slug = ?").run(lobby.slug);
    expect(app.duels.list("g1", app.p1).map((row) => row.slug)).toEqual([lobby.slug]);
    expect(app.duels.list("g1", app.p2).map((row) => row.slug)).toEqual([lobby.slug]);
    expect(app.duels.list("g1", app.p3)).toEqual([]);
  });

  it.each(["take", "leave"] as const)("refreshes lobby activity when a guest performs a seat %s", (action) => {
    const app = setup();
    const lobby = app.duels.create({ guildId: "g1", organizerPlayerId: app.p1, name: "Lobby", mode: "normal" });
    if (action === "leave") app.duels.takeSeat(lobby.slug, "g1", app.p2, 1);
    app.db.prepare("update duels set last_activity_at = '2000-01-01 00:00:00' where web_slug = ?").run(lobby.slug);

    if (action === "take") app.duels.takeSeat(lobby.slug, "g1", app.p2, 1);
    else app.duels.leave(lobby.slug, "g1", app.p2);

    const refreshed = app.duels.list("g1", app.p3).find((row) => row.slug === lobby.slug);
    expect(refreshed).toBeDefined();
    expect(refreshed?.lastActivityAt).not.toBe("2000-01-01 00:00:00");
  });

  it("shows accessible lobbies and hides idle duels but keeps own tables", () => {
    const app = setup();
    const lobby = app.duels.create({ guildId: "g1", organizerPlayerId: app.p1, name: "Lobby", mode: "normal" });
    const active = readyDuel(app);
    start(app, active.slug);

    expect(app.duels.list("g1", app.p3).map((row) => row.slug).sort()).toEqual([active.slug, lobby.slug].sort());
    expect(app.duels.list("g1", app.p1).map((row) => row.slug).sort()).toEqual([active.slug, lobby.slug].sort());
    expect(app.duels.list("g1", app.p3).find((row) => row.slug === active.slug)?.mySeat).toBeNull();
    expect(app.duels.list("g1", app.p2)[0]?.mySeat).toBe(1);

    app.db
      .prepare("update duels set last_activity_at = datetime('now', '-16 minutes') where web_slug = ?")
      .run(active.slug);
    expect(app.duels.list("g1", app.p3).map((row) => row.slug)).toEqual([lobby.slug]);
    expect(app.duels.list("g1", app.p1).map((row) => row.slug)).toContain(active.slug);
    expect(app.duels.list("g1", app.p2).map((row) => row.slug)).toEqual([active.slug, lobby.slug]);
    expect(app.duels.list("g1", app.p3, { idleAfterMs: 20 * 60 * 1000 }).map((row) => row.slug).sort()).toEqual([active.slug, lobby.slug].sort());
    expect(DUEL_LIVE_IDLE_AFTER_MS).toBe(15 * 60 * 1000);
  });

  it("orders own tables first then by recent activity", () => {
    const app = setup();
    const other = readyDuel(app);
    start(app, other.slug);
    const mine = app.duels.create({ guildId: "g1", organizerPlayerId: app.p3, name: "Mine", mode: "normal" });
    app.db.prepare("update duels set created_at = datetime('now', '-1 hours') where web_slug = ?").run(mine.slug);
    expect(app.duels.list("g1", app.p3).map((row) => row.slug)).toEqual([mine.slug, other.slug]);
  });

  it("scopes history to mine or all and excludes cancelled", () => {
    const app = setup();
    const played = readyDuel(app);
    start(app, played.slug);
    finish(app, played.slug);
    const cancelled = app.duels.create({ guildId: "g1", organizerPlayerId: app.p1, name: "Nope", mode: "normal" });
    app.duels.cancel(cancelled.slug, "g1", app.p1);

    expect(app.duels.list("g1", app.p3, { archived: true })).toEqual([]);
    expect(app.duels.list("g1", app.p3, { archived: true, scope: "all" }).map((row) => row.slug)).toEqual([played.slug]);
    expect(app.duels.list("g1", app.p1, { archived: true, scope: "mine" }).map((row) => row.slug)).toEqual([played.slug]);
    expect(app.duels.list("g1", app.p1, { archived: true, scope: "all" }).map((row) => row.slug)).not.toContain(cancelled.slug);
  });

  it("keeps private duels out of the all-scope history for outsiders", () => {
    const app = setup();
    const secret = app.duels.create({
      guildId: "g1",
      organizerPlayerId: app.p1,
      name: "Secret",
      mode: "normal",
      settings: { visibility: "private" },
    });
    app.duels.admit(secret.slug, "g1", app.p2, app.duels.room(secret.slug, "g1", app.p1).inviteCode!);
    app.duels.takeSeat(secret.slug, "g1", app.p2);
    app.duels.setDeck(secret.slug, "g1", app.p1, validDeck(1));
    app.duels.setDeck(secret.slug, "g1", app.p2, validDeck(1000));
    start(app, secret.slug);
    finish(app, secret.slug);
    expect(app.duels.list("g1", app.p3, { archived: true, scope: "all" })).toEqual([]);
    expect(app.duels.list("g1", app.p2, { archived: true, scope: "all" }).map((row) => row.slug)).toEqual([secret.slug]);
  });

  it("lets a guest leave a lobby but enforces leave rules", () => {
    const app = setup();
    const lobby = app.duels.create({ guildId: "g1", organizerPlayerId: app.p1, name: "L", mode: "normal" });
    app.duels.takeSeat(lobby.slug, "g1", app.p2);
    const status = (fn: () => unknown) => {
      try {
        fn();
      } catch (error) {
        return (error as DuelServiceError).status;
      }
      return 0;
    };
    expect(status(() => app.duels.leave(lobby.slug, "g1", app.p3))).toBe(403);
    expect(status(() => app.duels.leave(lobby.slug, "g1", app.p1))).toBe(409);
    const after = app.duels.leave(lobby.slug, "g1", app.p2);
    expect(after.seats.map((seat) => seat.playerId)).toEqual([app.p1]);
    expect(status(() => app.duels.leave(lobby.slug, "g1", app.p2))).toBe(403);

    const active = readyDuel(app);
    start(app, active.slug);
    expect(status(() => app.duels.leave(active.slug, "g1", app.p2))).toBe(409);
  });
});

describe("rock-paper-scissors opening", () => {
  function lobby() {
    const { db, duels, p1, p2 } = setup();
    const room = duels.create({ guildId: "g1", organizerPlayerId: p1, name: "T", mode: "normal" });
    duels.takeSeat(room.slug, "g1", p2);
    duels.setDeck(room.slug, "g1", p1, validDeck(1));
    duels.setDeck(room.slug, "g1", p2, validDeck(500));
    return { db, duels, p1, p2, slug: room.slug };
  }

  it("starts only for the organizer with two ready seats", () => {
    const { duels, p1, p2, slug } = lobby();
    expect(() => duels.startOpening(slug, "g1", p2, 1000)).toThrow(/Only the organizer/);
    const state = duels.startOpening(slug, "g1", p1, 1000);
    expect(state.phase).toBe("rps");
    expect(duels.startOpening(slug, "g1", p1, 2000)).toEqual(state);
  });

  it("refuses to start with an empty seat", () => {
    const { db, duels, p1 } = setup();
    const room = duels.create({ guildId: "g1", organizerPlayerId: p1, name: "T", mode: "normal" });
    duels.setDeck(room.slug, "g1", p1, validDeck(1));
    expect(() => duels.startOpening(room.slug, "g1", p1, 1000)).toThrow(DuelServiceError);
    db.close();
  });

  it("freezes seats and decks while the opening runs", () => {
    const { duels, p1, p2, slug } = lobby();
    duels.startOpening(slug, "g1", p1, 1000);
    expect(() => duels.setDeck(slug, "g1", p2, validDeck(900))).toThrow(/fixed/);
    expect(() => duels.markReady(slug, "g1", p2)).toThrow(/fixed/);
    expect(() => duels.leave(slug, "g1", p2)).toThrow(/fixed/);
  });

  it("never shows a pick to the other player in the room", () => {
    const { duels, p1, p2, slug } = lobby();
    duels.startOpening(slug, "g1", p1, 1000);
    duels.submitOpeningPick(slug, "g1", 0, "rock", 1100);
    expect(duels.room(slug, "g1", p1).opening?.myPick).toBe("rock");
    const other = duels.room(slug, "g1", p2).opening;
    expect(other?.myPick).toBeNull();
    expect(other?.picked).toEqual([true, false]);
    expect(JSON.stringify(other)).not.toContain("rock");
  });

  it("swaps the seats when the winner chooses to go second", () => {
    const { duels, p1, p2, slug } = lobby();
    duels.startOpening(slug, "g1", p1, 1000);
    duels.submitOpeningPick(slug, "g1", 0, "rock", 1100);
    duels.submitOpeningPick(slug, "g1", 1, "scissors", 1200);
    const state = duels.submitOpeningChoice(slug, "g1", 0, "second", 1300);
    expect(state.phase).toBe("start");
    const seats = duels.get(slug, "g1").seats;
    expect(seats.find((seat) => seat.seat === 0)?.playerId).toBe(p2);
    expect(seats.find((seat) => seat.seat === 1)?.playerId).toBe(p1);
    // The decks follow the players: seat 0 is now the second player's deck.
    expect(duels.privateState(slug, "g1").decks[0]?.main[0]).toBe(500);
    // The room shows the result in the new seat numbers.
    const view = duels.room(slug, "g1", p1).opening;
    expect(view?.winnerSeat).toBe(1);
    expect(view?.reveal?.picks).toEqual(["scissors", "rock"]);
  });

  it("keeps the seats when the winner chooses to go first", () => {
    const { duels, p1, slug } = lobby();
    duels.startOpening(slug, "g1", p1, 1000);
    duels.submitOpeningPick(slug, "g1", 0, "scissors", 1100);
    duels.submitOpeningPick(slug, "g1", 1, "rock", 1200);
    duels.submitOpeningChoice(slug, "g1", 1, "first", 1300);
    const seats = duels.get(slug, "g1").seats;
    expect(seats.find((seat) => seat.seat === 0)?.playerId).not.toBe(p1);
  });

  it("settles timeouts and lists due openings", () => {
    const { duels, p1, slug } = lobby();
    duels.startOpening(slug, "g1", p1, 0);
    expect(duels.dueOpenings(29_999, 10)).toEqual([]);
    expect(duels.dueOpenings(30_000, 10)).toEqual([{ slug, guildId: "g1" }]);
    const randoms = [0, 0.5];
    const settled = duels.settleOpening(slug, "g1", 30_000, () => randoms.shift() ?? 0);
    expect(settled?.phase).toBe("choose");
    const chosen = duels.settleOpening(slug, "g1", settled!.deadline);
    expect(chosen?.phase).toBe("start");
    expect(chosen?.choice).toBe("first");
  });

  it("drops a settled opening so the lobby can change again", () => {
    const { duels, p1, p2, slug } = lobby();
    duels.startOpening(slug, "g1", p1, 0);
    expect(() => duels.leave(slug, "g1", p2)).toThrow(/Seats and decks are fixed/);
    duels.abortOpening(slug, "g1");
    expect(duels.openingState(slug, "g1")).toBeNull();
    expect(duels.room(slug, "g1", p1).opening).toBeNull();
    expect(() => duels.leave(slug, "g1", p2)).not.toThrow();
    // Nothing to drop: no error.
    duels.abortOpening(slug, "g1");
  });

  it("clears the opening when the duel activates", () => {
    const { duels, p1, slug } = lobby();
    duels.startOpening(slug, "g1", p1, 0);
    duels.submitOpeningPick(slug, "g1", 0, "rock", 1);
    duels.submitOpeningPick(slug, "g1", 1, "paper", 2);
    duels.submitOpeningChoice(slug, "g1", 1, "first", 3);
    duels.activate(slug, "g1", p1, ["1", "2", "3", "4"], "bundle", null);
    expect(duels.openingState(slug, "g1")).toBeNull();
    expect(duels.room(slug, "g1", p1).opening).toBeNull();
  });
});
