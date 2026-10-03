import type Database from "better-sqlite3";
import { createDuelSeriesService } from "@yugidraft/shared/services";
import type { Match, Participant } from "@/components/tournament/types";

/** What the round strips and row actions need for one tournament. */
export interface TournamentRounds {
  tournamentId: number;
  format: string;
  status: string;
  webSlug: string | null;
  participants: Participant[];
  /** Every pairing, oldest round first. An open or between-games series is attached to its slot. */
  matches: Match[];
  /** Series in progress (a game running or between games) in this tournament. */
  liveCount: number;
}

type MatchRow = {
  id: number;
  tournament_id: number;
  match_id: number | null;
  player_one_id: number;
  player_two_id: number | null;
  round_number: number;
  status: string;
  metadata_json: string;
  winner_id: number | null;
  reporter_id: number | null;
  resolved_at: string | null;
};

function parseMetadata(json: string): Record<string, unknown> {
  try {
    const value = JSON.parse(json);
    return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Reads the per-round pairings of several tournaments in three batched queries, so a list
 * of tournaments does not run one lookup per row. Same shape as `GET /api/tournaments/[slug]`
 * (participants, matches with names, the open series of each slot), without that route's
 * rules and stakes extras. Only series that are in progress are attached.
 */
export function loadTournamentRounds(
  db: Database.Database,
  guildId: string,
  tournaments: Array<{ id: number; format: string; status: string; webSlug?: string | null }>,
): Map<number, TournamentRounds> {
  const result = new Map<number, TournamentRounds>();
  if (tournaments.length === 0) return result;

  const ids = tournaments.map((t) => t.id);
  const marks = ids.map(() => "?").join(",");

  const participants = db
    .prepare(
      `select tp.tournament_id, p.id as player_id, p.display_name
       from tournament_participants tp
       inner join players p on p.id = tp.player_id
       where tp.tournament_id in (${marks})
       order by tp.joined_at asc, tp.rowid asc`,
    )
    .all(...ids) as Array<{ tournament_id: number; player_id: number; display_name: string }>;

  const rows = db
    .prepare(
      `select tm.id, tm.tournament_id, tm.match_id, tm.player_one_id, tm.player_two_id, tm.round_number,
              tm.status, tm.metadata_json, m.winner_id, m.reporter_id, m.resolved_at
       from tournament_matches tm
       left join matches m on m.id = tm.match_id
       where tm.tournament_id in (${marks})
       order by tm.round_number asc, tm.id asc`,
    )
    .all(...ids) as MatchRow[];

  const names = new Map<number, string>();
  for (const p of participants) names.set(p.player_id, p.display_name);

  const openSeries = rows.length
    ? (db
        .prepare(
          `select id, tournament_match_id from duel_series
           where status in ('active', 'between_games')
             and tournament_match_id in (${rows.map(() => "?").join(",")})
           order by id desc`,
        )
        .all(...rows.map((r) => r.id)) as Array<{ id: number; tournament_match_id: number }>)
    : [];

  const seriesService = createDuelSeriesService(db);
  const seriesBySlot = new Map<number, Match["series"]>();
  for (const row of openSeries) {
    if (seriesBySlot.has(row.tournament_match_id)) continue;
    try {
      seriesBySlot.set(row.tournament_match_id, seriesService.get(row.id, guildId));
    } catch {
      // A series that can't be read just shows no live state.
    }
  }

  for (const t of tournaments) {
    const list = rows.filter((r) => r.tournament_id === t.id);
    const matches: Match[] = list.map((r) => ({
      id: r.id,
      matchId: r.match_id,
      roundNumber: r.round_number,
      playerOneId: r.player_one_id,
      playerTwoId: r.player_two_id,
      playerOneName: names.get(r.player_one_id) ?? "Player",
      playerTwoName: r.player_two_id === null ? null : (names.get(r.player_two_id) ?? "Player"),
      status: r.status,
      winnerId: r.winner_id,
      reporterId: r.reporter_id,
      resolvedAt: r.resolved_at,
      metadata: parseMetadata(r.metadata_json),
      series: seriesBySlot.get(r.id) ?? null,
    }));
    result.set(t.id, {
      tournamentId: t.id,
      format: t.format,
      status: t.status,
      webSlug: t.webSlug ?? null,
      participants: participants
        .filter((p) => p.tournament_id === t.id)
        .map((p) => ({ playerId: p.player_id, displayName: p.display_name })),
      matches,
      liveCount: matches.filter((m) => m.series?.status === "active").length,
    });
  }
  return result;
}
