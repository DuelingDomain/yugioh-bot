import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../../src/db/index.js";
import { createActiveDuelService, createDuelService, createDuelSeriesService, createTournamentService } from "../../src/services/index.js";
import type { DuelFormat } from "../../src/duels/index.js";
import { seedIdentity } from "../helpers/identity.js";

let db: Database.Database;
let duels: ReturnType<typeof createDuelService>;
let series: ReturnType<typeof createDuelSeriesService>;
let active: ReturnType<typeof createActiveDuelService>;
let host: number;
let guest: number;
let viewer: number;
let statements: string[];
const deck = { main: new Array(40).fill(1), extra: [], side: [] };

beforeEach(() => {
  statements = [];
  db = new Database(":memory:", { verbose: (sql) => statements.push(String(sql)) });
  db.pragma("foreign_keys=on");
  migrate(db);
  host = seedIdentity(db, { guildId: "g", playerId: 51, userId: "196382527131222016" }).playerId;
  guest = seedIdentity(db, { guildId: "g", playerId: 72, userId: "196382527131222017" }).playerId;
  viewer = seedIdentity(db, { guildId: "g", userId: "196382527131222018" }).playerId;
  duels = createDuelService(db);
  series = createDuelSeriesService(db);
  active = createActiveDuelService(db);
});
afterEach(() => db.close());

function room(format: DuelFormat = "1v1", seated = false) {
  const duel = duels.create({ guildId: "g", organizerPlayerId: host, name: "Table", mode: "normal", format });
  if (seated) duels.takeSeat(duel.slug, "g", guest, format === "1v1" ? 1 : 2);
  return duel;
}

function start(slug: string) {
  const session = duels.get(slug, "g");
  for (const seat of session.seats) if (seat.playerId !== null) duels.setDeck(slug, "g", seat.playerId, deck);
  duels.activate(slug, "g", session.seriesId === null ? host : null, ["s"], "v", null);
}

function challenge() {
  return series.createChallenge({ guildId: "g", challengerPlayerId: host, opponentPlayerId: guest, bestOf: 3, ranked: false, mode: "normal" });
}

describe("active duel lookup", () => {
  it("ignores sandbox lobbies and playing duels without hiding an ordinary game", () => {
    const sandbox = duels.create({ guildId: "g", organizerPlayerId: host, name: "Sandbox", mode: "normal", sandbox: true });
    expect(active.forPlayer("g", host)).toBeNull();
    duels.setDeck(sandbox.slug, "g", host, deck);
    duels.addPracticeBot(sandbox.slug, "g", host, deck, 1);
    duels.activate(sandbox.slug, "g", host, ["s"], "v", null);
    expect(active.forPlayer("g", host)).toBeNull();
    const normal = room("1v1", true);
    start(normal.slug);
    db.prepare("update duels set created_at='2099-01-01' where id=?").run(sandbox.id);
    expect(active.forPlayer("g", host)).toMatchObject({ slug: normal.slug, state: "playing" });
  });

  it.each(["1v1", "tag", "ffa3", "ffa4"] as const)("finds %s human seats in a lobby, including a host alone", format => {
    const duel = room(format);
    expect(active.forPlayer("g", host)).toEqual({ slug: duel.slug, state: "lobby", role: "host", format });
    expect(active.forPlayer("g", guest)).toBeNull();
    duels.takeSeat(duel.slug, "g", guest, format === "1v1" ? 1 : 2);
    expect(active.forPlayer("g", guest)).toEqual({ slug: duel.slug, state: "lobby", role: "guest", format });
  });

  it.each(["1v1", "tag", "ffa3", "ffa4"] as const)("finds playing %s games with bots and ignores spectators", format => {
    const duel = room(format, true);
    const count = format === "ffa3" ? 3 : format === "1v1" ? 2 : 4;
    while (duels.get(duel.slug, "g").seats.length < count) duels.addPracticeBot(duel.slug, "g", host, deck);
    start(duel.slug);
    expect(active.forPlayer("g", host)).toEqual({ slug: duel.slug, state: "playing", role: "host", format });
    expect(active.forPlayer("g", guest)).toEqual({ slug: duel.slug, state: "playing", role: "guest", format });
    expect(active.forPlayer("g", viewer)).toBeNull();
  });

  it("includes a private practice bot duel without creating a bot player", () => {
    const duel = duels.create({ guildId: "g", organizerPlayerId: host, name: "Private bot", mode: "domain", settings: { visibility: "private" } });
    duels.addPracticeBot(duel.slug, "g", host, { ...deck, deckMaster: 1 });
    duels.setDeck(duel.slug, "g", host, { ...deck, deckMaster: 1 });
    duels.activate(duel.slug, "g", host, ["s"], "v", null);
    expect(active.forPlayer("g", host)).toMatchObject({ slug: duel.slug, state: "playing" });
    expect(active.forPlayer("g", viewer)).toBeNull();
  });

  it.each(["1v1", "ffa3", "ffa4"] as const)("treats a %s opening as playing", format => {
    const duel = room(format, true);
    const count = format === "ffa3" ? 3 : format === "ffa4" ? 4 : 2;
    while (duels.get(duel.slug, "g").seats.length < count) duels.addPracticeBot(duel.slug, "g", host, deck);
    duels.setDeck(duel.slug, "g", host, deck);
    duels.setDeck(duel.slug, "g", guest, deck);
    duels.startOpening(duel.slug, "g", host, Date.now());
    expect(active.forPlayer("g", guest)).toMatchObject({ state: "playing" });
  });

  it.each(["completed", "interrupted", "cancelled"] as const)("ignores a %s standalone duel", status => {
    const duel = room("ffa3", true);
    duels.addPracticeBot(duel.slug, "g", host, deck);
    if (status !== "cancelled") start(duel.slug);
    if (status === "completed") duels.complete(duel.slug, "g", 0, "done");
    else if (status === "interrupted") duels.interrupt(duel.slug, "g", "stopped");
    else duels.cancel(duel.slug, "g", host);
    expect(active.forPlayer("g", host)).toBeNull();
    expect(active.forPlayer("g", guest)).toBeNull();
  });

  it("ignores a replay fork even when its creator is seated", () => {
    db.prepare(`insert into duels(guild_id,web_slug,name,organizer_player_id,mode,status,kind)
      values('g','fork','Replay fork',?,'normal','active','replay-fork')`).run(host);
    db.prepare("insert into duel_seats(duel_id,seat,player_id) values(last_insert_rowid(),0,?)").run(host);
    expect(active.forPlayer("g", host)).toBeNull();
  });

  it("requires a seat rather than organizer identity or an invite grant", () => {
    const duel = room();
    db.prepare("insert into duel_invite_grants(duel_id,player_id) values(?,?)").run(duel.id, guest);
    db.prepare("delete from duel_seats where duel_id=?").run(duel.id);
    expect(active.forPlayer("g", host)).toBeNull();
    expect(active.forPlayer("g", guest)).toBeNull();
  });

  it("enforces both duel and player guild scope", () => {
    const duel = room();
    expect(active.forPlayer("other", host)).toBeNull();
    const outsider = seedIdentity(db, { guildId: "other" }).playerId;
    db.prepare("insert into duel_seats(duel_id,seat,player_id) values(?,1,?)").run(duel.id, outsider);
    expect(active.forPlayer("g", outsider)).toBeNull();
    expect(active.forPlayer("g", 999999)).toBeNull();
  });

  it("selects by creation time with a stable ID tie break, without an idle cutoff", () => {
    const older = room();
    const newer = room();
    expect(active.forPlayer("g", host)?.slug).toBe(newer.slug);
    db.prepare("update duels set created_at='2020-01-01',last_activity_at='2026-10-16' where id=?").run(newer.id);
    db.prepare("update duels set created_at='2020-01-02',last_activity_at='2020-01-02' where id=?").run(older.id);
    expect(active.forPlayer("g", host)?.slug).toBe(older.slug);
  });

  it("keeps a playing game ahead of a newer lobby, picking the newest playing game", () => {
    const playing = room("1v1", true);
    start(playing.slug);
    room();
    expect(active.forPlayer("g", host)?.slug).toBe(playing.slug);
    const newer = room("ffa3", true);
    duels.addPracticeBot(newer.slug, "g", host, deck);
    start(newer.slug);
    expect(active.forPlayer("g", host)?.slug).toBe(newer.slug);
  });

  it.each(["eliminate:0", "eliminate:3"])("ignores a surrendered seat journaled with %s", promptId => {
    const duel = room("ffa3", true);
    duels.addPracticeBot(duel.slug, "g", host, deck);
    start(duel.slug);
    duels.recordCommand(duel.slug, "g", 2, { promptId, revision: 1, answer: {} }, null);
    expect(active.forPlayer("g", guest)).toBeNull();
    expect(active.forPlayer("g", host)).toMatchObject({ slug: duel.slug, state: "playing" });
  });

  it.each([false, true])("keeps a turn-end surrender guarded until confirmed by the engine (legacy setup: %s)", legacySetup => {
    const duel = room("ffa3", true);
    duels.addPracticeBot(duel.slug, "g", host, deck);
    start(duel.slug);
    const setup = legacySetup ? { surrenderedSeats: [2] } : {};
    duels.setSetup(duel.slug, "g", setup);
    duels.recordCommand(duel.slug, "g", 2, { promptId: "eliminate-eot:0", revision: 1, answer: {} }, null);
    expect(active.forPlayer("g", guest)).toMatchObject({ slug: duel.slug, state: "playing" });
    duels.setSetup(duel.slug, "g", { ...setup, eliminatedSeats: [2] });
    expect(active.forPlayer("g", guest)).toBeNull();
    expect(active.forPlayer("g", host)).toMatchObject({ slug: duel.slug, state: "playing" });
  });

  it("ignores a legacy surrendered seat stored in setup", () => {
    const duel = room("tag", true);
    duels.addPracticeBot(duel.slug, "g", host, deck);
    duels.addPracticeBot(duel.slug, "g", host, deck);
    start(duel.slug);
    duels.setSetup(duel.slug, "g", { surrenderedSeats: [2] });
    expect(active.forPlayer("g", guest)).toBeNull();
  });

  it.each(["ffa3", "ffa4", "tag"] as const)("releases confirmed engine eliminations in %s while other seats keep playing", format => {
    const duel = room(format, true);
    const count = format === "ffa3" ? 3 : 4;
    while (duels.get(duel.slug, "g").seats.length < count) duels.addPracticeBot(duel.slug, "g", host, deck);
    start(duel.slug);
    const setup = { firstTurnDraw: false, eliminatedSeats: format === "tag" ? [0, 2] : [2] };
    duels.setSetup(duel.slug, "g", setup);
    expect(duels.privateState(duel.slug, "g").setup).toEqual(setup);
    expect(duels.get(duel.slug, "g").status).toBe("active");
    expect(active.forPlayer("g", guest)).toBeNull();
    if (format === "tag") {
      expect(active.forPlayer("g", host)).toBeNull();
    } else {
      expect(active.forPlayer("g", host)).toMatchObject({ slug: duel.slug, state: "playing" });
    }
  });

  it("keeps best-of-3 active between games and targets only the latest game, retaining organizer role across swaps", () => {
    const match = challenge();
    expect(active.forPlayer("g", host)).toMatchObject({ state: "lobby" });
    start(match.duel.slug);
    const seat = duels.get(match.duel.slug, "g").seats.find(s => s.playerId === host)!.seat;
    duels.complete(match.duel.slug, "g", seat, "done");
    expect(series.get(match.series.id, "g").status).toBe("between_games");
    expect(active.forPlayer("g", host)).toEqual({ slug: match.duel.slug, state: "playing", role: "host", format: "1v1" });
    expect(active.forPlayer("g", guest)).toMatchObject({ slug: match.duel.slug, state: "playing", role: "guest" });
    expect(active.forPlayer("g", viewer)).toBeNull();
    series.setFirstChoice(match.series.id, "g", guest, "first");
    const next = series.createNextGame(match.series.id, "g");
    expect(active.forPlayer("g", host)).toEqual({ slug: next.slug, state: "playing", role: "host", format: "1v1" });
    expect(active.forPlayer("g", guest)).toMatchObject({ slug: next.slug, role: "guest" });
    start(next.slug);
    duels.complete(next.slug, "g", next.seats.find(s => s.playerId === host)!.seat, "done");
    expect(series.get(match.series.id, "g").status).toBe("completed");
    expect(active.forPlayer("g", host)).toBeNull();
  });

  it("retains interrupted best-of-3 breaks and releases cancelled matches", () => {
    const match = challenge();
    start(match.duel.slug);
    duels.interrupt(match.duel.slug, "g", "crash");
    expect(active.forPlayer("g", guest)).toMatchObject({ slug: match.duel.slug, state: "playing" });
    series.cancel(match.series.id, "g");
    expect(active.forPlayer("g", guest)).toBeNull();
  });

  it("continues guarding a running game if its series is cancelled without ending the engine game", () => {
    const match = challenge();
    start(match.duel.slug);
    series.cancel(match.series.id, "g");
    expect(duels.get(match.duel.slug, "g").status).toBe("active");
    expect(active.forPlayer("g", guest)).toMatchObject({ slug: match.duel.slug, state: "playing" });
    duels.complete(match.duel.slug, "g", 0, "done");
    expect(active.forPlayer("g", guest)).toBeNull();
  });

  it("includes seated tournament players and excludes unrelated viewers", () => {
    const tournaments = createTournamentService(db);
    const user = db.prepare("select discord_user_id from players where id=?").get(host) as { discord_user_id: string };
    const cup = tournaments.create("g", "Cup", "single_elim", user.discord_user_id);
    tournaments.join(cup.id, host);
    tournaments.join(cup.id, guest);
    tournaments.start(cup.id);
    db.prepare("update tournament_participants set deck_json=? where tournament_id=?").run(JSON.stringify(deck), cup.id);
    const slot = db.prepare("select id from tournament_matches where tournament_id=? limit 1").get(cup.id) as { id: number };
    const match = series.startTournamentMatch({ guildId: "g", tournamentMatchId: slot.id, actorPlayerId: host });
    expect(active.forPlayer("g", guest)).toMatchObject({ slug: match.duel.slug, state: "lobby" });
    start(match.duel.slug);
    expect(active.forPlayer("g", guest)).toMatchObject({ state: "playing" });
    expect(active.forPlayer("g", viewer)).toBeNull();
  });

  it("executes exactly one query without loading decks, boards, or sessions", () => {
    room("1v1", true);
    statements.length = 0;
    active.forPlayer("g", guest);
    expect(statements).toHaveLength(1);
    expect(statements[0]).not.toMatch(/select\s+\*|snapshot_|deck_json/i);
    const plan = db.prepare(`explain query plan ${statements[0]}`).all() as { detail: string }[];
    expect(plan).toContainEqual(expect.objectContaining({ detail: expect.stringContaining("duel_seats_player_idx") }));
    expect(plan).toContainEqual(expect.objectContaining({ detail: expect.stringContaining("duel_commands_eliminated_idx") }));
  });
});
