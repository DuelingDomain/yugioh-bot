import { Worker } from "node:worker_threads";
import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import type { ArchetypeBridge, BridgeFormat, BridgeProgress } from "@yugidraft/shared/cards/effects";
import type { DeckSuggestionLegality, DeckSuggestionQuery, DeckSuggestionResult, CardEffectSearchResult } from "@yugidraft/shared/services";

type Job = { worker: Worker; reject?: (error: Error) => void; idle?: ReturnType<typeof setTimeout> };
export type SuggestionScan = { guildId?: string; query: DeckSuggestionQuery; legality: DeckSuggestionLegality; deckMaster?: number };
export type BridgeScan = { kind: "bridges"; source: string; format: BridgeFormat } & (
  { op: "from"; limit?: number } | { op: "live" } | { op: "between" | "explain"; target: string }
);
export type BridgeScanResult = ArchetypeBridge[] | ArchetypeBridge | null;
type ScanResult = DeckSuggestionResult | CardEffectSearchResult | BridgeScanResult;
export class BridgeSearchBusyError extends Error {
  readonly status = 429;
  constructor(readonly retryAfterMs = 60_000) { super("Bridge search is busy; retry later"); }
}

/** Two reusable read-only scanners, isolated from live duel operations. The host owns admission. */
export class DeckSuggestionWorkers {
  private readonly jobs: Job[] = [];
  private readonly retiring = new Set<Promise<number>>();
  private readonly bridgeActors = new Set<string>();
  private readonly bridgeCache = new Map<string, { expires: number; result: BridgeScanResult }>();
  constructor(private readonly db: Database.Database, private readonly dataDirectory: string,
    private readonly idleMs = 120_000) {}

  private retire(job: Job): void {
    clearTimeout(job.idle);
    const index = this.jobs.indexOf(job);
    if (index >= 0) this.jobs.splice(index, 1);
    const terminated = job.worker.terminate();
    this.retiring.add(terminated);
    const forget = () => { this.retiring.delete(terminated); };
    void terminated.then(forget, forget);
  }

  run(scan: SuggestionScan): Promise<DeckSuggestionResult | CardEffectSearchResult> {
    return this.scan(scan) as Promise<DeckSuggestionResult | CardEffectSearchResult>;
  }

  async runBridge(scan: BridgeScan, actor: string, progress?: (value: BridgeProgress) => void): Promise<BridgeScanResult> {
    const notify = (value: BridgeProgress) => { try { progress?.(value); } catch { /* A disconnected progress consumer must not interrupt the scan. */ } };
    if (!actor.trim() || !scan.source.trim() || scan.source.length > 160 || !["from", "live", "between", "explain"].includes(scan.op)
      || (scan.format !== "advanced" && scan.format !== "genesys") || (scan.op === "between" || scan.op === "explain") && (!scan.target.trim() || scan.target.length > 160)) throw new Error("Invalid bridge search");
    scan = { ...scan, source: scan.source.trim(), ...("target" in scan ? { target: scan.target.trim() } : {}) };
    const hash = createHash("sha256").update(actor).digest("hex");
    const version = (this.db.prepare("SELECT source_version FROM bridge_graph WHERE id=1").get() as { source_version: string } | undefined)?.source_version;
    const key = JSON.stringify([version, scan.op, scan.source.trim().toLowerCase(), scan.format, "target" in scan ? scan.target.trim().toLowerCase() : null]);
    const cached = this.bridgeCache.get(key);
    if (cached && cached.expires > Date.now()) {
      const rejected = this.db.prepare(`SELECT 1 FROM bridge_judgement WHERE evidence_hash=? AND verdict IN ('rejected','review')
        UNION ALL SELECT 1 FROM bridge_feedback WHERE evidence_hash=? AND resolved_at IS NULL GROUP BY evidence_hash HAVING count(DISTINCT actor_hash)>=2 LIMIT 1`);
      const visible = (row: ArchetypeBridge) => !rejected.get(row.evidence_hash, row.evidence_hash);
      const result = Array.isArray(cached.result) ? cached.result.filter(visible) : cached.result && visible(cached.result) ? cached.result : null;
      notify({ phase: "done", completed: 1, total: 1 });
      return structuredClone(result);
    }
    if (this.bridgeActors.has(hash) || this.jobs.filter(job => job.reject).length >= 2) throw new BridgeSearchBusyError();
    const searches = scan.op === "live" || scan.op === "explain";
    if (searches) this.db.transaction(() => {
      const now = Date.now();
      const prior = this.db.prepare("SELECT admitted_at FROM bridge_search_admission WHERE actor_hash=?").get(hash) as { admitted_at: number } | undefined;
      if (prior && now - prior.admitted_at < 60_000) throw new BridgeSearchBusyError(60_000 - (now - prior.admitted_at));
      this.db.prepare("DELETE FROM bridge_search_admission WHERE admitted_at<?").run(now - 86_400_000);
      this.db.prepare("INSERT INTO bridge_search_admission(actor_hash,admitted_at) VALUES(?,?) ON CONFLICT(actor_hash) DO UPDATE SET admitted_at=excluded.admitted_at").run(hash, now);
    }).immediate();
    this.bridgeActors.add(hash);
    try {
      const result = await this.scan(scan, notify) as BridgeScanResult;
      if (searches) {
        this.bridgeCache.set(key, { expires: Date.now() + 15 * 60_000, result: structuredClone(result) });
        if (this.bridgeCache.size > 64) this.bridgeCache.delete(this.bridgeCache.keys().next().value!);
      }
      return result;
    } finally { this.bridgeActors.delete(hash); }
  }

  private scan(scan: SuggestionScan | BridgeScan, progress?: (value: BridgeProgress) => void): Promise<ScanResult> {
    let job = this.jobs.find(job => !job.reject);
    if (!job) {
      if (this.jobs.length >= 2) throw new Error("Suggestion workers are busy");
      const development = import.meta.url.endsWith(".ts");
      const module = new URL(development ? "./deck-suggestion-worker.ts" : "./deck-suggestion-worker.js", import.meta.url);
      // Bound each of the two scanners independently; Node reports heap OOM via
      // the same error/exit path that rejects the job and removes the worker.
      const resourceLimits = { maxOldGenerationSizeMb: 256 };
      const worker = development
        ? new Worker(`import('tsx/esm/api').then(({ tsImport }) => tsImport(${JSON.stringify(module.href)}, ${JSON.stringify(import.meta.url)}))`, { eval: true, resourceLimits })
        : new Worker(module, { resourceLimits });
      job = { worker }; this.jobs.push(job);
      // An idle worker may exit too. Keep errors handled and never reuse a dead scanner.
      worker.on("error", () => {});
      worker.once("exit", () => {
        clearTimeout(job!.idle);
        const index = this.jobs.findIndex(job => job.worker === worker);
        if (index >= 0) this.jobs.splice(index, 1);
      });
    }
    const current = job;
    clearTimeout(current.idle);
    current.worker.ref();
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error, result?: ScanResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        current.worker.off("message", message);
        current.worker.off("error", fail);
        current.worker.off("exit", fail);
        current.reject = undefined;
        current.worker.unref();
        if (error) {
          this.retire(current);
          reject(error);
        } else {
          // Reuse during a burst of editor requests, then release the isolate,
          // module graph and read-only SQLite page cache between visits.
          current.idle = setTimeout(() => this.retire(current), this.idleMs);
          current.idle.unref();
          resolve(result!);
        }
      };
      const fail = () => finish(new Error("Suggestion scanner stopped"));
      const message = (answer: { error?: boolean; result: ScanResult; progress?: BridgeProgress }) => {
        if (answer.progress) { progress?.(answer.progress); return; }
        finish(answer.error ? new Error("Suggestion scan failed") : undefined, answer.result);
      };
      const timer = setTimeout(fail, 30_000);
      current.reject = (error) => finish(error);
      current.worker.on("message", message);
      current.worker.once("error", fail);
      current.worker.once("exit", fail);
      try {
        // Production opens the application DB read-only in the worker. Only disposable in-memory
        // integration fixtures need a snapshot; no catalog rows cross the live host thread.
        const database = this.db.name === ":memory:" || this.db.name === ""
          ? this.db.serialize() : this.db.name;
        current.worker.postMessage({ ...scan, database, dataDirectory: this.dataDirectory });
      } catch { fail(); }
    });
  }

  async close(): Promise<void> {
    const jobs = [...this.jobs];
    for (const job of jobs) {
      clearTimeout(job.idle);
      job.reject?.(new Error("Suggestion scanner closed"));
    }
    await Promise.all([...this.retiring, ...jobs.map(job => job.worker.terminate())]);
    this.jobs.length = 0;
  }
}
