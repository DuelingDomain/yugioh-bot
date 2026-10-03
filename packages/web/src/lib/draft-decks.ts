import type Database from "better-sqlite3";
import type { DuelDeck } from "@yugidraft/shared/duels";
import * as services from "@yugidraft/shared/services";
import { getDb } from "@/lib/db";

/** The size note for a draft deck (shared `draftDeckNote`'s result). */
export interface DraftDeckNoteView {
  /** `optional`: the deck plays as it is. `required`: the duel start would refuse it. */
  level: "optional" | "required";
  mainCount: number;
  message: string;
}

// The shared draft-deck service. It is read off the namespace and typed by hand so a web build
// that still sees an older shared build degrades to "no auto decks" instead of failing to load.
type DraftDeckApi = {
  ensureForUser(guildId: string, discordUserId: string): number[];
  linkTournament(tournamentId: number, onlyPlayerId?: number): number[];
  mainPoolCount(draftId: number, playerId: number): number;
};
type DraftDeckModule = {
  createDraftDeckService?: (db: Database.Database) => DraftDeckApi;
  draftDeckNote?: (deck: DuelDeck, mainPoolCount: number) => DraftDeckNoteView | null;
};

function api(db: Database.Database): DraftDeckApi | null {
  const make = (services as unknown as DraftDeckModule).createDraftDeckService;
  return make ? make(db) : null;
}

/**
 * Saves any draft deck the user is missing for a finished draft (drafts that ended before the
 * automatic save, or a save that failed). Never throws: a read route must not fail over this.
 */
export function backfillDraftDecks(guildId: string, discordUserId: string, db: Database.Database = getDb()): void {
  try {
    api(db)?.ensureForUser(guildId, discordUserId);
  } catch (error) {
    console.error("[draft-decks] backfill failed:", error);
  }
}

/** Registers the player's draft deck on their entry in a draft tournament, if the entry has none. */
export function linkDraftDeck(tournamentId: number, playerId: number, db: Database.Database = getDb()): void {
  try {
    api(db)?.linkTournament(tournamentId, playerId);
  } catch (error) {
    console.error("[draft-decks] link failed:", error);
  }
}

/** The size note for the deck in play, or null when the deck needs no note. */
export function draftDeckNoteFor(
  db: Database.Database,
  input: { draftId: number; playerId: number; deck: DuelDeck },
): DraftDeckNoteView | null {
  try {
    const note = (services as unknown as DraftDeckModule).draftDeckNote;
    const service = api(db);
    if (!note || !service) return null;
    return note(input.deck, service.mainPoolCount(input.draftId, input.playerId));
  } catch (error) {
    console.error("[draft-decks] note failed:", error);
    return null;
  }
}
