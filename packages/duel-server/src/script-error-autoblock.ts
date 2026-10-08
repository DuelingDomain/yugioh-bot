import type Database from "better-sqlite3";
import type { CardBlockEntry } from "./card-block-list.js";
import { scriptErrorModeFromEnv } from "./script-errors.js";

export const AUTO_BLOCK_REASON = "Its effect script is being investigated";
export function autoBlockConfigFromEnv() {
  const integer = (name: string, fallback: number, max: number) => {
    const value = process.env[name] ? Number(process.env[name]) : fallback;
    if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new Error(`${name} must be an integer from 1 to ${max}`);
    return value;
  };
  return { threshold: integer("DUEL_SCRIPT_ERROR_BLOCK_DUELS", 3, 1_000_000),
    windowDays: integer("DUEL_SCRIPT_ERROR_BLOCK_WINDOW_DAYS", 7, 30) };
}

export interface AutoBlockRow {
  code: number; reason: string; blocked_at: string; distinct_duels: number; error_count: number;
  threshold: number; window_days: number; bundle_version: string; script_hash: string; cleared_at: string | null;
}

/** Clears admission policy only; keeps telemetry and establishes a fresh counting baseline. */
export function clearAutoBlock(db: Database.Database, code: number, now = Date.now()): boolean {
  if (!Number.isSafeInteger(code) || code <= 0 || code > 0xffffffff) throw new Error("code must be a positive passcode");
  return db.prepare("UPDATE card_script_auto_blocks SET cleared_at = ? WHERE code = ? AND cleared_at IS NULL")
    .run(new Date(now).toISOString(), code).changes > 0;
}

/** Host-only mutable admission policy. Never passed into a worker or saved duel setup. */
export function createAutoBlockPolicy(db: Database.Database, options: {
  bundleVersion: string;
  scriptHash: (code: number) => string | null;
  remaps?: ReadonlyMap<number, number>;
  now?: () => number;
}) {
  const enabled = scriptErrorModeFromEnv() !== "strict";
  const config = enabled ? autoBlockConfigFromEnv() : { threshold: 3, windowDays: 7 };
  const now = options.now ?? Date.now;
  const resolveCode = (code: number) => options.remaps?.get(code) ?? code;
  const relatedCodes = (code: number) => [code, ...[...options.remaps ?? []].filter(([, target]) => target === code).map(([old]) => old)];
  const rows = db.prepare("SELECT * FROM card_script_auto_blocks WHERE cleared_at IS NULL ORDER BY code");
  const block = db.prepare(`INSERT INTO card_script_auto_blocks
    (code, reason, blocked_at, distinct_duels, error_count, threshold, window_days, bundle_version, script_hash, cleared_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    ON CONFLICT(code) DO UPDATE SET reason = excluded.reason, blocked_at = excluded.blocked_at,
      distinct_duels = excluded.distinct_duels, error_count = excluded.error_count, threshold = excluded.threshold,
      window_days = excluded.window_days, bundle_version = excluded.bundle_version, script_hash = excluded.script_hash, cleared_at = NULL`);
  return {
    now,
    revision(rawCode: number) {
      const code = resolveCode(rawCode);
      return { code, scriptHash: options.scriptHash(code) };
    },
    /** Called inside the recorder's immediate transaction, after an accepted new sample. */
    consider(code: number, hash: string | null) {
      if (!enabled || hash === null) return;
      const codes = relatedCodes(code), placeholders = codes.map(() => "?").join(",");
      const previous = db.prepare(`SELECT * FROM card_script_auto_blocks WHERE code IN (${placeholders})`).all(...codes) as AutoBlockRow[];
      if (previous.some(row => row.cleared_at === null && row.script_hash === hash)) return;
      const clearedAt = previous.map(row => row.cleared_at).filter((at): at is string => at !== null).sort().at(-1) ?? null;
      const time = now(), at = new Date(time).toISOString();
      const result = db.prepare(`SELECT count(DISTINCT duel_id) AS duels, count(*) AS errors
        FROM card_script_error_occurrences WHERE resolved_code IN (${placeholders}) AND script_hash = ? AND script_error_mode = 'tolerant'
          AND julianday(created_at) >= julianday(?) AND julianday(created_at) <= julianday(?)
          AND (? IS NULL OR julianday(created_at) > julianday(?))`)
        .get(...codes, hash, new Date(time - config.windowDays * 86400000).toISOString(), at, clearedAt, clearedAt) as { duels: number; errors: number };
      if (result.duels < config.threshold) return;
      block.run(code, AUTO_BLOCK_REASON, at, result.duels, result.errors, config.threshold, config.windowDays, options.bundleVersion, hash);
    },
    entries(): readonly CardBlockEntry[] {
      if (!enabled) return [];
      const entries: CardBlockEntry[] = [];
      for (const row of rows.all() as AutoBlockRow[]) {
        const code = resolveCode(row.code);
        if (options.scriptHash(code) !== row.script_hash) { clearAutoBlock(db, row.code, now()); continue; }
        entries.push({ code, reason: AUTO_BLOCK_REASON });
      }
      return entries;
    },
  };
}
export type AutoBlockPolicy = ReturnType<typeof createAutoBlockPolicy>;
