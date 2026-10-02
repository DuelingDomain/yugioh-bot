import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { migrate } from "../../src/db/index.js";
import type { DuelDeck, DuelEngineView } from "../../src/duels/index.js";
import { createDuelService } from "../../src/services/duels.js";

function player(db: Database.Database, n: number) {
  return Number(
    db.prepare("insert into players (guild_id, discord_user_id, display_name) values ('g1', ?, ?)").run(`u${n}`, `P${n}`).lastInsertRowid,
  );
}

function deck(start: number): DuelDeck {
  return { main: Array.from({ length: 40 }, (_, i) => start + i), extra: [], side: [] };
}

function setup(count = 5) {
  const db = new Database(":memory:");
  migrate(db);
  const ids = Array.from({ length: count }, (_, i) => player(db, i + 1));
  return { db, duels: createDuelService(db), ids };
}

function view(seatCount: number, tag: number): DuelEngineView {
  return {
    revision: tag,
    turn: 1,
    turnSeat: 0,
    phase: "end",
    seats: Array.from({ length: seatCount }, (_, seat) => ({
      seat,
      lp: 8000,
      hand: [],
      deckCount: 30,
      extraCount: 0,
      extra: [],
      monsters: [],
      spells: [],
      graveyard: [],
      banished: [],
    })),
    prompt: { id: "x", seat: 0, kind: "choice", title: "Go", options: [] },
    chain: [],
    events: [],
    log: [],
    result: null,
  };
}

describe("duel format rooms", () => {
  it("defaults to 1v1 and keeps two seats", () => {
    const { duels, ids } = setup();
    const session = duels.create({ guildId: "g1", organizerPlayerId: ids[0]!, name: "A", mode: "normal" });
    expect(session.format).toBe("1v1");
    duels.takeSeat(session.slug, "g1", ids[1]!);
    expect(() => duels.takeSeat(session.slug, "g1", ids[2]!)).toThrow(/already taken/);
    expect(duels.room(session.slug, "g1", ids[0]!).session.format).toBe("1v1");
  });

  it("rejects an unknown format", () => {
    const { duels, ids } = setup();
    expect(() =>
      duels.create({ guildId: "g1", organizerPlayerId: ids[0]!, name: "A", mode: "normal", format: "5v5" as never }),
    ).toThrow(/format/);
  });

  it("allows only Master Rule 5 at tag and free-for-all tables", () => {
    const { duels, ids } = setup();
    for (const format of ["tag", "ffa3", "ffa4"] as const) {
      expect(() =>
        duels.create({ guildId: "g1", organizerPlayerId: ids[0]!, name: "A", mode: "normal", format, masterRule: 4 }),
      ).toThrow(/Master Rule 5/);
      expect(duels.create({ guildId: "g1", organizerPlayerId: ids[0]!, name: "A", mode: "normal", format, masterRule: 5 }).masterRule).toBe(5);
    }
    expect(duels.create({ guildId: "g1", organizerPlayerId: ids[0]!, name: "A", mode: "normal", format: "1v1", masterRule: 3 }).masterRule).toBe(3);
  });

  it("fills three seats in ffa3 and starts only when all are ready", () => {
    const { duels, ids } = setup();
    const s = duels.create({ guildId: "g1", organizerPlayerId: ids[0]!, name: "A", mode: "normal", format: "ffa3" });
    duels.takeSeat(s.slug, "g1", ids[1]!);
    expect(() => duels.activate(s.slug, "g1", ids[0]!, ["1"], "b", null)).toThrow(/3 ready players/);
    duels.takeSeat(s.slug, "g1", ids[2]!);
    expect(() => duels.takeSeat(s.slug, "g1", ids[3]!)).toThrow(/already taken/);
    for (let i = 0; i < 3; i += 1) duels.setDeck(s.slug, "g1", ids[i]!, deck(i * 100 + 1));
    const active = duels.activate(s.slug, "g1", ids[0]!, ["1"], "b", {
      turn: 1,
      remainingMs: [1, 2, 3],
      activeSeat: 2,
      startedAt: 5,
    });
    expect(active.status).toBe("active");
    expect(active.seats.map((x) => x.seat)).toEqual([0, 1, 2]);
    expect(duels.privateState(s.slug, "g1").decks).toHaveLength(3);
  });

  it("fills four seats in tag with several bots", () => {
    const { duels, ids } = setup();
    const s = duels.create({ guildId: "g1", organizerPlayerId: ids[0]!, name: "A", mode: "normal", format: "tag" });
    duels.setDeck(s.slug, "g1", ids[0]!, deck(1));
    duels.addPracticeBot(s.slug, "g1", ids[0]!, deck(200));
    duels.addPracticeBot(s.slug, "g1", ids[0]!, deck(300));
    const joined = duels.takeSeat(s.slug, "g1", ids[1]!);
    expect(joined.seats.filter((x) => x.isBot)).toHaveLength(2);
    expect(() => duels.addPracticeBot(s.slug, "g1", ids[0]!, deck(400))).toThrow(/empty opponent seat/);
    expect(() => duels.takeSeat(s.slug, "g1", ids[2]!)).toThrow(/already taken/);
    duels.setDeck(s.slug, "g1", ids[1]!, deck(500));
    expect(duels.activate(s.slug, "g1", ids[0]!, ["1"], "b", null).status).toBe("active");
  });

  it("puts a practice bot in the chosen seat", () => {
    const { duels, ids } = setup();
    const s = duels.create({ guildId: "g1", organizerPlayerId: ids[0]!, name: "A", mode: "normal", format: "tag" });
    const withBot = duels.addPracticeBot(s.slug, "g1", ids[0]!, deck(200), 2);
    expect(withBot.seats.map((x) => [x.seat, x.isBot])).toEqual([[0, false], [2, true]]);
    expect(() => duels.addPracticeBot(s.slug, "g1", ids[0]!, deck(300), 2)).toThrow(/taken/);
    expect(() => duels.addPracticeBot(s.slug, "g1", ids[0]!, deck(300), 4)).toThrow(/between 0 and 3/);
    expect(() => duels.addPracticeBot(s.slug, "g1", ids[0]!, deck(300), -1)).toThrow(/between 0 and 3/);
    // Without a seat the lowest empty seat is used.
    const next = duels.addPracticeBot(s.slug, "g1", ids[0]!, deck(300));
    expect(next.seats.map((x) => x.seat)).toEqual([0, 1, 2]);
  });

  it("names the winning team and credits the first human of a Tag team", () => {
    const { duels, ids } = setup();
    const s = duels.create({ guildId: "g1", organizerPlayerId: ids[0]!, name: "A", mode: "normal", format: "tag" });
    duels.addPracticeBot(s.slug, "g1", ids[0]!, deck(200), 1);
    duels.addPracticeBot(s.slug, "g1", ids[0]!, deck(300), 2);
    duels.takeSeat(s.slug, "g1", ids[1]!);
    duels.setDeck(s.slug, "g1", ids[0]!, deck(1));
    duels.setDeck(s.slug, "g1", ids[1]!, deck(500));
    duels.activate(s.slug, "g1", ids[0]!, ["1"], "b", null);
    const done = duels.complete(s.slug, "g1", 1, "Surrender", { public: view(4, 1), seats: [0, 1, 2, 3].map((n) => view(4, n)) });
    expect(done.winnerSeat).toBe(1);
    expect(done.winnerPlayerId).toBe(ids[1]);
    const room = duels.room(s.slug, "g1", ids[0]!);
    expect(room.engine?.result).toMatchObject({ winnerSeat: 1, winnerTeam: 1 });
  });

  it("checks clocks against the seat count", () => {
    const { duels, ids } = setup();
    const s = duels.create({ guildId: "g1", organizerPlayerId: ids[0]!, name: "A", mode: "normal" });
    duels.takeSeat(s.slug, "g1", ids[1]!);
    duels.setDeck(s.slug, "g1", ids[0]!, deck(1));
    duels.setDeck(s.slug, "g1", ids[1]!, deck(101));
    expect(() =>
      duels.activate(s.slug, "g1", ids[0]!, ["1"], "b", { turn: 1, remainingMs: [1, 2, 3], activeSeat: 0, startedAt: 1 }),
    ).toThrow(/2 seats/);
  });

  it("finds due clocks for seats beyond 1", () => {
    const { duels, ids } = setup();
    const s = duels.create({ guildId: "g1", organizerPlayerId: ids[0]!, name: "A", mode: "normal", format: "ffa3" });
    duels.takeSeat(s.slug, "g1", ids[1]!);
    duels.takeSeat(s.slug, "g1", ids[2]!);
    for (let i = 0; i < 3; i += 1) duels.setDeck(s.slug, "g1", ids[i]!, deck(i * 100 + 1));
    duels.activate(s.slug, "g1", ids[0]!, ["1"], "b", { turn: 1, remainingMs: [900, 900, 50], activeSeat: 2, startedAt: 100 });
    expect(duels.dueClocks(149, 10)).toEqual([]);
    expect(duels.dueClocks(150, 10)).toEqual([{ slug: s.slug, guildId: "g1" }]);
    expect(duels.room(s.slug, "g1", ids[0]!).clock?.remainingMs).toEqual([900, 900, 50]);
  });

  it("round trips the setup field", () => {
    const { duels, ids } = setup();
    const s = duels.create({ guildId: "g1", organizerPlayerId: ids[0]!, name: "A", mode: "normal" });
    expect(duels.privateState(s.slug, "g1").setup).toBeUndefined();
    duels.takeSeat(s.slug, "g1", ids[1]!);
    duels.setDeck(s.slug, "g1", ids[0]!, deck(1));
    duels.setDeck(s.slug, "g1", ids[1]!, deck(101));
    const setupValue = { startupScripts: ["Debug.ReloadFieldEnd()"], scenarioId: "raigeki" };
    duels.activate(s.slug, "g1", ids[0]!, ["1"], "b", null, setupValue);
    expect(duels.privateState(s.slug, "g1").setup).toEqual(setupValue);
    duels.setSetup(s.slug, "g1", { scenarioId: "other" });
    expect(duels.privateState(s.slug, "g1").setup).toEqual({ scenarioId: "other" });
    expect(() => duels.setSetup(s.slug, "g1", { nope: 1 } as never)).toThrow(/Unknown duel setup/);
    duels.setSetup(s.slug, "g1", null);
    expect(duels.privateState(s.slug, "g1").setup).toBeUndefined();
  });

  it("keeps the engine a duel started on, and refuses an unknown engine", () => {
    const { duels, ids } = setup();
    const s = duels.create({ guildId: "g1", organizerPlayerId: ids[0]!, name: "A", mode: "normal" });
    duels.takeSeat(s.slug, "g1", ids[1]!);
    duels.setDeck(s.slug, "g1", ids[0]!, deck(1));
    duels.setDeck(s.slug, "g1", ids[1]!, deck(101));
    duels.activate(s.slug, "g1", ids[0]!, ["1"], "b", null, { engine: "pinned" });
    expect(duels.privateState(s.slug, "g1").setup).toEqual({ engine: "pinned" });
    duels.setSetup(s.slug, "g1", { engine: "legacy", surrenderedSeats: [1] });
    expect(duels.privateState(s.slug, "g1").setup).toEqual({ engine: "legacy", surrenderedSeats: [1] });
    expect(() => duels.setSetup(s.slug, "g1", { engine: "multi" } as never)).toThrow(/engine must be/);
  });
});

describe("final snapshots per seat", () => {
  function finishedFfa() {
    const { duels, ids } = setup();
    const s = duels.create({ guildId: "g1", organizerPlayerId: ids[0]!, name: "A", mode: "normal", format: "ffa3" });
    duels.takeSeat(s.slug, "g1", ids[1]!);
    duels.takeSeat(s.slug, "g1", ids[2]!);
    for (let i = 0; i < 3; i += 1) duels.setDeck(s.slug, "g1", ids[i]!, deck(i * 100 + 1));
    duels.activate(s.slug, "g1", ids[0]!, ["1"], "b", null);
    duels.complete(s.slug, "g1", 2, "last left", {
      public: view(3, 10),
      seats: [view(3, 20), view(3, 21), view(3, 22)],
    });
    return { duels, ids, slug: s.slug };
  }

  it("returns each seat its own final board and strips prompts", () => {
    const { duels, ids, slug } = finishedFfa();
    for (let i = 0; i < 3; i += 1) {
      const room = duels.room(slug, "g1", ids[i]!);
      expect(room.engine?.revision).toBe(20 + i);
      expect(room.engine?.prompt).toBeNull();
      expect(room.engine?.result).toEqual({ winnerSeat: 2, reason: "last left" });
    }
    expect(duels.room(slug, "g1", ids[3]!).engine?.revision).toBe(10);
  });

  it("still accepts the old two-seat snapshot shape", () => {
    const { duels, ids } = setup();
    const s = duels.create({ guildId: "g1", organizerPlayerId: ids[0]!, name: "A", mode: "normal" });
    duels.takeSeat(s.slug, "g1", ids[1]!);
    duels.setDeck(s.slug, "g1", ids[0]!, deck(1));
    duels.setDeck(s.slug, "g1", ids[1]!, deck(101));
    duels.activate(s.slug, "g1", ids[0]!, ["1"], "b", null);
    duels.complete(s.slug, "g1", 0, "done", { public: view(2, 1), seat0: view(2, 2), seat1: view(2, 3) });
    expect(duels.room(s.slug, "g1", ids[1]!).engine?.revision).toBe(3);
  });
});

describe("migration of old rows", () => {
  it("reads a duel saved before format, setup and seat snapshots existed", () => {
    const { db, duels, ids } = setup();
    db.exec("alter table duels drop column format");
    db.exec("alter table duels drop column snapshot_seats_json");
    db.exec("alter table duels drop column setup_json");
    const duelId = Number(
      db
        .prepare(
          `insert into duels (guild_id, web_slug, name, organizer_player_id, mode, status, clock_json, snapshot_seat1_json)
           values ('g1', 'old1', 'Old', ?, 'normal', 'active', ?, null)`,
        )
        .run(ids[0], JSON.stringify({ turn: 2, remainingMs: [100, 200], activeSeat: 1, startedAt: 7 })).lastInsertRowid,
    );
    db.prepare("insert into duel_seats (duel_id, seat, player_id, is_bot, ready) values (?, 0, ?, 0, 1), (?, 1, ?, 0, 1)").run(
      duelId,
      ids[0],
      duelId,
      ids[1],
    );
    migrate(db);
    const session = duels.get("old1", "g1");
    expect(session.format).toBe("1v1");
    expect(session.seats).toHaveLength(2);
    const state = duels.privateState("old1", "g1");
    expect(state.clock).toEqual({ turn: 2, remainingMs: [100, 200], activeSeat: 1, startedAt: 7 });
    expect(state.setup).toBeUndefined();
  });
});
