import type Database from "better-sqlite3";
import { seatCountFor, isDuelFormat } from "../duels/settings.js";
import { compressStoredSnapshot, readStoredSeatBoards, storedTurnCount, STORED_BOARD_COLUMNS, type StoredDuelBoards, type StoredSnapshot } from "./stored-duel-snapshots.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_BATCH_ROWS = 50;
const MAX_BATCH_BYTES = 4 * 1024 * 1024;
const MAX_SWEEP_BATCHES = 20;
const enabled = () => ["1", "true"].includes((process.env.DUEL_SNAPSHOT_RETENTION_ENABLED ?? "0").trim().toLowerCase());
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
type Phase = "turn-backfill" | "fork-delete" | "compaction";
export interface DuelSnapshotRetentionOptions {
  now?: number;
  batchSize?: number;
  maxBatches?: number;
  stopped?: () => boolean;
  /** Include the creator queue used by launch retries, as well as slug operations. */
  isForkBusy?: (slug: string, guildId: string, creatorPlayerId: number) => boolean;
  onError?: (phase: Phase, error: unknown) => void;
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
const terminalGuard = "status in ('completed','interrupted','cancelled')";
const originalsOf = (row: RetentionRow): StoredSnapshot[] => [row.snapshot_public_json ?? null, row.snapshot_seat0_json ?? null,
  row.snapshot_seat1_json ?? null, row.snapshot_seats_json ?? null];
const bytesOf = (row: RetentionRow) => originalsOf(row).reduce<number>((sum, raw) =>
  sum + (typeof raw === "string" ? Buffer.byteLength(raw) : raw?.length ?? 0), 0);

/** Bounded, resumable sweep. Turn-only backfill runs even while compression is disabled. */
export async function runDuelSnapshotRetention(db: Database.Database, options: DuelSnapshotRetentionOptions = {}) {
  const stats = { backfilled: 0, compacted: 0, deletedForks: 0, busy: false, backlogDone: false };
  const stopped = () => options.stopped?.() === true;
  const stopRetention = () => stopped() || !enabled();
  if (stopped()) return stats;
  const config = duelSnapshotRetentionConfig();
  const time = options.now ?? Date.now();
  const cutoff = new Date(time - config.days * DAY_MS).toISOString();
  const forkCutoff = new Date(time - 7 * DAY_MS).toISOString();
  const stamp = new Date(time).toISOString();
  const size = Math.min(MAX_BATCH_ROWS, Math.max(1, Math.floor(options.batchSize ?? MAX_BATCH_ROWS)));
  const batches = Math.min(MAX_SWEEP_BATCHES, Math.max(1, Math.floor(options.maxBatches ?? MAX_SWEEP_BATCHES)));
  const pause = options.pause ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const report = (phase: Phase, error: unknown) => {
    if (isBusy(error)) stats.busy = true;
    else if (options.onError) options.onError(phase, error);
    else console.warn("[duel] storage maintenance error", { phase, code: (error as { code?: string })?.code ?? "unknown" });
  };
  const fetch = db.prepare<[number], RetentionRow>(`select id,format,status,kind,ended_at,clock_json,${STORED_BOARD_COLUMNS} from duels where id=?`);

  // An in-pass ID cursor advances even if a row has no readable turn. No age or
  // compaction guard: deployment must preserve recent history and repaired old rows.
  try {
    const select = db.prepare<[number, number], { id: number }>(`select id from duels where turn_count is null and ${terminalGuard} and id>? order by id limit ?`);
    const update = db.prepare(`update duels set turn_count=? where id=? and turn_count is null and status=?
      and ended_at is ? and clock_json is ? and snapshot_public_json is ? and snapshot_seat0_json is ? and snapshot_seat1_json is ? and snapshot_seats_json is ?`);
    let cursor = 0;
    for (let batch = 0; batch < batches && !stopped(); batch++) {
      const ids = select.all(cursor, size);
      if (!ids.length) break;
      let bytes = 0;
      for (const { id } of ids) {
        if (stopped() || bytes >= MAX_BATCH_BYTES) break;
        const row = fetch.get(id);
        if (!row) { cursor = id; continue; }
        const rowBytes = bytesOf(row);
        if (bytes && bytes + rowBytes > MAX_BATCH_BYTES) break;
        cursor = id; bytes += rowBytes;
        try {
          const turn = storedTurnCount(row);
          await pause(0);
          if (stopped()) return stats;
          if (turn !== null) stats.backfilled += withoutBusyWait(db, () => db.transaction(() =>
            update.run(turn, row.id, row.status, row.ended_at, row.clock_json, ...originalsOf(row)).changes).immediate());
        } catch (error) { report("turn-backfill", error); if (isBusy(error)) break; }
      }
      if (stats.busy) break;
      await pause(100);
    }
  } catch (error) { report("turn-backfill", error); }
  if (stopRetention()) return stats;

  const forkGuard = "status='cancelled' and kind='replay-fork' and series_id is null and julianday(ended_at) < julianday(?)";
  // Fork failures never suppress compaction or another fork. Every delete keeps
  // its own guard, transaction, zero timeout, and foreign-key check after yielding.
  try {
    if (Number(db.pragma("foreign_keys", { simple: true })) === 1) {
      const forks = db.prepare<[string, number], { id: number; slug: string; guildId: string; creatorPlayerId: number }>(
        `select id,web_slug as slug,guild_id as guildId,organizer_player_id as creatorPlayerId from duels where ${forkGuard} order by julianday(ended_at),id limit ?`).all(forkCutoff, size);
      const remove = db.prepare<[number, string]>(`delete from duels where id=? and ${forkGuard}`);
      for (const fork of forks) {
        await pause(0);
        if (stopRetention()) return stats;
        if (options.isForkBusy?.(fork.slug, fork.guildId, fork.creatorPlayerId)) continue;
        if (Number(db.pragma("foreign_keys", { simple: true })) !== 1) break;
        try { stats.deletedForks += withoutBusyWait(db, () => db.transaction(() => remove.run(fork.id, forkCutoff).changes).immediate()); }
        catch (error) { report("fork-delete", error); if (isBusy(error)) break; }
        await pause(100);
      }
    }
  } catch (error) { report("fork-delete", error); }
  if (stopRetention()) return stats;

  const compactGuard = `snapshot_compacted_at is null and ${terminalGuard} and julianday(ended_at) < julianday(?)`;
  try {
    // IDs and age keys are small. Fetch one full row only while the byte budget
    // allows it; never hold a SQLite iterator across an asynchronous yield.
    const select = db.prepare<[string, number, number, number], { id: number; age: number }>(`select id,julianday(ended_at) as age
      from duels where ${compactGuard} and (julianday(ended_at),id)>(?,?) order by julianday(ended_at),id limit ?`);
    const update = db.prepare(`update duels set snapshot_public_json=?,snapshot_seat0_json=?,snapshot_seat1_json=?,snapshot_seats_json=?,
      turn_count=coalesce(turn_count,?),snapshot_compacted_at=? where id=? and snapshot_compacted_at is null
      and status=? and ended_at=? and kind=? and format=? and snapshot_public_json is ? and snapshot_seat0_json is ?
      and snapshot_seat1_json is ? and snapshot_seats_json is ? and clock_json is ?`);
    let ageCursor = -1, idCursor = 0;
    for (let batch = 0; batch < batches && !stopRetention(); batch++) {
      const ids = select.all(cutoff, ageCursor, idCursor, size);
      if (!ids.length) break;
      const prepared: Array<{ row: RetentionRow; values: StoredSnapshot[]; turn: number | null }> = [];
      let bytes = 0;
      for (const { id, age } of ids) {
        if (stopRetention()) return stats;
        if (bytes >= MAX_BATCH_BYTES) break;
        const row = fetch.get(id);
        if (!row) { ageCursor = age; idCursor = id; continue; }
        const rowBytes = bytesOf(row);
        if (prepared.length && bytes + rowBytes > MAX_BATCH_BYTES) break;
        ageCursor = age; idCursor = id; bytes += rowBytes;
        try {
          const originals = originalsOf(row);
          const seats = readStoredSeatBoards(row.snapshot_seats_json);
          const count = isDuelFormat(row.format) ? seatCountFor(row.format) : 0;
          const complete = count > 2 && seats.length === count && seats.every(view => view !== null
            && Array.from({ length: count }, (_, seat) => seat).every(seat => view.seats.some(candidate => candidate.seat === seat)));
          const values = await Promise.all(originals.map((raw, index) => complete && (index === 1 || index === 2)
            ? Promise.resolve(null) : compressStoredSnapshot(raw)));
          prepared.push({ row, values, turn: storedTurnCount(row) });
        } catch (error) { report("compaction", error); }
        await pause(0);
      }
      if (stopRetention()) return stats;
      try {
        stats.compacted += withoutBusyWait(db, () => db.transaction(() => {
          let changed = 0;
          for (const { row, values, turn } of prepared) {
            // A savepoint also isolates future constraint/trigger failures within a batch.
            try { changed += db.transaction(() => update.run(...values, turn, stamp, row.id, row.status, row.ended_at,
              row.kind, row.format, ...originalsOf(row), row.clock_json).changes)(); }
            catch (error) { if (isBusy(error)) throw error; report("compaction", error); }
          }
          return changed;
        }).immediate());
      } catch (error) { report("compaction", error); if (isBusy(error)) break; }
      await pause(100);
    }
    stats.backlogDone = !stopRetention() && !stats.busy
      && !db.prepare(`select 1 from duels where ${compactGuard} limit 1`).get(cutoff)
      && !db.prepare(`select 1 from duels where ${forkGuard} limit 1`).get(forkCutoff);
  } catch (error) { report("compaction", error); }
  return stats;
}
