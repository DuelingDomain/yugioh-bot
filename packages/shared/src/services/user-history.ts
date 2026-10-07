import type Database from "better-sqlite3";

export type HistoryCounts = Record<string, number>;

const ownershipReferences: Record<string, readonly string[]> = {
  tournaments: ["created_by_user_id"], cubes: ["created_by_user_id"], drafts: ["created_by_user_id"],
  seasons: ["created_by_user_id"], saved_decks: ["owner_user_id"],
};
const playerReferences: Record<string, readonly string[]> = {
  tournament_participants: ["player_id"], draft_player_cube: ["player_id"], draft_players: ["player_id"],
  matches: ["player_one_id", "player_two_id", "winner_id", "reporter_id", "approver_id"],
  tournament_matches: ["player_one_id", "player_two_id"],
  player_ratings: ["player_id"], point_awards: ["player_id"], season_standings: ["player_id"], player_achievements: ["player_id"],
  duels: ["organizer_player_id", "winner_player_id"], duel_seats: ["player_id"], duel_invite_grants: ["player_id"],
  duel_series: ["player0_id", "player1_id", "winner_player_id", "created_by_player_id"], bug_reports: ["player_id"],
  draft_cards: ["picked_by_player_id"], draft_picks: ["player_id"], draft_passes: ["player_id"],
};

export function userHistory(db: Database.Database, userId: number): HistoryCounts {
  const counts: HistoryCounts = {};
  for (const [references, predicate] of [
    [ownershipReferences, "= ?"],
    [playerReferences, "in (select id from players where user_id = ?)"],
  ] as const) {
    for (const [table, columns] of Object.entries(references)) {
      const info = db.prepare(`pragma table_info("${table}")`).all() as { name: string }[];
      if (info.length === 0) throw new Error(`Missing history table: ${table}`);
      const present = new Set(info.map(column => column.name));
      for (const column of columns) {
        if (!present.has(column)) continue;
        const { count } = db.prepare<[number], { count: number }>(`select count(*) as count from "${table}" where "${column}" ${predicate}`).get(userId)!;
        if (count > 0) counts[`${table}.${column}`] = count;
      }
    }
  }
  return counts;
}

export function hasHistory(db: Database.Database, userId: number): boolean {
  return Object.keys(userHistory(db, userId)).length > 0;
}
