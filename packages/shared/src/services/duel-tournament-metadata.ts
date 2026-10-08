import type Database from "better-sqlite3";
import { findTournamentReadAccess } from "./tournament-access.js";

/** Presentation only: duel admission and internal series state keep their existing rules. */
export function redactDuelTournamentMetadata<T>(
  database: () => Database.Database,
  payload: T,
  guildId: string,
  playerId: number,
): T {
  const readable = new Map<number, boolean>();
  const linked = new Map<number, number | null>();
  let userId: number | null | undefined;
  const canRead = (tournamentId: number): boolean => {
    if (!readable.has(tournamentId)) {
      const db = database();
      userId ??= (db.prepare("select user_id from players where id = ? and guild_id = ?")
        .get(playerId, guildId) as { user_id: number } | undefined)?.user_id ?? null;
      readable.set(tournamentId, userId !== null && Boolean(findTournamentReadAccess(db, tournamentId, guildId, userId)?.canRead));
    }
    return readable.get(tournamentId)!;
  };
  const tournamentForSeries = (seriesId: number): number | null => {
    if (!linked.has(seriesId)) {
      const row = database().prepare(`
        select tm.tournament_id from duel_series s
        join tournament_matches tm on tm.id = s.tournament_match_id
        where s.id = ? and s.guild_id = ?
      `).get(seriesId, guildId) as { tournament_id: number } | undefined;
      linked.set(seriesId, row?.tournament_id ?? null);
    }
    return linked.get(seriesId)!;
  };
  const visit = (value: unknown): unknown => {
    if (!value || typeof value !== "object") return value;
    if (Array.isArray(value)) {
      const next = value.map(visit);
      return next.some((entry, index) => entry !== value[index]) ? next : value;
    }
    const record = value as Record<string, unknown>;
    const tournamentId = typeof record.tournamentId === "number" ? record.tournamentId
      : typeof record.seriesId === "number" ? tournamentForSeries(record.seriesId) : null;
    const hidden = tournamentId !== null && !canRead(tournamentId);
    const next: Record<string, unknown> = {};
    let changed = false;
    for (const [key, entry] of Object.entries(record)) {
      const result = hidden && key === "name" && typeof record.seriesId === "number" ? "Duel"
        : hidden && ["tournamentId", "tournamentSlug", "tournamentMatchId", "tournamentName"].includes(key) ? null
        : visit(entry);
      next[key] = result;
      changed ||= result !== entry;
    }
    return changed ? next : value;
  };
  return visit(payload) as T;
}
