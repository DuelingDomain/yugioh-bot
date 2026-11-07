import type Database from "better-sqlite3";
import { createRemoteDuelService } from "@yugidraft/shared/services";

/** One bounded batch per hourly cleanup. Replay lives for the same retention window. */
export function pruneRemoteDuels(db: Database.Database, now = Date.now()): number {
  const raw = process.env.REMOTE_DUELS_RETENTION_DAYS?.trim();
  const days = raw ? Number(raw) : 30;
  if (!Number.isSafeInteger(days) || days < 0 || !Number.isSafeInteger(now - days * 86_400_000)) {
    throw new Error("Invalid REMOTE_DUELS_RETENTION_DAYS");
  }
  // Zero is an explicit indefinite replay/room retention rule.
  if (days === 0) return 0;
  return createRemoteDuelService(db).purgeEnded(now - days * 86_400_000, 100);
}
