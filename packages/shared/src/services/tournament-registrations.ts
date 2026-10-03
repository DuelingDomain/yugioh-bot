import type Database from "better-sqlite3";

/** A deck a player has registered for a tournament that has not finished. */
export interface DeckRegistration {
  /** The saved deck that was registered; null when the tournament holds a copy with no saved deck. */
  savedDeckId: number | null;
  /** Set when the tournament was made from a draft (drafts.tournament_id): the draft whose deck is registered. */
  draftId: number | null;
  tournament: DeckRegistrationTournament;
  registeredAt: string | null;
  /** Set when the player's first tournament game started; the registered copy cannot change after that. */
  lockedAt: string | null;
}

export interface DeckRegistrationTournament {
  id: number;
  /** Null for a tournament that has no web page. */
  slug: string | null;
  name: string;
  status: string;
}

/** What a deck list or editor shows next to a deck: "Deck in for <tournament>" and the lock mark. */
export interface DeckRegistrationMark {
  tournament: DeckRegistrationTournament;
  locked: boolean;
}

export interface TournamentRegistrationService {
  /**
   * The player's registered decks for pending and active tournaments, newest registration first.
   * Finished and cancelled tournaments are left out.
   */
  deckRegistrations(playerId: number, guildId: string): DeckRegistration[];
}

type Row = {
  saved_deck_id: number | null;
  deck_registered_at: string | null;
  deck_locked_at: string | null;
  tournament_id: number;
  web_slug: string | null;
  name: string;
  status: string;
  draft_id: number | null;
};

export function createTournamentRegistrationService(db: Database.Database): TournamentRegistrationService {
  const select = db.prepare<[number, string], Row>(`
    select tp.saved_deck_id, tp.deck_registered_at, tp.deck_locked_at,
      t.id as tournament_id, t.web_slug, t.name, t.status,
      (select d.id from drafts d where d.tournament_id = t.id order by d.id limit 1) as draft_id
    from tournament_participants tp
    inner join tournaments t on t.id = tp.tournament_id
    where tp.player_id = ?
      and t.guild_id = ?
      and t.status in ('pending', 'active')
      and tp.deck_json is not null
    order by datetime(tp.deck_registered_at) desc, t.id desc
  `);
  return {
    deckRegistrations(playerId, guildId) {
      return select.all(playerId, guildId).map((row) => ({
        savedDeckId: row.saved_deck_id,
        draftId: row.draft_id,
        tournament: { id: row.tournament_id, slug: row.web_slug, name: row.name, status: row.status },
        registeredAt: row.deck_registered_at,
        lockedAt: row.deck_locked_at,
      }));
    },
  };
}

/**
 * Picks the registration to show for one deck: a locked one first (it matters
 * most), then an active tournament, then the newest. Null when the deck is in no tournament.
 */
export function deckRegistrationMark(
  registrations: readonly DeckRegistration[],
  match: { savedDeckId?: number | null; draftId?: number | null },
): DeckRegistrationMark | null {
  const rank = (entry: DeckRegistration) => (entry.lockedAt ? 0 : entry.tournament.status === "active" ? 1 : 2);
  const found = registrations
    .filter(
      (entry) =>
        (match.savedDeckId != null && entry.savedDeckId === match.savedDeckId) ||
        (match.draftId != null && entry.draftId === match.draftId),
    )
    .sort((a, b) => rank(a) - rank(b))[0];
  return found ? { tournament: found.tournament, locked: found.lockedAt !== null } : null;
}
