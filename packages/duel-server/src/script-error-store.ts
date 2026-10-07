import type Database from "better-sqlite3";
import type { DuelScriptError } from "./script-errors.js";

export interface CardScriptErrorCount {
  code: number;
  count: number;
  last_message: string;
  last_script_file: string;
  last_line: number;
  last_mode: string;
  last_duel_id: number;
  last_seen: string;
}

/** Host-only side effect. The seeded command path and engine ordinal deduplicate recoveries/retries. */
export function createScriptErrorRecorder(db: Database.Database, log: (line: string) => void = console.error) {
  const once = db.prepare("INSERT OR IGNORE INTO card_script_error_occurrences (duel_id, command_hash, error_index) VALUES (?, ?, ?)");
  const increment = db.prepare(`INSERT INTO card_script_errors (code, count, last_message, last_script_file, last_line, last_mode, last_duel_id, last_seen)
    VALUES (?, 1, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(code) DO UPDATE SET count = count + 1, last_message = excluded.last_message,
      last_script_file = excluded.last_script_file, last_line = excluded.last_line,
      last_mode = excluded.last_mode, last_duel_id = excluded.last_duel_id, last_seen = excluded.last_seen`);
  const save = db.transaction((duelId: number, error: DuelScriptError) => {
    if (!once.run(duelId, error.commandHash ?? "", error.index).changes) return false;
    increment.run(error.code, error.message, error.scriptFile, error.line, error.mode, duelId);
    return true;
  });
  return (duelId: number, error: DuelScriptError): boolean => {
    try {
      if (!save.immediate(duelId, error)) return false;
      log(JSON.stringify({ event: "card_script_error", duelId, ...error }));
      return true;
    } catch (failure) {
      // Observability must never turn a recovered Lua failure into a rejected duel answer.
      log(JSON.stringify({ event: "card_script_error_persistence_failed", duelId, ...error, failure: failure instanceof Error ? failure.message : String(failure) }));
      return false;
    }
  };
}

export function topScriptErrors(db: Database.Database, limit = 20): CardScriptErrorCount[] {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error("limit must be an integer from 1 to 1000");
  return db.prepare("SELECT * FROM card_script_errors ORDER BY count DESC, code ASC LIMIT ?").all(limit) as CardScriptErrorCount[];
}
