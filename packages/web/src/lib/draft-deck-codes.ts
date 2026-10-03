import type Database from "better-sqlite3";
import type { DuelDeck, DuelDeckValidation } from "@yugidraft/shared/duels";
import { createTournamentDuelService } from "@yugidraft/shared/services";
import { callDuelHost } from "@/lib/duel-host";

/**
 * An auto-registered draft deck holds catalog ids. The duel host maps them to engine passcodes
 * (about 1 in 100 differ), so the mapped copy must be on the entry before the series starts.
 * This maps the unlocked registered deck of each given player in a draft tournament.
 *
 * The write is one compare-and-swap statement: it changes the deck only when the stored deck is
 * still the one that was mapped and the entry is not locked, so a newer registration made while
 * the host call ran is never overwritten. A host that is down or a deck with issues is left
 * alone (the duel start reports the problem). Never throws.
 */
export async function mapDraftTournamentDecks(
  db: Database.Database,
  input: { tournamentId: number; guildId: string; playerIds: number[] },
): Promise<void> {
  try {
    const duels = createTournamentDuelService(db);
    const rules = duels.rules(input.tournamentId);
    if (rules.draftId === null) return;
    const update = db.prepare(
      `update tournament_participants set deck_json = ?
       where tournament_id = ? and player_id = ? and deck_json = ? and deck_locked_at is null`,
    );
    for (const playerId of new Set(input.playerIds)) {
      const row = db
        .prepare("select deck_json, deck_locked_at from tournament_participants where tournament_id = ? and player_id = ?")
        .get(input.tournamentId, playerId) as { deck_json: string | null; deck_locked_at: string | null } | undefined;
      if (!row?.deck_json || row.deck_locked_at) continue;
      try {
        const checked = await callDuelHost({
          op: "check-deck",
          guildId: input.guildId,
          playerId,
          deck: JSON.parse(row.deck_json) as DuelDeck,
          mode: rules.mode,
          masterRule: rules.masterRule,
          settings: rules.settings,
        });
        if (!checked.ok) continue;
        const { deck, report } = checked.data as { deck?: DuelDeck; report?: DuelDeckValidation };
        if (!deck || !report || !Array.isArray(report.issues) || report.issues.length > 0) continue;
        const mapped = JSON.stringify(deck);
        if (mapped === row.deck_json) continue;
        update.run(mapped, input.tournamentId, playerId, row.deck_json);
      } catch (error) {
        console.warn("[draft-deck-codes] could not map the draft deck codes:", error);
      }
    }
  } catch (error) {
    console.warn("[draft-deck-codes] could not map the draft deck codes:", error);
  }
}
