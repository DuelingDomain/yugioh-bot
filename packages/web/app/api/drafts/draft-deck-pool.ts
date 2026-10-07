import { NextResponse } from "next/server";
import type Database from "better-sqlite3";
import { loadDraftPool } from "@/lib/tournament-deck";

/** A draft the caller played in and can build a deck from. */
export type DraftDeckContext = {
  id: number;
  name: string;
  status: string;
  tournamentId: number | null;
  playerId: number;
};

/** The caller's draft pool as engine passcodes. */
export type DraftDeckPool = {
  cards: Array<{ code: number; count: number }>;
  /** Copies of each passcode; the input to checkDeckAgainstPool. */
  byCode: Map<number, number>;
  forcedCopies: Map<number, number>;
  codeMap: Map<number, number | null>;
  /** Pool cards that go in the Main Deck (not Fusion, Synchro, Xyz or Link, Pendulum variants included). */
  mainPoolCount: number;
  /** YGOPRODeck ids the duel engine does not know; they are not in `cards`. */
  unresolved: number[];
};

/**
 * Finds a completed draft (by web slug or id) and the caller's player in it.
 * 404 unknown draft, 403 caller is not a draft player, 409 draft not completed.
 */
export function findDraftDeckContext(
  db: Database.Database,
  guildId: string,
  userId: number,
  ref: { slug: string } | { id: number },
): { ok: true; draft: DraftDeckContext } | { ok: false; response: NextResponse } {
  const row = ("slug" in ref
    ? db
        .prepare("select id, name, status, tournament_id from drafts where web_slug = ? and guild_id = ?")
        .get(ref.slug, guildId)
    : db
        .prepare("select id, name, status, tournament_id from drafts where id = ? and guild_id = ?")
        .get(ref.id, guildId)) as
    | { id: number; name: string; status: string; tournament_id: number | null }
    | undefined;
  if (!row) {
    return { ok: false, response: NextResponse.json({ error: "Draft not found" }, { status: 404 }) };
  }
  const player = db
    .prepare(
      "select p.id as player_id from draft_players dp inner join players p on p.id = dp.player_id where dp.draft_id = ? and p.user_id = ?",
    )
    .get(row.id, userId) as { player_id: number } | undefined;
  if (!player) {
    return { ok: false, response: NextResponse.json({ error: "Not a participant" }, { status: 403 }) };
  }
  if (row.status !== "completed") {
    return {
      ok: false,
      response: NextResponse.json({ error: "The draft is not finished yet" }, { status: 409 }),
    };
  }
  return {
    ok: true,
    draft: {
      id: row.id,
      name: row.name,
      status: row.status,
      tournamentId: row.tournament_id,
      playerId: player.player_id,
    },
  };
}

/**
 * The caller's picks as engine passcodes. Pool ids are YGOPRODeck ids, so the
 * duel host maps them; an id it cannot map is dropped and listed in `unresolved`.
 * The loader is shared with the tournament deck route (`loadDraftPool`), so both
 * split Main and Extra the same way and chunk the host calls.
 */
export async function loadDraftDeckPool(
  db: Database.Database,
  guildId: string,
  draft: DraftDeckContext,
  deckCodes: number[] = [],
): Promise<{ ok: true; pool: DraftDeckPool } | { ok: false; response: NextResponse }> {
  const loaded = await loadDraftPool({ db, guildId, playerId: draft.playerId, draftId: draft.id, deckCodes });
  if (!loaded.ok) return loaded;
  const cards = [...loaded.counts].map(([code, count]) => ({ code, count })).sort((a, b) => a.code - b.code);
  return {
    ok: true,
    pool: { cards, byCode: loaded.counts, forcedCopies: loaded.forcedCopies, codeMap: loaded.codeMap, mainPoolCount: loaded.mainPoolCount, unresolved: loaded.unresolved },
  };
}

export { draftMainMinimum } from "@/components/decks/pool-model";
