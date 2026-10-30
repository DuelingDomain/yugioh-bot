import type Database from "better-sqlite3";
import { bridgeGate, type ArchetypeBridge } from "@yugidraft/shared/cards/effects";
import { BridgeReviewUnavailableError, type BridgeJobStep } from "./bridge-search-jobs.js";
import { type EngineQuery } from "./bridge-engine-queries.js";
import type { DeckSuggestionWorkers } from "./deck-suggestion-workers.js";

/** The budget counts pairs requiring new reviews, never cached verdicts or subscribers. */
export async function searchBridgeEngines(db: Database.Database, workers: Pick<DeckSuggestionWorkers, "bridgeCandidates" | "rateBridge" | "bridgeEngineShortlist">,
  query: EngineQuery, progress: (step: BridgeJobStep, value: number) => void) {
  const pairs = new Map<string, ArchetypeBridge>();
  const add = (rows: ArchetypeBridge[]) => rows.forEach(row => pairs.set(JSON.stringify([row.source, row.target, row.format]), row));
  const total = query.engines.length * 2;
  let scanned = 0;
  for (const source of query.engines) {
    for (const op of ["outgoing", "into"] as const) {
      // Legacy single-source results are a deduplicated top-25 projection;
      // they cannot substitute for the complete forward candidate universe.
      const rows = await workers.bridgeCandidates({ kind: "bridges", op, source, format: query.format }, value => {
        progress("candidates", Math.floor(28 * (scanned + value.completed / Math.max(1, value.total)) / total));
      });
      add(Array.isArray(rows) ? rows : rows ? [rows] : []);
      scanned++; progress("candidates", Math.floor(28 * scanned / total));
    }
  }
  const all = [...pairs.values()].filter(row => row.format === query.format);
  progress("checking", 30);
  const version = (db.prepare("SELECT source_version FROM bridge_graph WHERE id=1").get() as { source_version: string }).source_version;
  db.transaction(() => {
    const save = db.prepare(`INSERT INTO archetype_bridge(source,target,format,score,grade,bridge_json,evidence_hash,source_version)
      VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(source,target,format) DO UPDATE SET score=excluded.score,grade=excluded.grade,
      bridge_json=excluded.bridge_json,evidence_hash=excluded.evidence_hash,source_version=excluded.source_version`);
    for (const row of all) save.run(row.source, row.target, row.format, row.score, row.grade, JSON.stringify(row), row.evidence_hash, version);
  }).immediate();
  const shortlist = await workers.bridgeEngineShortlist(all, query);
  const display = shortlist.flatMap(engine => engine.links.map(link => link.bridge));
  const selected = new Set(query.engines);
  const internal = all.filter(row => selected.has(row.source) && selected.has(row.target));
  const rows = [...new Map([...display, ...internal].map(row => [JSON.stringify([row.source, row.target, row.format]), row])).values()];
  let newReviews = 0, reviewedEngines = 0, gainedReviews = false, reviewIncomplete = false;
  progress("rating", 35);
  for (const engine of shortlist) {
    if (reviewedEngines >= 6 || newReviews >= 12) break;
    let reviewedThisEngine = false;
    const pending = engine.links.map(link => link.bridge).filter(row => bridgeGate(db, row).state === "pending").slice(0, 12 - newReviews);
    // Keep two pair tasks in flight, using the existing globally bounded judge queue.
    for (let i = 0; i < pending.length; i += 2) {
      const batch = pending.slice(i, i + 2);
      newReviews += batch.length;
      await Promise.all(batch.map(async row => {
        const before = new Set(bridgeGate(db, row).judgements.map(review => review.judge));
        await workers.rateBridge(row);
        const after = bridgeGate(db, row);
        if (after.judgements.some(review => !before.has(review.judge))) gainedReviews = reviewedThisEngine = true;
        // A swallowed provider error can consume an attempt without producing
        // both verdicts. Keep this distinct from unattempted stop-rule leftovers.
        if (after.state === "pending") reviewIncomplete = true;
      }));
      progress("rating", 35 + Math.floor(64 * Math.max(newReviews / 12, reviewedEngines / 6)));
    }
    if (reviewedThisEngine || engine.links.some(link => bridgeGate(db, link.bridge).state === "shown")) reviewedEngines++;
  }
  if (newReviews && !gainedReviews && !rows.some(row => bridgeGate(db, row).state === "shown")) throw new BridgeReviewUnavailableError();
  return { rows: all, reviewIncomplete };
}
