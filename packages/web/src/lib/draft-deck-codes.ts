import type Database from "better-sqlite3";
import type { DuelDeck, DuelDeckValidation } from "@yugidraft/shared/duels";
import { createTournamentDuelService } from "@yugidraft/shared/services";
import { callDuelHost } from "@/lib/duel-host";

/** What stops a series from starting: the HTTP status, the message, and the check report if any. */
export type DraftDeckMapResult =
  | { ok: true }
  | { ok: false; status: 400 | 409 | 503; error: string; report?: DuelDeckValidation };

/** One attempt per registration change: a newer registration made during the host call is mapped again. */
const MAX_ATTEMPTS = 3;

/**
 * An auto-registered draft deck holds catalog ids. The duel host maps them to engine passcodes
 * (about 1 in 100 differ), and a series locks the decks it copies, so the mapped copy must be on
 * the entry before the series starts. This maps the unlocked registered deck of each given
 * player in a draft tournament and says whether the series may start:
 * - the host is unreachable (or answers with something unusable): 503, nothing is locked;
 * - the check report has issues: 400 with the report;
 * - a locked entry is already mapped and is left alone.
 *
 * The write is one compare-and-swap statement: it changes the deck only when the stored deck is
 * still the one that was mapped and the entry is not locked, so a newer registration made while
 * the host call ran is never overwritten (that deck is mapped on the next attempt). Never throws.
 */
export async function mapDraftTournamentDecks(
  db: Database.Database,
  input: { tournamentId: number; guildId: string; playerIds: number[] },
): Promise<DraftDeckMapResult> {
  const unavailable = { ok: false, status: 503, error: "Duel engine unavailable, try again" } as const;
  try {
    const duels = createTournamentDuelService(db);
    const rules = duels.rules(input.tournamentId);
    if (rules.draftId === null) return { ok: true };
    const select = db.prepare(
      "select deck_json, deck_locked_at from tournament_participants where tournament_id = ? and player_id = ?",
    );
    const update = db.prepare(
      `update tournament_participants set deck_json = ?
       where tournament_id = ? and player_id = ? and deck_json = ? and deck_locked_at is null`,
    );
    for (const playerId of new Set(input.playerIds)) {
      let settled = false;
      for (let attempt = 0; attempt < MAX_ATTEMPTS && !settled; attempt++) {
        const row = select.get(input.tournamentId, playerId) as
          | { deck_json: string | null; deck_locked_at: string | null }
          | undefined;
        // No deck yet is the series start's own 409; a locked deck was mapped when it was locked.
        if (!row?.deck_json || row.deck_locked_at) break;
        const checked = await callDuelHost({
          op: "check-deck",
          guildId: input.guildId,
          playerId,
          deck: JSON.parse(row.deck_json) as DuelDeck,
          mode: rules.mode,
          masterRule: rules.masterRule,
          settings: rules.settings,
        });
        if (!checked.ok) return unavailable;
        const { deck, report } = checked.data as { deck?: DuelDeck; report?: DuelDeckValidation };
        if (!deck || !report || !Array.isArray(report.issues)) return unavailable;
        if (report.issues.length > 0) {
          return { ok: false, status: 400, error: "A deck in this match is not legal for the tournament.", report };
        }
        const mapped = JSON.stringify(deck);
        settled = mapped === row.deck_json || update.run(mapped, input.tournamentId, playerId, row.deck_json).changes > 0;
      }
      if (!settled) {
        const row = select.get(input.tournamentId, playerId) as { deck_json: string | null; deck_locked_at: string | null } | undefined;
        // Still changing after every attempt: ask for a retry rather than lock an unchecked deck.
        if (row?.deck_json && !row.deck_locked_at) {
          return { ok: false, status: 409, error: "A deck changed while the match was starting, try again" };
        }
      }
    }
    return { ok: true };
  } catch (error) {
    console.warn("[draft-deck-codes] could not map the draft deck codes:", error);
    return unavailable;
  }
}
