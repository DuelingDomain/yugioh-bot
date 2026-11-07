import type Database from "better-sqlite3";
import type { RemotePair } from "@/components/tournament/remote-result";

/** What the Remote room needs to show a tournament match's result panel to a paired player. */
export interface RemoteTournamentLink {
  tournamentSlug: string;
  tournamentName: string;
  tournamentMatchId: number;
  /** The viewer's player id; always one of the pair. */
  viewerPlayerId: number;
  pair: RemotePair;
}

/**
 * Matched by the site account (`players.user_id`), so an email-only player is found too.
 * The tournament match behind a Remote table, for a viewer who is one of its two paired players. Anyone
 * else (spectators, the organizer when not paired, other guilds) gets null and sees the plain room.
 */
export function findRemoteTournamentLink(db: Database.Database, guildId: string, userId: number, tableSlug: string): RemoteTournamentLink | null {
  const row = db.prepare(
    `select t.web_slug, t.name as tournament_name, trm.tournament_match_id, trm.player_one_id, trm.player_two_id,
            p1.display_name as one_name, p2.display_name as two_name,
            p1.user_id as one_user, p2.user_id as two_user
     from tournament_remote_matches trm
     join tournament_matches tm on tm.id = trm.tournament_match_id
     join tournaments t on t.id = tm.tournament_id
     join players p1 on p1.id = trm.player_one_id
     join players p2 on p2.id = trm.player_two_id
     where trm.table_slug = ? and t.guild_id = ? and t.web_slug is not null`,
  ).get(tableSlug, guildId) as
    | { web_slug: string; tournament_name: string; tournament_match_id: number; player_one_id: number; player_two_id: number; one_name: string; two_name: string; one_user: number; two_user: number }
    | undefined;
  if (!row) return null;
  const viewerPlayerId = row.one_user === userId ? row.player_one_id : row.two_user === userId ? row.player_two_id : null;
  if (viewerPlayerId === null) return null;
  return {
    tournamentSlug: row.web_slug,
    tournamentName: row.tournament_name,
    tournamentMatchId: row.tournament_match_id,
    viewerPlayerId,
    pair: { playerOneId: row.player_one_id, playerOneName: row.one_name, playerTwoId: row.player_two_id, playerTwoName: row.two_name },
  };
}
