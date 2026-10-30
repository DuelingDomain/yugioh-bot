import type Database from "better-sqlite3";
import type { BridgeDeck, BridgeEnginesResponse } from "@yugidraft/shared/cards/effects";
import { BridgeJobError } from "./bridge-search-jobs.js";
import { validateBridgeEngineInput } from "./bridge-engine-queries.js";
import type { DeckSuggestionWorkers } from "./deck-suggestion-workers.js";

/** Bounded, read-only scanner work; short cache always rechecks the SQLite revision. */
export class BridgeFastQueries {
  private readonly cache = new Map<string, { revision: string; expires: number; result: BridgeEnginesResponse }>();
  private readonly pending = new Map<string, Promise<BridgeEnginesResponse>>();
  private readonly actors = new Map<number, { key: string; work: Promise<BridgeEnginesResponse> }>();
  constructor(private readonly db: Database.Database, private readonly workers: Pick<DeckSuggestionWorkers, "bridgeEngines">,
    private readonly now: () => number = Date.now) {}

  private revision(): string {
    return `${this.db.pragma("data_version", { simple: true })}:${(this.db.prepare("SELECT total_changes() AS n").get() as { n: number }).n}`;
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
      if (actor.key === workKey) return actor.work;
      throw new BridgeJobError("An engine suggestion request is still running", 429, 1);
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
    const actorWork = work.finally(() => { this.actors.delete(userId); });
    this.actors.set(userId, { key: workKey, work: actorWork });
    return actorWork;
  }
}
