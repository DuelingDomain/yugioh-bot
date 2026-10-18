import { seedIdentity, seedUser } from "../helpers/identity.js";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { afterEach, describe, expect, it } from "vitest";
import { migrate } from "../../src/db/index.js";
import { createDuelService, DuelServiceError } from "../../src/services/duels.js";
import { createDuelSeriesService } from "../../src/services/duel-series.js";
import { createTournamentService } from "../../src/services/tournaments.js";

const databases: Database.Database[] = [];
const directories: string[] = [];
const workers: Worker[] = [];
const deck = { main: new Array(40).fill(1), extra: [], side: [] };

afterEach(async () => {
  await Promise.all(workers.splice(0).map((worker) => worker.terminate()));
  databases.splice(0).forEach((db) => db.close());
  directories.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
});

function setup(path = ":memory:") {
  const db = new Database(path);
  databases.push(db);
  migrate(db);
  const host = seedIdentity(db, { guildId: "g", name: "Host", userId: seedUser(db, "host").userId, discordUserId: seedUser(db, "host").discordUserId ?? "host" }).playerId;
  const guest = seedIdentity(db, { guildId: "g", name: "Guest", userId: seedUser(db, "guest").userId, discordUserId: seedUser(db, "guest").discordUserId ?? "guest" }).playerId;
  const viewer = seedIdentity(db, { guildId: "g", name: "Viewer", userId: seedUser(db, "viewer").userId, discordUserId: seedUser(db, "viewer").discordUserId ?? "viewer" }).playerId;
  const outsider = seedIdentity(db, { guildId: "elsewhere", name: "Outsider", userId: seedUser(db, "outsider").userId, discordUserId: seedUser(db, "outsider").discordUserId ?? "outsider" }).playerId;
  const duels = createDuelService(db);
  const series = createDuelSeriesService(db);
  return { db, duels, series, host, guest, viewer, outsider };
}

function expectStatus(work: () => unknown, status: number, message?: RegExp) {
  try {
    work();
  } catch (error) {
    expect(error).toBeInstanceOf(DuelServiceError);
    expect((error as DuelServiceError).status).toBe(status);
    if (message) expect((error as Error).message).toMatch(message);
    return;
  }
  throw new Error(`Expected status ${status}`);
}

describe("lobby departure", () => {
  it("releases a guest from an unstarted casual challenge without closing the host's room", () => {
    const app = setup();
    const match = app.series.createChallenge({ guildId: "g", challengerPlayerId: app.host, opponentPlayerId: app.guest,
      bestOf: 3, ranked: true, mode: "normal" });
    app.duels.setDeck(match.duel.slug, "g", app.host, deck);
    app.duels.setDeck(match.duel.slug, "g", app.guest, deck);
    const hostSeat = app.duels.get(match.duel.slug, "g").seats.find(seat => seat.playerId === app.host);
    const left = app.duels.leaveLobby(match.duel.slug, "g", app.guest);
    expect(left).toMatchObject({ slug: match.duel.slug, status: "lobby", seriesId: null, gameNumber: null, bestOf: 3, ranked: true });
    expect(left.settings).toEqual(match.duel.settings);
    expect(left.seats).toEqual([hostSeat]);
    expect(app.duels.room(left.slug, "g", app.host).myDeck).toEqual(deck);
    expect(app.series.get(match.series.id, "g")).toMatchObject({ status: "cancelled", currentDuelSlug: null, wins: [0, 0] });
    const invite = app.duels.room(left.slug, "g", app.host).inviteCode!;
    app.duels.admit(left.slug, "g", app.viewer, invite);
    app.duels.takeSeat(left.slug, "g", app.viewer);
    app.duels.setDeck(left.slug, "g", app.viewer, deck);
    const started = app.duels.activate(left.slug, "g", app.host, ["s"], "v", null);
    expect(started.seriesId).not.toBe(match.series.id);
    expect(app.series.get(started.seriesId!, "g").playerIds).toContain(app.viewer);
    expect(app.series.get(started.seriesId!, "g").playerIds).not.toContain(app.guest);
  });

  it("closes an unstarted casual challenge and its series when the host departs", () => {
    const app = setup();
    const match = app.series.createChallenge({ guildId: "g", challengerPlayerId: app.host, opponentPlayerId: app.guest,
      bestOf: 3, ranked: false, mode: "normal" });
    expect(app.duels.leaveLobby(match.duel.slug, "g", app.host).status).toBe("cancelled");
    expect(app.series.get(match.series.id, "g").status).toBe("cancelled");
  });

  it("cannot leave the later lobby of a match as host or guest", () => {
    const app = setup();
    const match = app.series.createChallenge({ guildId: "g", challengerPlayerId: app.host, opponentPlayerId: app.guest,
      bestOf: 3, ranked: false, mode: "normal" });
    app.duels.setDeck(match.duel.slug, "g", app.host, deck);
    app.duels.setDeck(match.duel.slug, "g", app.guest, deck);
    app.duels.activate(match.duel.slug, "g", null, ["s"], "v", null);
    app.duels.complete(match.duel.slug, "g", 0, "done");
    const next = app.series.createNextGame(match.series.id, "g");
    expectStatus(() => app.duels.leaveLobby(next.slug, "g", app.host), 409);
    expectStatus(() => app.duels.leaveLobby(next.slug, "g", app.guest), 409);
    expect(app.series.get(match.series.id, "g").status).toBe("active");
  });

  it("preserves tournament organizer cancellation and fixed seats", () => {
    const app = setup();
    const tournaments = createTournamentService(app.db);
    const cup = tournaments.create("g", "Cup", "single_elim", seedUser(app.db, "viewer").userId);
    tournaments.join(cup.id, app.host);
    tournaments.join(cup.id, app.guest);
    tournaments.start(cup.id);
    app.db.prepare("update tournament_participants set deck_json=? where tournament_id=?").run(JSON.stringify(deck), cup.id);
    const slot = app.db.prepare("select id,player_one_id from tournament_matches where tournament_id=?").get(cup.id) as { id: number; player_one_id: number };
    const match = app.series.startTournamentMatch({ guildId: "g", tournamentMatchId: slot.id, actorPlayerId: slot.player_one_id });
    const opponent = match.duel.seats.find(seat => seat.playerId !== match.duel.organizerPlayerId)!.playerId!;
    expectStatus(() => app.duels.leaveLobby(match.duel.slug, "g", match.duel.organizerPlayerId), 403);
    expectStatus(() => app.duels.leaveLobby(match.duel.slug, "g", opponent), 409);
    expect(app.duels.get(match.duel.slug, "g").seats).toHaveLength(2);
    expect(app.series.get(match.series.id, "g").status).toBe("active");
  });

  it.each(["1v1", "tag", "ffa3", "ffa4"] as const)("closes a hosted %s lobby with other players", format => {
    const app = setup();
    const table = app.duels.create({ guildId: "g", organizerPlayerId: app.host, name: "Close", mode: "normal", format });
    app.duels.takeSeat(table.slug, "g", app.guest, 1);
    expect(app.duels.leaveLobby(table.slug, "g", app.host).status).toBe("cancelled");
    expect(app.duels.room(table.slug, "g", app.guest).session.status).toBe("cancelled");
  });

  it.each(["1v1", "tag", "ffa3", "ffa4"] as const)("releases a guest's %s seat while leaving the lobby open", format => {
    const app = setup();
    const table = app.duels.create({ guildId: "g", organizerPlayerId: app.host, name: "Leave", mode: "normal", format });
    app.duels.takeSeat(table.slug, "g", app.guest, 1);
    app.duels.setDeck(table.slug, "g", app.guest, deck);
    expect(app.duels.leaveLobby(table.slug, "g", app.guest).status).toBe("lobby");
    expect(app.duels.room(table.slug, "g", app.guest)).toMatchObject({ mySeat: null, myDeck: null });
  });

  it("refuses departure after an opening or game starts, even for the host", () => {
    const app = setup();
    const table = app.duels.create({ guildId: "g", organizerPlayerId: app.host, name: "Start", mode: "normal" });
    app.duels.takeSeat(table.slug, "g", app.guest, 1);
    app.duels.setDeck(table.slug, "g", app.host, deck);
    app.duels.setDeck(table.slug, "g", app.guest, deck);
    app.duels.startOpening(table.slug, "g", app.host, Date.now());
    expectStatus(() => app.duels.leaveLobby(table.slug, "g", app.host), 409);
    expectStatus(() => app.duels.leaveLobby(table.slug, "g", app.guest), 409);
    app.duels.abortOpening(table.slug, "g");
    app.duels.activate(table.slug, "g", app.host, ["s"], "v", null);
    expectStatus(() => app.duels.leaveLobby(table.slug, "g", app.host), 409);
  });

  it("cannot depart as a spectator or a foreign guild player", () => {
    const app = setup();
    const table = app.duels.create({ guildId: "g", organizerPlayerId: app.host, name: "Stay", mode: "normal" });
    expectStatus(() => app.duels.leaveLobby(table.slug, "g", app.viewer), 403);
    expectStatus(() => app.duels.leaveLobby(table.slug, "g", app.outsider), 400);
  });
});

describe("explicit lobby seats", () => {
  it.each(["normal", "domain"] as const)("opens a %s table as a spectator until a seat is chosen", (mode) => {
    const app = setup();
    const table = app.duels.create({ guildId: "g", organizerPlayerId: app.host, name: "Table", mode });
    expect(app.duels.room(table.slug, "g", app.guest)).toMatchObject({ role: "spectator", mySeat: null, myDeck: null });
    expect(app.duels.room(table.slug, "g", app.guest).session.seats).toHaveLength(1);
    expect(app.duels.room(table.slug, "g", app.host).mySeat).toBe(0);
    app.duels.takeSeat(table.slug, "g", app.guest, 1);
    expect(app.duels.room(table.slug, "g", app.guest)).toMatchObject({ role: "player", mySeat: 1, myDeck: null });
    expect(app.duels.get(table.slug, "g").seats[1].ready).toBe(false);
    app.duels.setDeck(table.slug, "g", app.guest, deck);
    expect(app.duels.room(table.slug, "g", app.guest).myDeck).toEqual(deck);
  });

  it("lets visitors watch full tables and refuses an occupied seat with a clear conflict", () => {
    const app = setup();
    const table = app.duels.create({ guildId: "g", organizerPlayerId: app.host, name: "Full", mode: "normal" });
    app.duels.takeSeat(table.slug, "g", app.guest, 1);
    expect(app.duels.room(table.slug, "g", app.viewer).session.seats).toHaveLength(2);
    expect(app.duels.room(table.slug, "g", app.viewer).role).toBe("spectator");
    expectStatus(() => app.duels.takeSeat(table.slug, "g", app.viewer, 1), 409, /seat.*taken/i);
    expectStatus(() => app.duels.takeSeat(table.slug, "g", app.viewer, 0), 409, /seat.*taken/i);
  });

  it("leaves to watch, clears the submitted deck and ready flag, and can sit again", () => {
    const app = setup();
    const table = app.duels.create({ guildId: "g", organizerPlayerId: app.host, name: "Switch", mode: "domain" });
    app.duels.takeSeat(table.slug, "g", app.guest, 1);
    app.duels.setDeck(table.slug, "g", app.guest, { ...deck, deckMaster: 100 });
    app.duels.leave(table.slug, "g", app.guest);
    expect(app.duels.room(table.slug, "g", app.guest)).toMatchObject({ role: "spectator", mySeat: null, myDeck: null });
    expect(app.duels.get(table.slug, "g").seats).toHaveLength(1);
    app.duels.takeSeat(table.slug, "g", app.guest, 1);
    expect(app.duels.room(table.slug, "g", app.guest).myDeck).toBeNull();
    expect(app.duels.get(table.slug, "g").seats[1]).toMatchObject({ ready: false });
    expect(app.duels.get(table.slug, "g").seats[1].deckMaster).toBeUndefined();
    expectStatus(() => app.duels.leave(table.slug, "g", app.host), 409, /organizer.*cancel/i);
    expectStatus(() => app.duels.leave(table.slug, "g", app.viewer), 403);
  });

  it("validates seat indices and makes repeated lobby claims idempotent without resetting a deck", () => {
    const app = setup();
    const table = app.duels.create({ guildId: "g", organizerPlayerId: app.host, name: "Seat", mode: "normal" });
    for (const seat of [-1, 2, 0.5, NaN]) {
      expectStatus(() => app.duels.takeSeat(table.slug, "g", app.guest, seat), 400);
    }
    app.duels.takeSeat(table.slug, "g", app.guest, 1);
    app.duels.setDeck(table.slug, "g", app.guest, deck);
    expect(app.duels.takeSeat(table.slug, "g", app.guest, 1).seats).toHaveLength(2);
    expect(app.duels.room(table.slug, "g", app.guest).myDeck).toEqual(deck);
    expectStatus(() => app.duels.takeSeat(table.slug, "g", app.guest, 0), 409, /already seated/i);
  });

  it("enforces guild membership and private invites for watching and taking seats", () => {
    const app = setup();
    const table = app.duels.create({ guildId: "g", organizerPlayerId: app.host, name: "Private", mode: "normal", settings: { visibility: "private" } });
    expectStatus(() => app.duels.room(table.slug, "g", app.guest), 403);
    expectStatus(() => app.duels.takeSeat(table.slug, "g", app.guest, 1), 403);
    expectStatus(() => app.duels.takeSeat(table.slug, "g", app.outsider, 1), 400);
    expectStatus(() => app.duels.room(table.slug, "g", app.outsider), 400);
    expect(app.duels.list("g", app.guest)).toEqual([]);
    app.duels.admit(table.slug, "g", app.guest, app.duels.room(table.slug, "g", app.host).inviteCode!);
    expect(app.duels.room(table.slug, "g", app.guest).session.seats).toHaveLength(1);
    expect(app.duels.list("g", app.guest).map((item) => item.slug)).toContain(table.slug);
    app.duels.takeSeat(table.slug, "g", app.guest, 1);
    app.duels.leave(table.slug, "g", app.guest);
    expect(app.duels.room(table.slug, "g", app.guest).role).toBe("spectator");
  });

  it("keeps a bot's occupied seat unavailable to human spectators", () => {
    const app = setup();
    const table = app.duels.create({ guildId: "g", organizerPlayerId: app.host, name: "Bot", mode: "normal" });
    app.duels.addPracticeBot(table.slug, "g", app.host, deck);
    expect(app.duels.room(table.slug, "g", app.guest).session.seats[1].isBot).toBe(true);
    expectStatus(() => app.duels.takeSeat(table.slug, "g", app.guest, 1), 409);
    app.duels.removePracticeBot(table.slug, "g", app.host);
    expect(app.duels.takeSeat(table.slug, "g", app.guest, 1).seats[1].isBot).toBe(false);
  });

  it("locks claims and leaving during RPS, but still allows watching", () => {
    const app = setup();
    const table = app.duels.create({ guildId: "g", organizerPlayerId: app.host, name: "RPS", mode: "normal" });
    app.duels.takeSeat(table.slug, "g", app.guest, 1);
    app.duels.setDeck(table.slug, "g", app.host, deck);
    app.duels.setDeck(table.slug, "g", app.guest, deck);
    app.duels.startOpening(table.slug, "g", app.host, Date.now());
    expectStatus(() => app.duels.takeSeat(table.slug, "g", app.viewer, 1), 409, /about to start/i);
    expectStatus(() => app.duels.leave(table.slug, "g", app.guest), 409);
    expect(app.duels.room(table.slug, "g", app.viewer).session.status).toBe("lobby");
  });

  it.each(["active", "completed", "interrupted", "cancelled"] as const)("blocks seat changes on %s tables while permitting spectators to enter", (status) => {
    const app = setup();
    const table = app.duels.create({ guildId: "g", organizerPlayerId: app.host, name: "Locked", mode: "normal" });
    app.duels.takeSeat(table.slug, "g", app.guest, 1);
    if (status === "cancelled") app.duels.cancel(table.slug, "g", app.host);
    else {
      app.duels.setDeck(table.slug, "g", app.host, deck);
      app.duels.setDeck(table.slug, "g", app.guest, deck);
      app.duels.activate(table.slug, "g", app.host, ["s"], "v", null);
      if (status === "completed") app.duels.complete(table.slug, "g", 0, "done");
      if (status === "interrupted") app.duels.interrupt(table.slug, "g", "stopped");
    }
    expectStatus(() => app.duels.takeSeat(table.slug, "g", app.viewer, 1), 409);
    expectStatus(() => app.duels.leave(table.slug, "g", app.guest), 409);
    expect(app.duels.room(table.slug, "g", app.viewer).session.status).toBe(status);
  });

  it("keeps best-of-3 seats locked between games and in the next game's lobby", () => {
    const app = setup();
    const table = app.duels.create({ guildId: "g", organizerPlayerId: app.host, name: "Match", mode: "normal", bestOf: 3 });
    app.duels.takeSeat(table.slug, "g", app.guest, 1);
    app.duels.setDeck(table.slug, "g", app.host, deck);
    app.duels.setDeck(table.slug, "g", app.guest, deck);
    app.duels.activate(table.slug, "g", app.host, ["s"], "v", null);
    const finished = app.duels.complete(table.slug, "g", 0, "done");
    expect(app.series.get(finished.seriesId!, "g").status).toBe("between_games");
    expectStatus(() => app.duels.leave(table.slug, "g", app.guest), 409);
    const next = app.series.createNextGame(finished.seriesId!, "g");
    expect(next.status).toBe("lobby");
    expectStatus(() => app.duels.leave(next.slug, "g", app.guest), 409, /fixed/i);
    expectStatus(() => app.duels.takeSeat(next.slug, "g", app.viewer, 1), 409, /fixed/i);
    expect(app.duels.room(next.slug, "g", app.viewer).session.seats).toHaveLength(2);
    expect(app.duels.room(next.slug, "g", app.viewer).role).toBe("spectator");
  });

  it("allows only one of two simultaneous claims on separate SQLite connections", async () => {
    const dir = mkdtempSync(join(tmpdir(), "duel-seat-race-"));
    directories.push(dir);
    const path = join(dir, "duels.sqlite");
    const app = setup(path);
    const table = app.duels.create({ guildId: "g", organizerPlayerId: app.host, name: "Race", mode: "normal" });
    const modulePath = fileURLToPath(new URL("../../src/services/duels.ts", import.meta.url));
    const claims = [app.guest, app.viewer].map((playerId) => {
      const worker = new Worker(`
        require("tsx/cjs");
        const { parentPort, workerData } = require("node:worker_threads");
        const Database = require("better-sqlite3");
        const { createDuelService } = require(workerData.modulePath);
        const db = new Database(workerData.path);
        const duels = createDuelService(db);
        parentPort.once("message", () => {
          try {
            duels.takeSeat(workerData.slug, "g", workerData.playerId, 1);
            parentPort.postMessage({ ok: true });
          } catch (error) {
            parentPort.postMessage({ ok: false, status: error.status, message: error.message });
          } finally { db.close(); }
        });
        parentPort.postMessage("ready");
      `, { eval: true, workerData: { modulePath, path, slug: table.slug, playerId } });
      workers.push(worker);
      const ready = new Promise<void>((resolve, reject) => {
        worker.once("message", () => resolve());
        worker.once("error", reject);
      });
      const result = ready.then(() => new Promise<{ ok: boolean; status?: number; message?: string }>((resolve, reject) => {
        worker.once("message", resolve);
        worker.once("error", reject);
      }));
      return { worker, ready, result };
    });
    await Promise.all(claims.map((claim) => claim.ready));
    claims.forEach((claim) => claim.worker.postMessage("claim"));
    const results = await Promise.all(claims.map((claim) => claim.result));
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.find((result) => !result.ok)).toMatchObject({ status: 409, message: expect.stringMatching(/seat.*taken/i) });
    const occupied = app.duels.get(table.slug, "g").seats;
    expect(occupied).toHaveLength(2);
    expect([app.guest, app.viewer]).toContain(occupied[1].playerId);
  }, 15_000);
});
