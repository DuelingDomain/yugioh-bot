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
    await mapDraftTournamentDecks(s.db, { tournamentId: s.tournamentId, guildId: "g1", playerIds: [s.alice, s.bob] });
    expect(callDuelHost).toHaveBeenCalledTimes(2);
    expect(s.deckOf(s.alice)).toEqual(MAPPED);
    expect(s.deckOf(s.bob)).toEqual(MAPPED);
  });

  it("does not overwrite a registration made while the host call ran", async () => {
    const s = seed({ draft: true });
    callDuelHost.mockImplementation(async () => {
      s.db.prepare("update tournament_participants set deck_json = ? where tournament_id = ? and player_id = ?")
        .run(JSON.stringify(NEWER), s.tournamentId, s.alice);
      return { ok: true, data: { deck: MAPPED, report: { issues: [] } } };
    });
    const { mapDraftTournamentDecks } = await import("../src/lib/draft-deck-codes");
    await mapDraftTournamentDecks(s.db, { tournamentId: s.tournamentId, guildId: "g1", playerIds: [s.alice] });
    expect(s.deckOf(s.alice)).toEqual(NEWER);
  });

  it("does not change a locked entry", async () => {
    const s = seed({ draft: true });
    s.db.prepare("update tournament_participants set deck_locked_at = '2026-10-03 11:00:00' where player_id = ?").run(s.alice);
    const { mapDraftTournamentDecks } = await import("../src/lib/draft-deck-codes");
    await mapDraftTournamentDecks(s.db, { tournamentId: s.tournamentId, guildId: "g1", playerIds: [s.alice] });
    expect(callDuelHost).not.toHaveBeenCalled();
    expect(s.deckOf(s.alice)).toEqual(CATALOG);
  });

  it("leaves a tournament that is not from a draft alone", async () => {
    const s = seed({ draft: false });
    const { mapDraftTournamentDecks } = await import("../src/lib/draft-deck-codes");
    await mapDraftTournamentDecks(s.db, { tournamentId: s.tournamentId, guildId: "g1", playerIds: [s.alice, s.bob] });
    expect(callDuelHost).not.toHaveBeenCalled();
    expect(s.deckOf(s.alice)).toEqual(CATALOG);
  });

  it("keeps the deck when the host is down or the deck has issues, and does not throw", async () => {
    const s = seed({ draft: true });
    callDuelHost.mockResolvedValueOnce({ ok: false, response: new Response(null, { status: 503 }) });
    callDuelHost.mockResolvedValueOnce({ ok: true, data: { deck: MAPPED, report: { issues: [{ code: "x" }] } } });
    const { mapDraftTournamentDecks } = await import("../src/lib/draft-deck-codes");
    await expect(
      mapDraftTournamentDecks(s.db, { tournamentId: s.tournamentId, guildId: "g1", playerIds: [s.alice, s.bob] }),
    ).resolves.toBeUndefined();
    expect(s.deckOf(s.alice)).toEqual(CATALOG);
    expect(s.deckOf(s.bob)).toEqual(CATALOG);
  });
});
