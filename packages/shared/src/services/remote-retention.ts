import type Database from "better-sqlite3";
import { createRemoteDuelService } from "./remote-duels.js";
import { pruneRemoteTournamentEvidence } from "./tournament-remote-evidence.js";

/** Keep started duels indefinitely unless capped; drain abandoned lobbies after a day. */
export function pruneRemoteDuels(db: Database.Database, now = Date.now()): number {
  // Evidence deadlines are independent of room retention configuration and replay.
  pruneRemoteTournamentEvidence(db, now);
  const raw = process.env.REMOTE_DUELS_RETENTION_DAYS?.trim();
  const days = raw ? Number(raw) : 0;
  if (!Number.isSafeInteger(days) || days < 0 || !Number.isSafeInteger(now - (days || 1) * 86_400_000)) {
    throw new Error("Invalid REMOTE_DUELS_RETENTION_DAYS");
  }
  const remote = createRemoteDuelService(db);
  remote.pruneSessions(now);
  // One batch/hour only handles 2,400 rooms/day. Drain the backlog with bounded locks.
  let total = 0, batch: number;
  do {
    batch = remote.purgeEnded(now - (days || 1) * 86_400_000, 100, now, days === 0);
    total += batch;
  } while (batch === 100);
  return total;
}
