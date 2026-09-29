import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { migrate } from "../../src/db/index.js";
import type { DuelCommand, DuelDeck, DuelEngineView } from "../../src/duels/index.js";
import { createDuelService, DuelServiceError } from "../../src/services/duels.js";

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
  app.duels.join(session.slug, "g1", app.p2);
  app.duels.setDeck(session.slug, "g1", app.p1, validDeck(1));
  app.duels.setDeck(session.slug, "g1", app.p2, validDeck(1000, 12345678));
  return session;
}

describe("duel persistence invariants", () => {
  it("claims distinct relational seats and refuses a third occupant", () => {
    const app = setup();
    const created = app.duels.create({ guildId: "g1", organizerPlayerId: app.p1, name: "Seat claim", mode: "normal" });
    expect(created.seats[0]?.playerId).toBe(app.p1);
    expect(created.seats[0]?.isBot).toBe(false);
    expect(created.masterRule).toBe(5);

    const joined = app.duels.join(created.slug, "g1", app.p2);
    expect(joined.seats.map((seat) => [seat.seat, seat.playerId])).toEqual([
      [0, app.p1],
      [1, app.p2],
    ]);
    expect(app.duels.join(created.slug, "g1", app.p2).seats).toHaveLength(2);

    try {
      app.duels.join(created.slug, "g1", app.p3);
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

    try {
      app.duels.create({ guildId: "g1", organizerPlayerId: app.p1, name: "Domain MR1", mode: "domain", masterRule: 1 });
      throw new Error("expected domain non-5 to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(DuelServiceError);
      expect((error as DuelServiceError).status).toBe(400);
    }
  });

  it("lets only the seated owner set a shaped deck before start and marks ready", () => {
    const app = setup();
    const session = app.duels.create({ guildId: "g1", organizerPlayerId: app.p1, name: "Decks", mode: "domain" });
    app.duels.join(session.slug, "g1", app.p2);

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
      app.duels.activate(session.slug, "g1", app.p1, ["seed-a"], "bundle-1");
      throw new Error("expected activate without two ready seats to fail");
    } catch (error) {
      expect((error as DuelServiceError).message).toMatch(/two ready players/);
    }

    app.duels.join(session.slug, "g1", app.p2);
    app.duels.setDeck(session.slug, "g1", app.p1, validDeck(1));

    try {
      app.duels.activate(session.slug, "g1", app.p1, ["seed-a"], "bundle-1");
      throw new Error("expected activate with one ready seat to fail");
    } catch (error) {
      expect((error as DuelServiceError).status).toBe(400);
    }

    app.duels.setDeck(session.slug, "g1", app.p2, validDeck(500));

    try {
      app.duels.activate(session.slug, "g1", app.p2, ["seed-a"], "bundle-1");
      throw new Error("expected non-organizer activate to fail");
    } catch (error) {
      expect((error as DuelServiceError).status).toBe(403);
    }

    const active = app.duels.activate(session.slug, "g1", app.p1, ["seed-a", "seed-b"], "bundle-1");
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
    app.duels.activate(session.slug, "g1", app.p1, ["s"], "v");

    try {
      app.duels.get(session.slug, "g2");
      throw new Error("expected cross-guild get to fail");
    } catch (error) {
      expect((error as DuelServiceError).status).toBe(404);
    }

    try {
      app.duels.join(session.slug, "g1", app.outsider);
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
      app.duels.join(session.slug, "g1", app.p3);
      throw new Error("expected unseated active join to fail");
    } catch (error) {
      expect((error as DuelServiceError).status).toBe(400);
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
    app.duels.activate(session.slug, "g1", app.p1, ["alpha"], "bundle-9");
    app.duels.recordCommand(session.slug, "g1", 0, command("first"));
    app.duels.recordCommand(session.slug, "g1", 1, command("second"));
    app.duels.recordCommand(session.slug, "g1", 0, command("third"));

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
    app.duels.activate(session.slug, "g1", app.p1, ["s"], "v");

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
    app.duels.activate(other.slug, "g1", app.p1, ["s2"], "v");
    const interrupted = app.duels.interrupt(other.slug, "g1", "engine crash");
    expect(interrupted.status).toBe("interrupted");
    expect(interrupted.winnerPlayerId).toBeNull();
    expect(interrupted.winnerSeat).toBeNull();
    const interruptAgain = app.duels.interrupt(other.slug, "g1", "later");
    expect(interruptAgain.resultReason).toBe("engine crash");
    const completeAfterInterrupt = app.duels.complete(other.slug, "g1", 0, "too late");
    expect(completeAfterInterrupt.status).toBe("interrupted");

    const drawDuel = readyDuel(app);
    app.duels.activate(drawDuel.slug, "g1", app.p1, ["s3"], "v");
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
      app.duels.join(session.slug, "g1", app.p2);
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

    app.duels.join(session.slug, "g1", app.p2);
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
    app.duels.activate(started.slug, "g1", app.p1, ["s"], "v");
    try {
      app.duels.addPracticeBot(started.slug, "g1", app.p1, validDeck(7000));
      throw new Error("expected active add to fail");
    } catch (error) {
      expect((error as DuelServiceError).status).toBe(400);
    }
  });

  it("starts a human-vs-bot lobby and records a bot win as winnerSeat without a player id", () => {
    const app = setup();
    const session = app.duels.create({ guildId: "g1", organizerPlayerId: app.p1, name: "Solo", mode: "domain" });
    app.duels.addPracticeBot(session.slug, "g1", app.p1, validDeck(9000, 48305365));
    app.duels.setDeck(session.slug, "g1", app.p1, validDeck(1, 99));
    const active = app.duels.activate(session.slug, "g1", app.p1, ["seed"], "bundle");
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
    app.duels.activate(drawDuel.slug, "g1", app.p1, ["s"], "v");
    const draw = app.duels.complete(drawDuel.slug, "g1", null, "draw");
    expect(draw.winnerSeat).toBeNull();
    expect(draw.winnerPlayerId).toBeNull();
  });
});

describe("duel snapshots archive and cancel", () => {
  it("saves role-redacted boards atomically and keeps opponent cards private", () => {
    const app = setup();
    const session = readyDuel(app);
    app.duels.activate(session.slug, "g1", app.p1, ["s"], "v");
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
    app.duels.activate(finished.slug, "g1", app.p1, ["s"], "v");
    app.duels.complete(finished.slug, "g1", 0, "life points", {
      public: board(null),
      seat0: board(0),
      seat1: board(1),
    });

    const live = app.duels.list("g1", app.p1);
    expect(live.map((row) => row.slug).sort()).toEqual([finished.slug, liveLobby.slug].sort());
    expect(app.duels.list("g1", app.p1, { archived: true })).toEqual([]);

    try {
      app.duels.archive(liveLobby.slug, "g1", app.p1);
      throw new Error("expected lobby archive to fail");
    } catch (error) {
      expect((error as DuelServiceError).status).toBe(409);
    }

    const active = readyDuel(app);
    app.duels.activate(active.slug, "g1", app.p1, ["s2"], "v");
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
      app.duels.join(lobby.slug, "g1", app.p2);
      throw new Error("expected join after cancel to fail");
    } catch (error) {
      expect((error as DuelServiceError).status).toBe(400);
    }

    const active = readyDuel(app);
    app.duels.activate(active.slug, "g1", app.p1, ["s"], "v");
    try {
      app.duels.cancel(active.slug, "g1", app.p1);
      throw new Error("expected active cancel to fail");
    } catch (error) {
      expect((error as DuelServiceError).status).toBe(409);
    }

    app.db.prepare("update duels set ended_at = datetime('now', '-20 minutes') where web_slug = ?").run(lobby.slug);
    const due = app.duels.archiveDue(8, 10 * 60 * 1000);
    expect(due.map((row) => row.slug)).toEqual([lobby.slug]);
    expect(app.duels.get(lobby.slug, "g1").archivedAt).toBeTruthy();
    expect(app.duels.list("g1", app.p1).map((row) => row.slug)).toEqual([active.slug]);
    expect(app.duels.archiveDue(8, 10 * 60 * 1000)).toEqual([]);
  });
});
