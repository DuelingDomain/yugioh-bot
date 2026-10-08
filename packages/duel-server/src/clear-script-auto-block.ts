import Database from "better-sqlite3";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadCardPasscodeRemaps } from "@yugidraft/shared/db";
import { clearAutoBlock } from "./script-error-autoblock.js";

/** Accept either the original or graduated passcode. Never changes manual policy or telemetry. */
export function clearRemappedAutoBlock(db: Database.Database, code: number, remaps: ReadonlyMap<number, number>, now = Date.now()): number {
  if (!Number.isSafeInteger(code) || code <= 0 || code > 0xffffffff) throw new Error("code must be a positive passcode");
  const target = remaps.get(code) ?? code;
  return db.transaction(() => {
    let cleared = 0;
    for (const row of db.prepare("SELECT code FROM card_script_auto_blocks WHERE cleared_at IS NULL").all() as { code: number }[]) {
      if ((remaps.get(row.code) ?? row.code) === target && clearAutoBlock(db, row.code, now)) cleared++;
    }
    return cleared;
  }).immediate();
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const code = Number(process.argv[2]);
  if (process.argv.length > 5 || !Number.isSafeInteger(code) || code < 1 || code > 0xffffffff) {
    throw new Error("Usage: clear-script-auto-block <code> [database path] [engine data directory]");
  }
  const db = new Database(process.argv[3] ?? process.env.DATABASE_PATH ?? "./data/bot.sqlite", { fileMustExist: true });
  try {
    const directory = process.argv[4] ?? process.env.DUEL_DATA_DIR ?? "./data/duel-engine";
    console.log(JSON.stringify({ code, cleared: clearRemappedAutoBlock(db, code, loadCardPasscodeRemaps(directory)) }));
  } finally { db.close(); }
}
