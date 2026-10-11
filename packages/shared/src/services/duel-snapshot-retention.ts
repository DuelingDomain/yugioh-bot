import type Database from "better-sqlite3";
import { seatCountFor, isDuelFormat } from "../duels/settings.js";
import { compressStoredSnapshot, readStoredSeatBoards, storedTurnCount, STORED_BOARD_COLUMNS, type StoredDuelBoards, type StoredSnapshot } from "./stored-duel-snapshots.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_BATCH_ROWS = 50;
const MAX_BATCH_BYTES = 4 * 1024 * 1024;
const MAX_SWEEP_BATCHES = 20;
const enabled = () => !["0", "false"].includes((process.env.DUEL_SNAPSHOT_RETENTION_ENABLED ?? "").trim().toLowerCase());
function integerEnv(name: string, fallback: number, minimum: number): number {
  const raw = process.env[name];
  if (!raw?.trim()) return fallback;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= minimum ? value : fallback;
}
export function duelSnapshotRetentionConfig() {
  return { enabled: enabled(), days: integerEnv("DUEL_SNAPSHOT_RETENTION_DAYS", 30, 0),
    intervalMs: Math.min(2_147_483_647, integerEnv("DUEL_SNAPSHOT_RETENTION_INTERVAL_MS", 6 * 60 * 60 * 1000, 60_000)) };
}
interface RetentionRow extends StoredDuelBoards {
  id: number; format: string; status: string; kind: string; ended_at: string; clock_json: string | null;
}
export interface DuelSnapshotRetentionOptions {
  now?: number;
  batchSize?: number;
  maxBatches?: number;
  stopped?: () => boolean;
  /** Yield between rows and transactions; callers can also coordinate shutdown here. */
  pause?: (milliseconds: number) => Promise<void>;
}

/** Maintenance never queues behind a live writer. The override is synchronous and always restored. */
function withoutBusyWait<T>(db: Database.Database, write: () => T): T {
  const timeout = Number(db.pragma("busy_timeout", { simple: true }));
  try { db.pragma("busy_timeout=0"); return write(); }
  finally { db.pragma(`busy_timeout=${timeout}`); }
}
const isBusy = (error: unknown) => typeof error === "object" && error !== null && "code" in error
  && /^(SQLITE_BUSY|SQLITE_LOCKED)/.test(String(error.code));

/** Bounded, resumable sweep. The host owns scheduling and prevents overlapping sweeps. */
export async function runDuelSnapshotRetention(db: Database.Database, options: DuelSnapshotRetentionOptions = {}) {
  const stats = { compacted: 0, deletedForks: 0, busy: false };
  const stop = () => !enabled() || options.stopped?.() === true;
  if (stop()) return stats;
  const config = duelSnapshotRetentionConfig();
  const time = options.now ?? Date.now();
  const cutoff = new Date(time - config.days * DAY_MS).toISOString();
  const forkCutoff = new Date(time - 7 * DAY_MS).toISOString();
  const stamp = new Date(time).toISOString();
  const size = Math.min(MAX_BATCH_ROWS, Math.max(1, Math.floor(options.batchSize ?? MAX_BATCH_ROWS)));
  const batches = Math.min(MAX_SWEEP_BATCHES, Math.max(1, Math.floor(options.maxBatches ?? MAX_SWEEP_BATCHES)));
  const pause = options.pause ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const forkGuard = "kind='replay-fork' and status='cancelled' and series_id is null and julianday(ended_at) < julianday(?)";
  try {
    // Each fork is a separate transaction. All child FKs have duel-leading indexes.
    // Keep the final DELETE guarded: a creator can restart after the selection.
    if (Number(db.pragma("foreign_keys", { simple: true })) === 1) {
      const forks = db.prepare<[string, number], { id: number }>(`select id from duels where ${forkGuard} order by julianday(ended_at),id limit ?`)
        .all(forkCutoff, size);
      const remove = db.prepare<[number, string]>(`delete from duels where id=? and ${forkGuard}`);
      for (const fork of forks) {
        await pause(0);
        if (stop()) return stats;
        stats.deletedForks += withoutBusyWait(db, () => db.transaction(() => remove.run(fork.id, forkCutoff).changes).immediate());
        await pause(100);
      }
    }
    const select = db.prepare<[string, number], RetentionRow>(`select id,format,status,kind,ended_at,clock_json,${STORED_BOARD_COLUMNS}
      from duels where snapshot_compacted_at is null and status in ('completed','interrupted','cancelled')
      and julianday(ended_at) < julianday(?) order by julianday(ended_at),id limit ?`);
    const update = db.prepare(`update duels set snapshot_public_json=?,snapshot_seat0_json=?,snapshot_seat1_json=?,snapshot_seats_json=?,
      turn_count=coalesce(turn_count,?),snapshot_compacted_at=? where id=? and snapshot_compacted_at is null
      and status=? and ended_at=? and kind=? and format=? and snapshot_public_json is ? and snapshot_seat0_json is ?
      and snapshot_seat1_json is ? and snapshot_seats_json is ? and clock_json is ?`);
    for (let batch = 0; batch < batches && !stop(); batch++) {
      const rows = select.all(cutoff, size);
      if (!rows.length) break;
      const prepared: Array<{ row: RetentionRow; values: StoredSnapshot[]; turn: number | null }> = [];
      let bytes = 0;
      for (const row of rows) {
        const originals = [row.snapshot_public_json, row.snapshot_seat0_json, row.snapshot_seat1_json, row.snapshot_seats_json];
        const rowBytes = originals.reduce((sum, raw) => sum + (typeof raw === "string" ? Buffer.byteLength(raw) : raw?.length ?? 0), 0);
        if (prepared.length && bytes + rowBytes > MAX_BATCH_BYTES) break;
        if (stop()) return stats;
        const seats = readStoredSeatBoards(row.snapshot_seats_json);
        const count = isDuelFormat(row.format) ? seatCountFor(row.format) : 0;
        // Only a complete valid list supersedes the legacy copies. A malformed list preserves them.
        const complete = count > 2 && seats.length === count && seats.every(view => view !== null
          && Array.from({ length: count }, (_, seat) => seat).every(seat => view.seats.some(candidate => candidate.seat === seat)));
        const values = await Promise.all(originals.map((raw, index) => complete && (index === 1 || index === 2)
          ? Promise.resolve(null) : compressStoredSnapshot(raw ?? null)));
        prepared.push({ row, values, turn: storedTurnCount(row) });
        bytes += rowBytes;
        await pause(0);
      }
      if (stop()) return stats;
      stats.compacted += withoutBusyWait(db, () => db.transaction(() => {
        let changed = 0;
        for (const { row, values, turn } of prepared) changed += update.run(...values, turn, stamp, row.id, row.status, row.ended_at,
          row.kind, row.format, row.snapshot_public_json ?? null, row.snapshot_seat0_json ?? null,
          row.snapshot_seat1_json ?? null, row.snapshot_seats_json ?? null, row.clock_json).changes;
        return changed;
      }).immediate());
      await pause(100);
    }
  } catch (error) {
    if (!isBusy(error)) throw error;
    stats.busy = true;
  }
  return stats;
}
