import type Database from "better-sqlite3";
import { createRemoteDuelService } from "./remote-duels.js";

/** Drain expired rooms hourly; each writer transaction holds at most 100 rooms. */
export function pruneRemoteDuels(db: Database.Database, now = Date.now()): number {
  const raw = process.env.REMOTE_DUELS_RETENTION_DAYS?.trim();
  const days = raw ? Number(raw) : 1;
  if (!Number.isSafeInteger(days) || days < 1 || !Number.isSafeInteger(now - days * 86_400_000)) {
    throw new Error("Invalid REMOTE_DUELS_RETENTION_DAYS");
  }
  const remote = createRemoteDuelService(db);
  remote.pruneSessions(now);
  // One batch/hour only handles 2,400 rooms/day. Drain the backlog with bounded locks.
  let total = 0, batch: number;
  do {
    batch = remote.purgeEnded(now - days * 86_400_000, 100);
    total += batch;
  } while (batch === 100);
  return total;
}
