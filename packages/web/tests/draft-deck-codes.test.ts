import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { createTournamentService } from "@yugidraft/shared/services";

const callDuelHost = vi.fn();
vi.mock("@/lib/duel-host", () => ({ callDuelHost }));

const tempDirs: string[] = [];
const CATALOG = { main: [1001, 1002, 1003], extra: [], side: [] };
const MAPPED = { main: [2001, 2002, 2003], extra: [], side: [] };
const NEWER = { main: [3001, 3002, 3003], extra: [], side: [] };
const NEWER_MAPPED = { main: [5001, 5002, 5003], extra: [], side: [] };

/** A tournament with Alice and Bob; `draft` links a draft; both entries hold the catalog deck. */
function seed(opts: { draft: boolean }) {
  const dir = mkdtempSync(join(tmpdir(), "ddcodes-"));
  tempDirs.push(dir);
  const db = new Database(join(dir, "bot.sqlite"));
  migrate(db);
  const insert = db.prepare("insert into players (guild_id, discord_user_id, display_name) values ('g1', ?, ?)");
  const alice = Number(insert.run("u-a", "Alice").lastInsertRowid);
  const bob = Number(insert.run("u-b", "Bob").lastInsertRowid);
  const tournaments = createTournamentService(db);
  const tour = tournaments.create("g1", "Cup", "round_robin", "u-org");
  if (opts.draft) {
    db.prepare(
      `insert into drafts (guild_id, channel_id, name, status, created_by_user_id, config_json, web_slug, tournament_id)
       values ('g1', 'c', 'Cube', 'completed', 'u-org', '{}', 'cube-1', ?)`,
    ).run(tour.id);
  }
  tournaments.join(tour.id, alice);
  tournaments.join(tour.id, bob);
  db.prepare("update tournaments set status = 'active' where id = ?").run(tour.id);
  db.prepare("update tournament_participants set deck_json = ?, deck_registered_at = '2026-10-03 10:00:00' where tournament_id = ?")
    .run(JSON.stringify(CATALOG), tour.id);
  const deckOf = (playerId: number) =>
    JSON.parse(
      (db.prepare("select deck_json from tournament_participants where tournament_id = ? and player_id = ?").get(tour.id, playerId) as { deck_json: string })
        .deck_json,
    );
  return { db, alice, bob, tournamentId: tour.id, deckOf };
}

describe("mapDraftTournamentDecks", () => {
  beforeEach(() => {
    vi.resetModules();
    callDuelHost.mockReset();
    callDuelHost.mockResolvedValue({ ok: true, data: { deck: MAPPED, report: { issues: [] } } });
  });
  afterEach(() => {
    while (tempDirs.length) {
      const d = tempDirs.pop();
      if (d) rmSync(d, { recursive: true, force: true });
    }
  });

  it("maps the deck of both seats to engine codes", async () => {
    const s = seed({ draft: true });
    const { mapDraftTournamentDecks } = await import("../src/lib/draft-deck-codes");
    const result = await mapDraftTournamentDecks(s.db, { tournamentId: s.tournamentId, guildId: "g1", playerIds: [s.alice, s.bob] });
    expect(result).toEqual({ ok: true });
    expect(callDuelHost).toHaveBeenCalledTimes(2);
    expect(s.deckOf(s.alice)).toEqual(MAPPED);
    expect(s.deckOf(s.bob)).toEqual(MAPPED);
  });

  it("maps missing Barrel Dragon artworks and keeps known engine artwork ids before duel start", async () => {
    const s = seed({ draft: true });
    const dir = mkdtempSync(join(tmpdir(), "ddcodes-engine-"));
    tempDirs.push(dir);
    const cdb = new Database(join(dir, "cards.cdb"));
    cdb.exec(`
      create table datas (id integer primary key, ot integer, alias integer, type integer);
      create table texts (id integer primary key, name text);
      insert into datas values (81480460, 3, 0, 33), (81480462, 3, 81480460, 33);
      insert into texts values (81480460, 'Barrel Dragon'), (81480462, 'Barrel Dragon');
    `);
    cdb.close();
    s.db.prepare("insert into card_catalog (ygoprodeck_id, name, type, frame_type, image_url, image_url_small, card_sets_json, cached_at) values (81480461, 'Barrel Dragon', 'Effect Monster', 'effect', '', '', '[]', current_timestamp)").run();
    const deck = { main: [81480461, 81480462], extra: [], side: [81480461] };
    s.db.prepare("update tournament_participants set deck_json = ? where tournament_id = ? and player_id = ?")
      .run(JSON.stringify(deck), s.tournamentId, s.alice);
    const { normalizeCardCodes, normalizeImportedDeck } = await import("../../duel-server/src/deck-import.js");
    callDuelHost.mockImplementation(async (input: { deck: typeof deck }) => ({
      ok: true, data: { deck: await normalizeImportedDeck(input.deck, dir, s.db), report: { issues: [] } },
    }));
    const { mapDraftTournamentDecks } = await import("../src/lib/draft-deck-codes");
    expect(await mapDraftTournamentDecks(s.db, { tournamentId: s.tournamentId, guildId: "g1", playerIds: [s.alice] })).toEqual({ ok: true });
    expect(s.deckOf(s.alice)).toEqual({ main: [81480460, 81480462], extra: [], side: [81480460] });
    expect(await normalizeCardCodes([81480461, 81480462], dir, s.db)).toEqual(new Map([[81480461, 81480460], [81480462, 81480460]]));
    s.db.close();
  });

  it("does not overwrite a registration made while the host call ran, and maps that one instead", async () => {
    const s = seed({ draft: true });
    let calls = 0;
    callDuelHost.mockImplementation(async (input: { deck: unknown }) => {
      calls++;
      if (calls === 1) {
        s.db.prepare("update tournament_participants set deck_json = ? where tournament_id = ? and player_id = ?")
          .run(JSON.stringify(NEWER), s.tournamentId, s.alice);
      }
      return { ok: true, data: { deck: input.deck === NEWER || JSON.stringify(input.deck) === JSON.stringify(NEWER) ? NEWER_MAPPED : MAPPED, report: { issues: [] } } };
    });
    const { mapDraftTournamentDecks } = await import("../src/lib/draft-deck-codes");
    const result = await mapDraftTournamentDecks(s.db, { tournamentId: s.tournamentId, guildId: "g1", playerIds: [s.alice] });
    expect(result).toEqual({ ok: true });
    expect(calls).toBe(2);
    expect(s.deckOf(s.alice)).toEqual(NEWER_MAPPED);
  });

  it("asks for a retry when the deck keeps changing, and locks nothing", async () => {
    const s = seed({ draft: true });
    let n = 0;
    callDuelHost.mockImplementation(async () => {
      n++;
      s.db.prepare("update tournament_participants set deck_json = ? where tournament_id = ? and player_id = ?")
        .run(JSON.stringify({ main: [4000 + n], extra: [], side: [] }), s.tournamentId, s.alice);
      return { ok: true, data: { deck: MAPPED, report: { issues: [] } } };
    });
    const { mapDraftTournamentDecks } = await import("../src/lib/draft-deck-codes");
    const result = await mapDraftTournamentDecks(s.db, { tournamentId: s.tournamentId, guildId: "g1", playerIds: [s.alice] });
    expect(result).toMatchObject({ ok: false, status: 409 });
  });

  it("does not change a locked entry", async () => {
    const s = seed({ draft: true });
    s.db.prepare("update tournament_participants set deck_locked_at = '2026-10-03 11:00:00' where player_id = ?").run(s.alice);
    const { mapDraftTournamentDecks } = await import("../src/lib/draft-deck-codes");
    const result = await mapDraftTournamentDecks(s.db, { tournamentId: s.tournamentId, guildId: "g1", playerIds: [s.alice] });
    expect(result).toEqual({ ok: true });
    expect(callDuelHost).not.toHaveBeenCalled();
    expect(s.deckOf(s.alice)).toEqual(CATALOG);
  });

  it("leaves a tournament that is not from a draft alone", async () => {
    const s = seed({ draft: false });
    const { mapDraftTournamentDecks } = await import("../src/lib/draft-deck-codes");
    const result = await mapDraftTournamentDecks(s.db, { tournamentId: s.tournamentId, guildId: "g1", playerIds: [s.alice, s.bob] });
    expect(result).toEqual({ ok: true });
    expect(callDuelHost).not.toHaveBeenCalled();
    expect(s.deckOf(s.alice)).toEqual(CATALOG);
  });

  it("says the engine is unavailable when the host is down, or answers with something unusable", async () => {
    const s = seed({ draft: true });
    const { mapDraftTournamentDecks } = await import("../src/lib/draft-deck-codes");
    const input = { tournamentId: s.tournamentId, guildId: "g1", playerIds: [s.alice, s.bob] };
    callDuelHost.mockResolvedValueOnce({ ok: false, response: new Response(null, { status: 503 }) });
    expect(await mapDraftTournamentDecks(s.db, input)).toEqual({ ok: false, status: 503, error: "Duel engine unavailable, try again" });
    callDuelHost.mockResolvedValueOnce({ ok: true, data: {} });
    expect(await mapDraftTournamentDecks(s.db, input)).toMatchObject({ ok: false, status: 503 });
    callDuelHost.mockRejectedValueOnce(new Error("timeout"));
    expect(await mapDraftTournamentDecks(s.db, input)).toMatchObject({ ok: false, status: 503 });
    expect(s.deckOf(s.alice)).toEqual(CATALOG);
    expect(s.deckOf(s.bob)).toEqual(CATALOG);
  });

  it("refuses a deck whose check report has issues, with the report", async () => {
    const s = seed({ draft: true });
    const report = { issues: [{ code: "unknown-card" }] };
    callDuelHost.mockResolvedValue({ ok: true, data: { deck: MAPPED, report } });
    const { mapDraftTournamentDecks } = await import("../src/lib/draft-deck-codes");
    const result = await mapDraftTournamentDecks(s.db, { tournamentId: s.tournamentId, guildId: "g1", playerIds: [s.alice, s.bob] });
    expect(result).toMatchObject({ ok: false, status: 400, report });
    expect(s.deckOf(s.alice)).toEqual(CATALOG);
  });
});
