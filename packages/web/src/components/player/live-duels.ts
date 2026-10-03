import type Database from "better-sqlite3";
import { createDuelService } from "@yugidraft/shared/services";

/**
 * Player id to the slug of the duel they are playing right now, for the live dot and the
 * Watch or Open duel link. Uses the duel service's list read (games the viewer may open), so
 * private duels never show. Returns an empty map for a viewer with no player record, or if
 * the read fails: a missing dot is better than a broken page.
 */
export function liveDuelSlugs(db: Database.Database, guildId: string, viewerPlayerId: number | null): Record<number, string> {
  const live: Record<number, string> = {};
  if (viewerPlayerId === null) return live;
  try {
    for (const duel of createDuelService(db).list(guildId, viewerPlayerId)) {
      if (duel.status !== "active") continue;
      for (const seat of duel.seats) {
        if (seat.playerId != null) live[seat.playerId] ??= duel.slug;
      }
    }
  } catch {
    // No live state then.
  }
  return live;
}
