import type Database from "better-sqlite3";
import type { BridgeDeck, BridgeEnginesResponse } from "@yugidraft/shared/cards/effects";
import { BridgeJobError } from "./bridge-search-jobs.js";
import { validateBridgeEngineInput } from "./bridge-engine-queries.js";
import type { DeckSuggestionWorkers } from "./deck-suggestion-workers.js";
import { bridgeRevision } from "./bridge-revision.js";

type QueuedQuery = { key: string; input: Record<string, unknown>; guildId: string;
  work: Promise<BridgeEnginesResponse>; resolve: (result: BridgeEnginesResponse) => void; reject: (error: unknown) => void };

/** Bounded, read-only scanner work; short cache always rechecks the SQLite revision. */
export class BridgeFastQueries {
  private readonly cache = new Map<string, { revision: string; expires: number; result: BridgeEnginesResponse }>();
  private readonly pending = new Map<string, Promise<BridgeEnginesResponse>>();
  private readonly actors = new Map<number, { key: string; work: Promise<BridgeEnginesResponse>; next?: QueuedQuery }>();
  constructor(private readonly db: Database.Database, private readonly workers: Pick<DeckSuggestionWorkers, "bridgeEngines">,
    private readonly now: () => number = Date.now) {}

  private revision(): string {
    return bridgeRevision(this.db);
  }

  async run(input: Record<string, unknown>, guildId: string, userId: number): Promise<BridgeEnginesResponse> {
    validateBridgeEngineInput(input);
    const deck = input.deck as BridgeDeck | undefined;
    const key = JSON.stringify([guildId, input.format ?? "advanced",
      input.engines ? [...new Set((input.engines as string[]).map(name => name.trim().toLowerCase()))].sort() : null,
      deck ? [[...deck.main].sort((a, b) => a - b), [...deck.extra].sort((a, b) => a - b), deck.deckMaster ?? null, deck.pointCap ?? 100] : null,
      input.genesysRemaining ?? null]);
    const revision = this.revision(), cached = this.cache.get(key);
    if (cached?.revision === revision && cached.expires > this.now()) return cached.result;
    const workKey = JSON.stringify([key, revision]), actor = this.actors.get(userId);
    if (actor) {
      if (actor.key === workKey) {
        if (actor.next) {
          void actor.work.then(actor.next.resolve, actor.next.reject);
          actor.next = undefined;
        }
        return actor.work;
      }
      // Aborting a browser fetch does not cancel its worker. Retain just the
      // newest edit behind that work; superseded waiters receive its answer.
      if (actor.next) {
        Object.assign(actor.next, { key: workKey, input, guildId });
      } else {
        let resolve!: QueuedQuery["resolve"], reject!: QueuedQuery["reject"];
        const work = new Promise<BridgeEnginesResponse>((yes, no) => { resolve = yes; reject = no; });
        actor.next = { key: workKey, input, guildId, work, resolve, reject };
      }
      return actor.next.work;
    }
    let work = this.pending.get(workKey);
    if (!work) {
      if (this.pending.size >= 8) throw new BridgeJobError("Engine suggestions are busy", 503, 1);
      work = Promise.resolve().then(() => this.workers.bridgeEngines(input, guildId)).then(result => {
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
      if (current.next) void this.run(current.next.input, current.next.guildId, userId).then(current.next.resolve, current.next.reject);
    });
    this.actors.set(userId, { key: workKey, work: actorWork });
    return actorWork;
  }
}
