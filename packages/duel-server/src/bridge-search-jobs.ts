import { createHash, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { bridgeGate, type ArchetypeBridge, type BridgeFormat, type EngineSuggestion } from "@yugidraft/shared/cards/effects";

export interface BridgeSearchQuery { source: string; target?: string; engines?: string[]; format: BridgeFormat; genesysRemaining?: number; deckCards?: number[] }
export interface BridgeSearchActor { userId: number; guildId: string }
export type BridgeJobState = "queued" | "running" | "done" | "failed";
export type BridgeJobStep = "candidates" | "checking" | "rating" | "done";
interface JobRow {
  id: string; query_key: string; query_json: string; state: BridgeJobState; step: BridgeJobStep; progress: number;
  result_json: string; review_incomplete: number | null; error: string | null; created_at: number; ended_at: number | null;
}
type BridgeProjection = { results: unknown[]; inReview: number; next?: EngineSuggestion[] };
interface JobOptions {
  execute(query: BridgeSearchQuery, progress: (step: BridgeJobStep, value: number) => void): Promise<ArchetypeBridge[] | { rows: ArchetypeBridge[]; reviewIncomplete: boolean }>;
  project(rows: ArchetypeBridge[], query: BridgeSearchQuery): BridgeProjection | Promise<BridgeProjection>;
  version(): string;
  now?: () => number;
  completionTimeoutMs?: number;
}
export class BridgeJobError extends Error {
  constructor(message: string, readonly status: number, readonly retryAfter?: number) { super(message); }
}
export class BridgeReviewUnavailableError extends Error {
  constructor() { super("Review service unavailable, try later."); }
}

/** Admission and completed-query reuse survive host restarts; only the active queue is in memory. */
export class BridgeSearchJobs {
  private readonly active = new Set<string>();
  private readonly running = new Set<Promise<void>>();
  private readonly failedCompletions = new Map<string, string>();
  private stopped = false;
  private drainTimer?: ReturnType<typeof setTimeout>;
  private readonly now: () => number;
  constructor(private readonly db: Database.Database, private readonly options: JobOptions) {
    this.now = options.now ?? Date.now;
    db.exec(`CREATE TABLE IF NOT EXISTS bridge_deep_job (
      id TEXT PRIMARY KEY, query_key TEXT NOT NULL, query_json TEXT NOT NULL,
      state TEXT NOT NULL, step TEXT NOT NULL, progress INTEGER NOT NULL DEFAULT 0,
      result_json TEXT NOT NULL DEFAULT '[]', review_incomplete INTEGER, error TEXT, created_at INTEGER NOT NULL, ended_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS bridge_deep_query ON bridge_deep_job(query_key,created_at DESC);
    CREATE TABLE IF NOT EXISTS bridge_deep_actor (
      job_id TEXT NOT NULL REFERENCES bridge_deep_job(id) ON DELETE CASCADE,
      actor_hash TEXT NOT NULL, guild_id TEXT NOT NULL, admitted_at INTEGER NOT NULL, ended_at INTEGER, genesys_remaining INTEGER, deck_cards_json TEXT,
      PRIMARY KEY(job_id,actor_hash,guild_id)
    );
    CREATE INDEX IF NOT EXISTS bridge_deep_user ON bridge_deep_actor(actor_hash,admitted_at DESC);`);
    if (!(db.prepare("PRAGMA table_info(bridge_deep_job)").all() as { name: string }[]).some(column => column.name === "review_incomplete")) {
      db.exec("ALTER TABLE bridge_deep_job ADD COLUMN review_incomplete INTEGER");
    }
    db.transaction(() => {
      const now = this.now();
      db.prepare("UPDATE bridge_deep_actor SET ended_at=? WHERE job_id IN (SELECT id FROM bridge_deep_job WHERE state IN ('queued','running'))").run(now);
      db.prepare("UPDATE bridge_deep_job SET state='failed',error=?,ended_at=? WHERE state IN ('queued','running')").run("Bridge search was interrupted. Try again shortly.", now);
      db.prepare("DELETE FROM bridge_deep_actor WHERE job_id IN (SELECT id FROM bridge_deep_job WHERE ended_at<?)").run(now - 172_800_000);
      db.prepare("DELETE FROM bridge_deep_job WHERE ended_at<?").run(now - 172_800_000);
    }).immediate();
  }

  private actorHash(actor: BridgeSearchActor): string { return createHash("sha256").update(`bridge-user:${actor.userId}`).digest("hex"); }
  private queryKey(query: BridgeSearchQuery): string {
    const engines = query.engines?.map(name => name.toLowerCase()).sort();
    const tuple = engines && engines.length >= 2 ? [this.options.version(), "multi-v2", engines, query.format]
      : [this.options.version(), engines?.[0] ?? query.source.toLowerCase(), query.target?.toLowerCase() ?? null, query.format];
    return createHash("sha256").update(JSON.stringify(tuple)).digest("hex");
  }

  start(actor: BridgeSearchActor, query: BridgeSearchQuery) {
    if (this.stopped) throw new BridgeJobError("Bridge search is restarting", 503);
    const key = this.queryKey(query), now = this.now();
    const cached = this.db.prepare("SELECT * FROM bridge_deep_job WHERE query_key=? AND state='done' AND ended_at>? ORDER BY ended_at DESC LIMIT 1").get(key, now - 86_400_000) as JobRow | undefined;
    // Evidence validation can be expensive; keep it outside the admission write lock.
    // Permanent reviews are complete, even though the UI still hides those rows.
    // Only intentionally bounded multi work gets full-day reuse. Failed attempted
    // reviews retry after ten minutes; legacy rows without metadata are checked.
    const incomplete = cached && (cached.review_incomplete === 1 || cached.review_incomplete === null
      && (JSON.parse(cached.result_json) as ArchetypeBridge[]).some(row => bridgeGate(this.db, row).state === "pending"));
    const admitted = this.db.transaction(() => {
      const hash = this.actorHash(actor);
      const failed = JSON.stringify([...this.failedCompletions.keys()]);
      const existing = this.db.prepare(`SELECT j.* FROM bridge_deep_job j JOIN bridge_deep_actor a ON a.job_id=j.id
        WHERE a.actor_hash=? AND j.state IN ('queued','running') AND j.id NOT IN (SELECT value FROM json_each(?))
        ORDER BY j.created_at LIMIT 1`).get(hash, failed) as JobRow | undefined;
      const subscribe = (job: JobRow, cached: boolean) => {
        this.db.prepare("INSERT OR IGNORE INTO bridge_deep_actor(job_id,actor_hash,guild_id,admitted_at,ended_at,genesys_remaining,deck_cards_json) VALUES(?,?,?,?,?,?,?)")
          .run(job.id, hash, actor.guildId, now, job.ended_at, query.genesysRemaining ?? null, query.deckCards ? JSON.stringify(query.deckCards) : null);
        this.db.prepare("UPDATE bridge_deep_actor SET genesys_remaining=?,deck_cards_json=? WHERE job_id=? AND actor_hash=? AND guild_id=?")
          .run(query.genesysRemaining ?? null, query.deckCards ? JSON.stringify(query.deckCards) : null, job.id, hash, actor.guildId);
        return { jobId: job.id, state: job.state, cached };
      };
      if (existing) {
        if (existing.query_key !== key) {
          const running = JSON.parse(existing.query_json) as BridgeSearchQuery;
          throw new BridgeJobError(`A deep search for ${running.engines?.join(" + ") ?? running.source} is still running`, 409, 10);
        }
        return subscribe(existing, false);
      }
      if (cached) {
        if (!incomplete || cached.ended_at! > now - 600_000) return subscribe(cached, true);
      }
      const hour = this.db.prepare(`SELECT count(DISTINCT a.job_id) AS n,min(a.admitted_at) AS oldest FROM bridge_deep_actor a
        JOIN bridge_deep_job j ON j.id=a.job_id WHERE a.actor_hash=? AND a.admitted_at>? AND a.admitted_at<=coalesce(j.ended_at,a.admitted_at)`)
        .get(hash, now - 3_600_000) as { n: number; oldest: number | null };
      if (hour.n >= 15) throw new BridgeJobError("Deep search hourly limit reached", 429, Math.max(1, Math.ceil((hour.oldest! + 3_600_000 - now) / 1000)));
      const pending = this.db.prepare(`SELECT * FROM bridge_deep_job WHERE query_key=? AND state IN ('queued','running')
        AND id NOT IN (SELECT value FROM json_each(?)) ORDER BY created_at LIMIT 1`).get(key, failed) as JobRow | undefined;
      if (pending) return subscribe(pending, false);
      const queued = this.db.prepare("SELECT count(*) AS n FROM bridge_deep_job WHERE state='queued'").get() as { n: number };
      if (queued.n >= 100) throw new BridgeJobError("Bridge search queue is busy", 503, 10);
      const id = randomUUID();
      const workQuery = { source: query.engines?.[0] ?? query.source, format: query.format, ...(query.target ? { target: query.target } : {}),
        ...(query.engines && query.engines.length > 1 ? { engines: query.engines } : {}) };
      this.db.prepare("INSERT INTO bridge_deep_job(id,query_key,query_json,state,step,created_at) VALUES(?,?,?,'queued','candidates',?)")
        .run(id, key, JSON.stringify(workQuery), now);
      this.db.prepare("INSERT INTO bridge_deep_actor(job_id,actor_hash,guild_id,admitted_at,genesys_remaining,deck_cards_json) VALUES(?,?,?,?,?,?)")
        .run(id, hash, actor.guildId, now, query.genesysRemaining ?? null, query.deckCards ? JSON.stringify(query.deckCards) : null);
      return { jobId: id, state: "queued" as BridgeJobState, cached: false };
    }).immediate();
    this.drain();
    return { ...admitted, state: (this.db.prepare("SELECT state FROM bridge_deep_job WHERE id=?").get(admitted.jobId) as JobRow).state };
  }

  async status(actor: BridgeSearchActor, jobId: string) {
    const row = this.db.prepare(`SELECT j.*,a.genesys_remaining,a.deck_cards_json FROM bridge_deep_job j JOIN bridge_deep_actor a ON a.job_id=j.id
      WHERE j.id=? AND a.actor_hash=? AND a.guild_id=?`).get(jobId, this.actorHash(actor), actor.guildId) as JobRow & { genesys_remaining: number | null; deck_cards_json: string | null } | undefined;
    if (!row) throw new BridgeJobError("Not found", 404);
    const failed = this.failedCompletions.get(row.id);
    if (failed) { row.state = "failed"; row.error = failed; }
    const query = { ...JSON.parse(row.query_json) as BridgeSearchQuery, genesysRemaining: row.genesys_remaining ?? undefined,
      deckCards: row.deck_cards_json ? JSON.parse(row.deck_cards_json) as number[] : undefined };
    if (row.query_key !== this.queryKey(query)) throw new BridgeJobError("Not found", 404);
    const visible = row.state === "done" ? await this.options.project(JSON.parse(row.result_json), query) : { results: [], inReview: 0 };
    return { jobId: row.id, state: row.state, step: row.step, progress: row.progress,
      engines: query.engines ?? [query.source], next: [], ...visible, ...(row.error ? { error: row.error } : {}) };
  }

  /** Status writes must never wait five seconds for a web/bot writer on the duel loop. */
  private writeWithoutWaiting<T>(write: () => T): T {
    const timeout = this.db.pragma("busy_timeout", { simple: true }) as number;
    this.db.pragma("busy_timeout = 0");
    try { return write(); } finally { this.db.pragma(`busy_timeout = ${timeout}`); }
  }

  private drain(): void {
    try { this.drainReady(); }
    catch {
      console.warn("Bridge job queue write failed; retrying.");
      if (!this.stopped && !this.drainTimer) this.drainTimer = setTimeout(() => {
        this.drainTimer = undefined; this.drain();
      }, 250);
    }
  }

  private drainReady(): void {
    if (this.stopped) return;
    while (this.active.size < 2) {
      const row = this.db.prepare("SELECT * FROM bridge_deep_job WHERE state='queued' ORDER BY created_at,id LIMIT 1").get() as JobRow | undefined;
      if (!row) break;
      this.writeWithoutWaiting(() => this.db.prepare("UPDATE bridge_deep_job SET state='running' WHERE id=?").run(row.id));
      this.active.add(row.id);
      let last = { step: row.step, value: row.progress, at: -Infinity };
      const progress = (step: BridgeJobStep, value: number) => {
        const next = Math.max(last.value, Math.max(0, Math.min(99, Math.floor(value)))), now = this.now();
        if (last.step === step && last.value === next || now - last.at < 1000) return;
        last.at = now;
        try {
          this.writeWithoutWaiting(() => this.db.prepare("UPDATE bridge_deep_job SET step=?,progress=max(progress,?) WHERE id=? AND state='running'")
            .run(step, next, row.id));
          last = { step, value: next, at: now };
        } catch { /* Progress is best effort; completion persists the final state. */ }
      };
      const work = (async () => {
        let result: ArchetypeBridge[] = [], error: string | null = null, reviewIncomplete: number | null = null;
        try {
          const outcome = await this.options.execute(JSON.parse(row.query_json), progress);
          result = Array.isArray(outcome) ? outcome : outcome.rows;
          reviewIncomplete = Array.isArray(outcome) ? null : Number(outcome.reviewIncomplete);
        }
        catch (cause) { error = cause instanceof BridgeReviewUnavailableError ? cause.message : "Bridge search could not finish. Try again shortly."; }
        let warned = false;
        const deadline = performance.now() + (this.options.completionTimeoutMs ?? 5000);
        const resultJson = JSON.stringify(result);
        for (;;) {
          try {
            this.writeWithoutWaiting(() => this.db.transaction(() => {
              const now = this.now();
              this.db.prepare("UPDATE bridge_deep_job SET state=?,step=CASE WHEN ? THEN step ELSE 'done' END,progress=CASE WHEN ? THEN progress ELSE 100 END,result_json=?,review_incomplete=?,error=?,ended_at=? WHERE id=? AND state='running'")
                .run(error ? "failed" : "done", error ? 1 : 0, error ? 1 : 0, resultJson, reviewIncomplete, error, now, row.id);
              this.db.prepare("UPDATE bridge_deep_actor SET ended_at=? WHERE job_id=? AND ended_at IS NULL").run(now, row.id);
            }).immediate());
            break;
          } catch {
            if (!warned) console.warn("Bridge job completion write failed; retrying.", { jobId: row.id });
            warned = true;
            if (this.stopped) break; // Startup recovery fails interrupted jobs after shutdown.
            if (performance.now() >= deadline) {
              const message = "Bridge search completion could not be saved. Try again shortly.";
              this.failedCompletions.set(row.id, message);
              // The disk may reject every write. Memory remains authoritative
              // until startup recovery can persist the interruption.
              try {
                this.writeWithoutWaiting(() => this.db.transaction(() => {
                  this.db.prepare("UPDATE bridge_deep_job SET state='failed',error=?,ended_at=? WHERE id=?").run(message, this.now(), row.id);
                  this.db.prepare("UPDATE bridge_deep_actor SET ended_at=? WHERE job_id=? AND ended_at IS NULL").run(this.now(), row.id);
                }).immediate());
              } catch { /* Keep the terminal state available without holding a slot. */ }
              console.warn("Bridge job completion deadline exceeded.", { jobId: row.id });
              break;
            }
            await new Promise(resolve => setTimeout(resolve, Math.min(250, Math.max(1, deadline - performance.now()))));
          }
        }
      })().finally(() => { this.active.delete(row.id); this.running.delete(work); this.drain(); })
        .catch(() => { console.warn("Bridge job failed to settle.", { jobId: row.id }); });
      this.running.add(work);
    }
  }

  async close(): Promise<void> { this.stopped = true; clearTimeout(this.drainTimer); await Promise.allSettled(this.running); }
}
