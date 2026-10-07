import { seedIdentity, seedUser } from "../helpers/identity.js";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { migrate } from "../../src/db/index.js";
import type { DuelDeck } from "../../src/duels/index.js";
import { createDuelSeriesService } from "../../src/services/duel-series.js";
import { createDuelService } from "../../src/services/duels.js";
import { createLiveNowService } from "../../src/services/live-now.js";

function insertPlayer(db: Database.Database, guildId: string, userId: string, name: string) {
  return seedIdentity(db, { guildId: guildId, name: name, userId: seedUser(db, userId).userId, discordUserId: seedUser(db, userId).discordUserId ?? userId }).playerId;
}

function validDeck(start = 1): DuelDeck {
  return {
    main: Array.from({ length: 40 }, (_, index) => start + index),
    extra: [start + 100],
    side: [start + 200, start + 201],
  };
}

function setup() {
  const db = new Database(":memory:");
  migrate(db);
  const p1 = insertPlayer(db, "g1", "u1", "Yugi");
  const p2 = insertPlayer(db, "g1", "u2", "Kaiba");
  const p3 = insertPlayer(db, "g1", "u3", "Joey");
  const p4 = insertPlayer(db, "g1", "u4", "Tea");
  const other = insertPlayer(db, "g2", "u9", "Marik");
  return {
    db,
    duels: createDuelService(db),
    series: createDuelSeriesService(db),
    live: createLiveNowService(db),
    p1, p2, p3, p4, other,
  };
}

type App = ReturnType<typeof setup>;

function startChallenge(app: App, bestOf: 1 | 3 = 3) {
  const started = app.series.createChallenge({
    guildId: "g1", challengerPlayerId: app.p1, opponentPlayerId: app.p2, bestOf, ranked: false, mode: "normal",
  });
  return started.duel.slug;
}

function readyBoth(app: App, slug: string) {
  app.duels.setDeck(slug, "g1", app.p1, validDeck(1));
  app.duels.setDeck(slug, "g1", app.p2, validDeck(1000));
}

function seatOf(app: App, slug: string, playerId: number) {
  return app.duels.get(slug, "g1").seats.find((seat) => seat.playerId === playerId)!.seat;
}

describe("live now", () => {
  it("includes each other seat for presence in a full multiplayer lobby", () => {
    const app = setup();
    const duel = app.duels.create({ guildId: "g1", organizerPlayerId: app.p1, name: "Four", mode: "normal", format: "ffa4" });
    app.duels.takeSeat(duel.slug, "g1", app.p2, 1);
    app.duels.takeSeat(duel.slug, "g1", app.p3, 2);
    app.duels.takeSeat(duel.slug, "g1", app.p4, 3);
    expect(app.live.forPlayer("g1", app.p2).yourDuel).toMatchObject({ href: `/duels/${duel.slug}`, opponents: [
      { seat: 0, name: "Yugi", isBot: false }, { seat: 2, name: "Joey", isBot: false }, { seat: 3, name: "Tea", isBot: false },
    ] });
    expect(app.live.forPlayer("g2", app.other).yourDuel).toBeNull();
  });
  it("is empty when nothing is happening", () => {
    const app = setup();
    expect(app.live.forPlayer("g1", app.p1)).toEqual({ yourDuel: null, liveCount: 0 });
  });

  it("ignores a lobby with one seat taken", () => {
    const app = setup();
    app.duels.create({ guildId: "g1", organizerPlayerId: app.p1, name: "Open", mode: "normal" });
    expect(app.live.forPlayer("g1", app.p1)).toEqual({ yourDuel: null, liveCount: 0 });
  });

  it("walks a best of 3 challenge through waiting, live and between games", () => {
    const app = setup();
    const slug = startChallenge(app);
    for (const [viewer, opponent, opponentId] of [[app.p1, "Kaiba", app.p2], [app.p2, "Yugi", app.p1]] as const) {
      expect(app.live.forPlayer("g1", viewer).yourDuel).toEqual({ href: `/duels/${slug}`, opponent, state: "waiting",
        opponents: [{ seat: seatOf(app, slug, opponentId), name: opponent, isBot: false }] });
    }
    // A bystander sees nothing of their own, and the lobby is not live.
    expect(app.live.forPlayer("g1", app.p3)).toEqual({ yourDuel: null, liveCount: 0 });

    readyBoth(app, slug);
    app.duels.activate(slug, "g1", null, ["s"], "v", null);
    expect(app.live.forPlayer("g1", app.p1)).toEqual({
      yourDuel: { href: `/duels/${slug}`, opponent: "Kaiba", state: "live", opponents: [{ seat: seatOf(app, slug, app.p2), name: "Kaiba", isBot: false }] },
      liveCount: 0 + 1,
    });

    app.duels.complete(slug, "g1", seatOf(app, slug, app.p1), "done");
    expect(app.live.forPlayer("g1", app.p2)).toEqual({
      yourDuel: { href: `/duels/${slug}`, opponent: "Yugi", state: "between", opponents: [{ seat: seatOf(app, slug, app.p1), name: "Yugi", isBot: false }] },
      liveCount: 0,
    });

    const next = app.series.createNextGame(app.duels.get(slug, "g1").seriesId!, "g1");
    expect(app.live.forPlayer("g1", app.p2).yourDuel).toMatchObject({ href: `/duels/${next.slug}`, state: "waiting" });
  });

  it("puts a lobby that waits on the viewer ahead of a running duel", () => {
    const app = setup();
    const slug = startChallenge(app, 1);
    readyBoth(app, slug);
    app.duels.activate(slug, "g1", null, ["s"], "v", null);
    const second = app.series.createChallenge({
      guildId: "g1", challengerPlayerId: app.p1, opponentPlayerId: app.p3, bestOf: 1, ranked: false, mode: "normal",
    }).duel.slug;
    expect(app.live.forPlayer("g1", app.p1).yourDuel).toMatchObject({ href: `/duels/${second}`, opponent: "Joey", state: "waiting" });
    // Once the viewer has readied up, the running duel comes first.
    app.duels.setDeck(second, "g1", app.p1, validDeck(1));
    expect(app.live.forPlayer("g1", app.p1).yourDuel).toMatchObject({ href: `/duels/${slug}`, state: "live" });
  });

  it("counts running public duels for everyone and private ones only for those allowed in", () => {
    const app = setup();
    const publicTable = app.duels.create({ guildId: "g1", organizerPlayerId: app.p1, name: "Open", mode: "normal" }).slug;
    app.duels.takeSeat(publicTable, "g1", app.p2);
    readyBoth(app, publicTable);
    app.duels.activate(publicTable, "g1", app.p1, ["s"], "v", null);

    const privateTable = app.duels.create({
      guildId: "g1", organizerPlayerId: app.p3, name: "Hidden", mode: "normal", settings: { visibility: "private" },
    }).slug;
    app.duels.addPracticeBot(privateTable, "g1", app.p3, validDeck(5000));
    app.duels.setDeck(privateTable, "g1", app.p3, validDeck(3000));
    app.duels.activate(privateTable, "g1", app.p3, ["s"], "v", null);

    expect(app.live.forPlayer("g1", app.p4).liveCount).toBe(1);
    expect(app.live.forPlayer("g1", app.p3)).toMatchObject({ liveCount: 2, yourDuel: { opponent: "Practice Bot", state: "live" } });
    expect(app.live.forPlayer("g2", app.other)).toEqual({ yourDuel: null, liveCount: 0 });
  });

  it("stops counting a duel nobody has touched for a while, unless the viewer is in it", () => {
    const app = setup();
    const slug = app.duels.create({ guildId: "g1", organizerPlayerId: app.p1, name: "Open", mode: "normal" }).slug;
    app.duels.takeSeat(slug, "g1", app.p2);
    readyBoth(app, slug);
    app.duels.activate(slug, "g1", app.p1, ["s"], "v", null);
    app.db.prepare("update duels set last_activity_at = datetime('now', '-2 hours') where web_slug = ?").run(slug);
    expect(app.live.forPlayer("g1", app.p4).liveCount).toBe(0);
    expect(app.live.forPlayer("g1", app.p1).liveCount).toBe(1);
  });

  it("agrees with the duel list that the duels page shows", () => {
    const app = setup();
    const a = app.duels.create({ guildId: "g1", organizerPlayerId: app.p1, name: "A", mode: "normal" }).slug;
    app.duels.takeSeat(a, "g1", app.p2);
    readyBoth(app, a);
    app.duels.activate(a, "g1", app.p1, ["s"], "v", null);
    const b = app.duels.create({ guildId: "g1", organizerPlayerId: app.p3, name: "B", mode: "normal", settings: { visibility: "private" } }).slug;
    app.duels.addPracticeBot(b, "g1", app.p3, validDeck(5000));
    app.duels.setDeck(b, "g1", app.p3, validDeck(3000));
    app.duels.activate(b, "g1", app.p3, ["s"], "v", null);
    app.duels.create({ guildId: "g1", organizerPlayerId: app.p4, name: "Lobby", mode: "normal" });
    for (const viewer of [app.p1, app.p2, app.p3, app.p4]) {
      const listed = app.duels.list("g1", viewer).filter((duel) => duel.status === "active").length;
      expect(app.live.forPlayer("g1", viewer).liveCount).toBe(listed);
    }
  });
});
