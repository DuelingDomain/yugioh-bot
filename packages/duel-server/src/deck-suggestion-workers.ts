import { Worker } from "node:worker_threads";
import type Database from "better-sqlite3";
import type { DeckSuggestionLegality, DeckSuggestionQuery, DeckSuggestionResult, CardEffectSearchResult } from "@yugidraft/shared/services";

type Job = { worker: Worker; reject?: (error: Error) => void };
export type SuggestionScan = { query: DeckSuggestionQuery; legality: DeckSuggestionLegality; deckMaster?: number };

/** Two reusable read-only scanners, isolated from live duel operations. The host owns admission. */
export class DeckSuggestionWorkers {
  private readonly jobs: Job[] = [];
  constructor(private readonly db: Database.Database, private readonly dataDirectory: string) {}

  run(scan: SuggestionScan): Promise<DeckSuggestionResult | CardEffectSearchResult> {
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
        const index = this.jobs.findIndex(job => job.worker === worker);
        if (index >= 0) this.jobs.splice(index, 1);
      });
    }
    const current = job;
    current.worker.ref();
    return new Promise((resolve, reject) => {
      const finish = (error?: Error, result?: DeckSuggestionResult | CardEffectSearchResult) => {
        clearTimeout(timer);
        current.worker.off("message", message);
        current.worker.off("error", fail);
        current.worker.off("exit", fail);
        current.reject = undefined;
        current.worker.unref();
        if (error) {
          const index = this.jobs.indexOf(current);
          if (index >= 0) this.jobs.splice(index, 1);
          void current.worker.terminate();
          reject(error);
        } else resolve(result!);
      };
      const fail = () => finish(new Error("Suggestion scanner stopped"));
      const message = (answer: { error?: boolean; result: DeckSuggestionResult | CardEffectSearchResult }) =>
        finish(answer.error ? new Error("Suggestion scan failed") : undefined, answer.result);
      const timer = setTimeout(fail, 30_000);
      current.reject = (error) => finish(error);
      current.worker.once("message", message);
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
    for (const job of jobs) job.reject?.(new Error("Suggestion scanner closed"));
    await Promise.all(jobs.map(job => job.worker.terminate()));
    this.jobs.length = 0;
  }
}
