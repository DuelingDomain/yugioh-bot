import type Database from "better-sqlite3";
import type { BridgeDeck, BridgeEnginesResponse } from "@yugidraft/shared/cards/effects";
import { BridgeJobError } from "./bridge-search-jobs.js";
import { validateBridgeEngineInput } from "./bridge-engine-queries.js";
import type { DeckSuggestionWorkers } from "./deck-suggestion-workers.js";
import { bridgeRevision } from "./bridge-revision.js";

type QueryWaiter = { deadline: number; abandoned: boolean };
type QueuedQuery = { key: string; input: Record<string, unknown>; guildId: string; waiters: Set<QueryWaiter>;
  work: Promise<BridgeEnginesResponse>; resolve: (result: BridgeEnginesResponse) => void; reject: (error: unknown) => void };

/** Bounded, read-only scanner work; short cache always rechecks the SQLite revision. */
export class BridgeFastQueries {
  private readonly cache = new Map<string, { revision: string; expires: number; result: BridgeEnginesResponse }>();
  private readonly pending = new Map<string, Promise<BridgeEnginesResponse>>();
  private readonly actors = new Map<number, { key: string; work: Promise<BridgeEnginesResponse>; next: Map<string, QueuedQuery> }>();
  constructor(private readonly db: Database.Database, private readonly workers: Pick<DeckSuggestionWorkers, "bridgeEngines">,
    private readonly now: () => number = Date.now) {}

  private revision(): string {
    return bridgeRevision(this.db);
  }

  run(input: Record<string, unknown>, guildId: string, userId: number, deadline = performance.now() + 4500, signal?: AbortSignal): Promise<BridgeEnginesResponse> {
    // Each caller keeps its own deadline even when joining existing work.
    return new Promise((resolve, reject) => {
      const waiter: QueryWaiter = { deadline, abandoned: false };
      const abandon = () => {
        waiter.abandoned = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", abandon);
        reject(new BridgeJobError("Engine suggestions are busy", 503, 1));
      };
      const timer = setTimeout(abandon, Math.max(1, deadline - performance.now()));
      signal?.addEventListener("abort", abandon, { once: true });
      if (signal?.aborted) { abandon(); return; }
      void this.execute(input, guildId, userId, new Set([waiter])).then(result => {
        clearTimeout(timer); signal?.removeEventListener("abort", abandon); resolve(result);
      }, error => { clearTimeout(timer); signal?.removeEventListener("abort", abandon); reject(error); });
    });
  }

  private async execute(input: Record<string, unknown>, guildId: string, userId: number, waiters: Set<QueryWaiter>): Promise<BridgeEnginesResponse> {
    validateBridgeEngineInput(input);
    const deck = input.deck as BridgeDeck | undefined;
    const key = JSON.stringify([guildId, input.format ?? "advanced",
      input.engines ? [...new Set((input.engines as string[]).map(name => name.trim().toLowerCase()))].sort() : null,
      deck ? [[...deck.main].sort((a, b) => a - b), [...deck.extra].sort((a, b) => a - b), deck.deckMaster ?? null, deck.pointCap ?? 100] : null,
      input.genesysRemaining ?? null]);
    const revision = this.revision(), cached = this.cache.get(key);
    if (cached?.revision === revision && cached.expires > this.now()) return cached.result;
    const deadline = Math.max(...[...waiters].filter(waiter => !waiter.abandoned).map(waiter => waiter.deadline));
    if (performance.now() >= deadline) throw new BridgeJobError("Engine suggestions are busy", 503, 1);
    const workKey = JSON.stringify([key, revision]), actor = this.actors.get(userId);
    if (actor) {
      if (actor.key === workKey) return actor.work;
      for (const [key, queued] of actor.next) {
        if ([...queued.waiters].some(waiter => !waiter.abandoned && waiter.deadline > performance.now())) continue;
        actor.next.delete(key);
        queued.reject(new BridgeJobError("Engine suggestions were superseded", 503, 1));
      }
      const queued = actor.next.get(workKey);
      if (queued) {
        for (const waiter of waiters) queued.waiters.add(waiter);
        return queued.work;
      }
      // Detection and corrected engines are distinct live queries. Give each
      // key its own deferred, retaining the newest editor context on overload.
      if (actor.next.size >= 2) {
        const oldest = actor.next.values().next().value!;
        actor.next.delete(oldest.key);
        oldest.reject(new BridgeJobError("Engine suggestions were superseded", 503, 1));
      }
      let resolve!: QueuedQuery["resolve"], reject!: QueuedQuery["reject"];
      const work = new Promise<BridgeEnginesResponse>((yes, no) => { resolve = yes; reject = no; });
      actor.next.set(workKey, { key: workKey, input, guildId, waiters, work, resolve, reject });
      return work;
    }
    let work = this.pending.get(workKey);
    if (!work) {
      if (this.pending.size >= 8) throw new BridgeJobError("Engine suggestions are busy", 503, 1);
      work = Promise.resolve().then(() => this.workers.bridgeEngines(input, guildId, Math.max(1, deadline - performance.now()))).then(result => {
        if (this.revision() === revision) {
          this.cache.delete(key); this.cache.set(key, { revision, result, expires: this.now() + 5000 });
          if (this.cache.size > 64) this.cache.delete(this.cache.keys().next().value!);
        }
        return result;
      }).finally(() => { this.pending.delete(workKey); });
      this.pending.set(workKey, work);
    }
    const actorWork = work.finally(() => {
      const current = this.actors.get(userId);
      if (current?.work !== actorWork) return;
      this.actors.delete(userId);
      for (const next of current.next.values()) {
        if (![...next.waiters].some(waiter => !waiter.abandoned && waiter.deadline > performance.now())) {
          next.reject(new BridgeJobError("Engine suggestions were superseded", 503, 1));
          continue;
        }
        void this.execute(next.input, next.guildId, userId, next.waiters).then(next.resolve, next.reject);
      }
    });
    this.actors.set(userId, { key: workKey, work: actorWork, next: new Map() });
    return actorWork;
  }
}
