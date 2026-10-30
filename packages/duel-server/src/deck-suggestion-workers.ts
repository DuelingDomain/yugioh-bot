import { Worker } from "node:worker_threads";
import type Database from "better-sqlite3";
import { judgeBridgePair, type ArchetypeBridge, type BridgeFormat, type BridgeProgress, type BridgeJudgeOptions, type BridgeEnginesResponse, type RankedEngine } from "@yugidraft/shared/cards/effects";
import type { EngineQuery } from "./bridge-engine-queries.js";
import { BridgeJobError } from "./bridge-search-jobs.js";
import type { BridgeProjectionInput } from "./bridge-projection-input.js";
import type { DeckSuggestionLegality, DeckSuggestionQuery, DeckSuggestionResult, CardEffectSearchResult } from "@yugidraft/shared/services";

type Job = { worker: Worker; reject?: (error: Error) => void; idle?: ReturnType<typeof setTimeout> };
export type SuggestionScan = { guildId?: string; query: DeckSuggestionQuery; legality: DeckSuggestionLegality; deckMaster?: number };
export type BridgeScan = { kind: "bridges"; source: string; format: BridgeFormat } & (
  { op: "from"; limit?: number } | { op: "live" | "outgoing" | "into" } | { op: "between" | "explain"; target: string }
);
export type BridgeScanResult = ArchetypeBridge[] | ArchetypeBridge | null;
export type BridgeEnginesScan = { kind: "bridge-engines"; input: Record<string, unknown>; guildId: string };
export type BridgeProjectionScan = { kind: "bridge-engine-projection"; query: EngineQuery } & (
  { op: "project"; rows: BridgeProjectionInput } | { op: "shortlist"; rows: ArchetypeBridge[] }
);
type ScanResult = DeckSuggestionResult | CardEffectSearchResult | BridgeScanResult | BridgeEnginesResponse | RankedEngine<ArchetypeBridge>[];
/** Two reusable read-only scanners, isolated from live duel operations. The host owns admission. */
export class DeckSuggestionWorkers {
  private readonly jobs: Job[] = [];
  private readonly retiring = new Set<Promise<number>>();
  private readonly judging = new Set<Promise<void>>();
  private readonly judgeAbort = new AbortController();
  private readonly judgeQueue: { bridge: ArchetypeBridge; resolve: () => void; reject: (error: unknown) => void }[] = [];
  private readonly bridgeQueue: { scan: BridgeScan | BridgeEnginesScan | BridgeProjectionScan; progress?: (value: BridgeProgress) => void; resolve: (value: ScanResult) => void; reject: (error: Error) => void }[] = [];
  private closing = false;
  constructor(private readonly db: Database.Database, private readonly dataDirectory: string,
    private readonly idleMs = 120_000, private readonly judgeOptions: BridgeJudgeOptions = {}) {}

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

  bridgeCandidates(scan: BridgeScan, progress?: (value: BridgeProgress) => void): Promise<BridgeScanResult> {
    return this.queuedBridge(scan, progress) as Promise<BridgeScanResult>;
  }

  bridgeEngines(input: Record<string, unknown>, guildId: string): Promise<BridgeEnginesResponse> {
    return this.queuedBridge({ kind: "bridge-engines", input, guildId }) as Promise<BridgeEnginesResponse>;
  }

  bridgeEngineProjection(rows: BridgeProjectionInput, query: EngineQuery): Promise<BridgeEnginesResponse> {
    return this.queuedBridge({ kind: "bridge-engine-projection", op: "project", rows, query }) as Promise<BridgeEnginesResponse>;
  }

  bridgeEngineShortlist(rows: ArchetypeBridge[], query: EngineQuery): Promise<RankedEngine<ArchetypeBridge>[]> {
    return this.queuedBridge({ kind: "bridge-engine-projection", op: "shortlist", rows, query }) as Promise<RankedEngine<ArchetypeBridge>[]>;
  }

  rateBridge(bridge: ArchetypeBridge): Promise<void> {
    if (this.closing) return Promise.reject(new Error("Bridge judging closed"));
    return new Promise((resolve, reject) => {
      this.judgeQueue.push({ bridge, resolve, reject });
      this.drainJudges();
    });
  }

  private drainJudges(): void {
    while (!this.closing && this.judgeQueue.length && this.judging.size < 2) {
      const next = this.judgeQueue.shift()!;
      const work = (async () => {
        try {
          await judgeBridgePair(this.db, next.bridge, { ...this.judgeOptions,
            signal: AbortSignal.any([this.judgeAbort.signal, AbortSignal.timeout(110_000), ...(this.judgeOptions.signal ? [this.judgeOptions.signal] : [])]),
            log: this.judgeOptions.log ?? (entry => console.info(JSON.stringify({ event: "bridge-judge-spend", ...entry }))) });
          next.resolve();
        } catch (error) { next.reject(error); }
      })().finally(() => { this.judging.delete(work); this.drainJudges(); });
      this.judging.add(work);
    }
  }

  private queuedBridge(scan: BridgeScan | BridgeEnginesScan | BridgeProjectionScan, progress?: (value: BridgeProgress) => void): Promise<ScanResult> {
    if (this.closing) return Promise.reject(new Error("Suggestion scanner closed"));
    if (this.bridgeQueue.length >= 16) return Promise.reject(new BridgeJobError("Bridge scanner queue is busy", 503, 1));
    return new Promise((resolve, reject) => { this.bridgeQueue.push({ scan, progress, resolve, reject }); this.drainBridges(); });
  }

  private drainBridges(): void {
    while (!this.closing && this.bridgeQueue.length && this.jobs.filter(job => job.reject).length < 1) {
      const next = this.bridgeQueue.shift()!;
      try { void this.scan(next.scan, next.progress).then(next.resolve, next.reject); }
      catch (error) { next.reject(error instanceof Error ? error : new Error("Suggestion scanner could not start")); }
    }
  }

  private scan(scan: SuggestionScan | BridgeScan | BridgeEnginesScan | BridgeProjectionScan, progress?: (value: BridgeProgress) => void): Promise<ScanResult> {
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
        if (error && !(error instanceof BridgeJobError)) this.retire(current);
        else {
          // A rejected query leaves the scanner healthy. Reuse it during a
          // burst, then release its isolate and read-only page cache when idle.
          current.idle = setTimeout(() => this.retire(current), this.idleMs);
          current.idle.unref();
        }
        if (error) reject(error); else resolve(result!);
        this.drainBridges();
      };
      const fail = () => finish(new Error("Suggestion scanner stopped"));
      const message = (answer: { error?: boolean; bridgeError?: { message: string; status: number; retryAfter?: number }; result: ScanResult; progress?: BridgeProgress }) => {
        if (answer.progress) {
          try { progress?.(answer.progress); } catch { /* A disconnected progress consumer must not interrupt the scan. */ }
          return;
        }
        finish(answer.error ? answer.bridgeError
          ? new BridgeJobError(answer.bridgeError.message, answer.bridgeError.status, answer.bridgeError.retryAfter)
          : new Error("Suggestion scan failed") : undefined, answer.result);
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
    this.closing = true;
    this.judgeAbort.abort();
    for (const queued of this.judgeQueue.splice(0)) queued.reject(new Error("Bridge judging closed"));
    for (const queued of this.bridgeQueue.splice(0)) queued.reject(new Error("Suggestion scanner closed"));
    const jobs = [...this.jobs];
    for (const job of jobs) {
      clearTimeout(job.idle);
      job.reject?.(new Error("Suggestion scanner closed"));
    }
    await Promise.all([...this.retiring, ...jobs.map(job => job.worker.terminate())]);
    await Promise.allSettled(this.judging);
    this.jobs.length = 0;
  }
}
