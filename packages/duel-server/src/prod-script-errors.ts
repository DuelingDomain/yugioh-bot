import Database from "better-sqlite3";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadCardPasscodeRemaps } from "@yugidraft/shared/db";
import { loadCardDatabase, type CardDatabase } from "./cards.js";
import { cardScriptHash, type ScriptEngineKind } from "./card-script-hash.js";
import { loadMultiScriptsFor } from "./multi-scripts.js";
import { scriptErrorModeFromEnv } from "./script-errors.js";
import type { AutoBlockRow } from "./script-error-autoblock.js";

export interface ProdScriptErrorCard {
  code: number; name: string; distinctDuels: number; errorCount: number; autoBlocked: boolean; scriptHash: string | null; engineKind?: ScriptEngineKind;
}
export type ProdScriptErrorSnapshot = { available: true; cards: ProdScriptErrorCard[]; truncated?: boolean } | { available: false };

/** Fixed seven-day read-only query. Private occurrence identities never leave this function. */
export function prodScriptErrors(db: Database.Database, cards: CardDatabase, remaps: ReadonlyMap<number, number>, now = Date.now()): Extract<ProdScriptErrorSnapshot, { available: true }> {
  return db.transaction(() => {
    const totals = new Map<number, { duels: Set<number>; errors: number }>();
    const occurrences = db.prepare(`SELECT code, duel_id, count(*) AS errors FROM card_script_error_occurrences
      WHERE julianday(created_at) >= julianday(?) AND julianday(created_at) <= julianday(?) GROUP BY code, duel_id`)
      .all(new Date(now - 7 * 86400000).toISOString(), new Date(now).toISOString()) as { code: number; duel_id: number; errors: number }[];
    for (const row of occurrences) {
      if (!Number.isSafeInteger(row.code) || row.code <= 0) continue;
      const code = remaps.get(row.code) ?? row.code;
      const total = totals.get(code) ?? { duels: new Set<number>(), errors: 0 };
      total.duels.add(row.duel_id); total.errors += row.errors; totals.set(code, total);
    }
    const active = new Map<number, AutoBlockRow[]>();
    let overlay: ReturnType<typeof loadMultiScriptsFor> | undefined;
    const hash = (code: number, kind: ScriptEngineKind = "all") => {
      if (kind.startsWith("multi-") && cards.dataDirectory) overlay ??= loadMultiScriptsFor(cards.dataDirectory);
      return cardScriptHash(cards, code, kind, overlay);
    };
    if (scriptErrorModeFromEnv() !== "strict") {
      for (const row of db.prepare("SELECT * FROM card_script_auto_blocks WHERE cleared_at IS NULL").all() as AutoBlockRow[]) {
        const code = remaps.get(row.code) ?? row.code;
        if (hash(code, row.engine_kind) === row.script_hash) active.set(code, [...active.get(code) ?? [], row]);
      }
    }
    const top = [...totals.keys()].sort((a, b) => totals.get(b)!.errors - totals.get(a)!.errors || a - b).slice(0, 20);
    // Include blocks with no recent samples. Blocks receive priority when the hard size cap is reached.
    const codes = [...new Set([...active.keys()].sort((a, b) => a - b).concat(top))];
    const result = codes.flatMap(code => (active.get(code) ?? [null]).map(row => ({ code, name: (cards.deckCard(code)?.name ?? "Name unavailable").slice(0, 200),
      distinctDuels: totals.get(code)?.duels.size ?? 0, errorCount: totals.get(code)?.errors ?? 0,
      autoBlocked: row !== null, scriptHash: hash(code, row?.engine_kind), ...(row ? { engineKind: row.engine_kind } : {}) }))).slice(0, 100);
    result.sort((a, b) => b.errorCount - a.errorCount || a.code - b.code);
    return { available: true as const, cards: result, truncated: codes.reduce((n, code) => n + (active.get(code)?.length ?? 1), 0) > 100 };
  })();
}

// The VM invokes this compiled entrypoint in the already running duel container. No dotenv or migrations.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let db: Database.Database | undefined;
  try {
    db = new Database(process.env.DATABASE_PATH ?? "/app/data/bot.sqlite", { readonly: true, fileMustExist: true, timeout: 5000 });
    db.pragma("query_only = ON");
    const directory = process.env.DUEL_DATA_DIR ?? "/app/data/duel-engine";
    console.log(JSON.stringify(prodScriptErrors(db, loadCardDatabase(directory), loadCardPasscodeRemaps(directory))));
  } catch {
    // Diagnostics are deliberately omitted; this output may become a public workflow artifact.
    console.log(JSON.stringify({ available: false }));
  } finally { db?.close(); }
}
