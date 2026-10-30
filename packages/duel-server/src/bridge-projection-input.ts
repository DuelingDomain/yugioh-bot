import type Database from "better-sqlite3";
import type { ArchetypeBridge, BridgeFormat } from "@yugidraft/shared/cards/effects";

type CompactBridges = { pairs: [string, string, BridgeFormat, string][] };
export type BridgeProjectionInput = ArchetypeBridge[] | CompactBridges | { jobId: string };
const parsed = new WeakMap<Database.Database, Map<string, ArchetypeBridge[] | CompactBridges>>();

export const compactBridgeRows = (rows: ArchetypeBridge[]): CompactBridges => ({
  pairs: rows.map(row => [row.source, row.target, row.format, row.evidence_hash]),
});

/** Called in scanners for multi jobs. Old full-row results are parsed there too. */
export function bridgeProjectionRows(db: Database.Database, input: BridgeProjectionInput): ArchetypeBridge[] {
  if ("jobId" in input) {
    let cache = parsed.get(db);
    if (!cache) { cache = new Map(); parsed.set(db, cache); }
    let stored = cache.get(input.jobId);
    if (!stored) {
      const row = db.prepare("SELECT result_json FROM bridge_deep_job WHERE id=? AND state='done'").get(input.jobId) as { result_json: string } | undefined;
      if (!row) throw new Error("Completed bridge result is unavailable");
      stored = JSON.parse(row.result_json) as ArchetypeBridge[] | CompactBridges;
      // Cache small immutable inputs; large legacy blobs still parse off-thread.
      if (row.result_json.length <= 1_000_000) {
        cache.set(input.jobId, stored);
        if (cache.size > 8) cache.delete(cache.keys().next().value!);
      }
    }
    return bridgeProjectionRows(db, stored);
  }
  if (Array.isArray(input)) return input;
  const read = db.prepare("SELECT bridge_json FROM archetype_bridge WHERE source=? AND target=? AND format=? AND evidence_hash=?");
  return input.pairs.flatMap(pair => {
    const row = read.get(...pair) as { bridge_json: string } | undefined;
    return row ? [JSON.parse(row.bridge_json) as ArchetypeBridge] : [];
  });
}
