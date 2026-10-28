import { createHash, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { ArchetypeBridge, BridgeFormat } from "@yugidraft/shared/cards/effects";

export interface BridgeSearchQuery { source: string; target?: string; format: BridgeFormat; genesysRemaining?: number; deckCards?: number[] }
export interface BridgeSearchActor { userId: number; guildId: string }
export type BridgeJobState = "queued" | "running" | "done" | "failed";
export type BridgeJobStep = "candidates" | "checking" | "rating" | "done";
interface JobRow {
  id: string; query_key: string; query_json: string; state: BridgeJobState; step: BridgeJobStep; progress: number;
  result_json: string; error: string | null; created_at: number; ended_at: number | null;
}
interface JobOptions {
  execute(query: BridgeSearchQuery, progress: (step: BridgeJobStep, value: number) => void): Promise<ArchetypeBridge[]>;
  project(rows: ArchetypeBridge[], query: BridgeSearchQuery): { results: unknown[]; inReview: number };
  version(): string;
  now?: () => number;
}
export class BridgeJobError extends Error {
  constructor(message: string, readonly status: number, readonly retryAfter?: number) { super(message); }
}

/** Admission and completed-query reuse survive host restarts; only the active queue is in memory. */
export class BridgeSearchJobs {
  private readonly active = new Set<string>();
  private readonly running = new Set<Promise<void>>();
  private stopped = false;
  private readonly now: () => number;
  constructor(private readonly db: Database.Database, private readonly options: JobOptions) {
    this.now = options.now ?? Date.now;
    db.exec(`CREATE TABLE IF NOT EXISTS bridge_deep_job (
      id TEXT PRIMARY KEY, query_key TEXT NOT NULL, query_json TEXT NOT NULL,
      state TEXT NOT NULL, step TEXT NOT NULL, progress INTEGER NOT NULL DEFAULT 0,
      result_json TEXT NOT NULL DEFAULT '[]', error TEXT, created_at INTEGER NOT NULL, ended_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS bridge_deep_query ON bridge_deep_job(query_key,created_at DESC);
    CREATE TABLE IF NOT EXISTS bridge_deep_actor (
      job_id TEXT NOT NULL REFERENCES bridge_deep_job(id) ON DELETE CASCADE,
      actor_hash TEXT NOT NULL, guild_id TEXT NOT NULL, admitted_at INTEGER NOT NULL, ended_at INTEGER, genesys_remaining INTEGER, deck_cards_json TEXT,
      PRIMARY KEY(job_id,actor_hash,guild_id)
    );
    CREATE INDEX IF NOT EXISTS bridge_deep_user ON bridge_deep_actor(actor_hash,admitted_at DESC);`);
    db.transaction(() => {
      const now = this.now();
      db.prepare("UPDATE bridge_deep_actor SET ended_at=? WHERE job_id IN (SELECT id FROM bridge_deep_job WHERE state IN ('queued','running'))").run(now);
      db.prepare("UPDATE bridge_deep_job SET state='failed',error=?,ended_at=? WHERE state IN ('queued','running')").run("Bridge search was interrupted. Try again shortly.", now);
      db.prepare("DELETE FROM bridge_deep_actor WHERE job_id IN (SELECT id FROM bridge_deep_job WHERE ended_at<?)").run(now - 172_800_000);
      db.prepare("DELETE FROM bridge_deep_job WHERE ended_at<?").run(now - 172_800_000);
    }).immediate();
  }

  private actorHash(actor: BridgeSearchActor): string { return createHash("sha256").update(`bridge-user:${actor.userId}`).digest("hex"); }
  start(actor: BridgeSearchActor, query: BridgeSearchQuery) {
    if (this.stopped) throw new BridgeJobError("Bridge search is restarting", 503);
    const admitted = this.db.transaction(() => {
      const hash = this.actorHash(actor), now = this.now();
      const existing = this.db.prepare(`SELECT j.* FROM bridge_deep_job j JOIN bridge_deep_actor a ON a.job_id=j.id
        WHERE a.actor_hash=? AND j.state IN ('queued','running') ORDER BY j.created_at LIMIT 1`).get(hash) as JobRow | undefined;
      const subscribe = (job: JobRow, cached: boolean) => {
        this.db.prepare("INSERT OR IGNORE INTO bridge_deep_actor(job_id,actor_hash,guild_id,admitted_at,ended_at,genesys_remaining,deck_cards_json) VALUES(?,?,?,?,?,?,?)")
          .run(job.id, hash, actor.guildId, now, job.ended_at, query.genesysRemaining ?? null, query.deckCards ? JSON.stringify(query.deckCards) : null);
        this.db.prepare("UPDATE bridge_deep_actor SET genesys_remaining=?,deck_cards_json=? WHERE job_id=? AND actor_hash=? AND guild_id=?")
          .run(query.genesysRemaining ?? null, query.deckCards ? JSON.stringify(query.deckCards) : null, job.id, hash, actor.guildId);
        return { jobId: job.id, state: job.state, cached };
      };
      const key = createHash("sha256").update(JSON.stringify([this.options.version(), query.source.toLowerCase(), query.target?.toLowerCase() ?? null, query.format])).digest("hex");
      if (existing) {
        if (existing.query_key !== key) {
          const running = JSON.parse(existing.query_json) as BridgeSearchQuery;
          throw new BridgeJobError(`A deep search for ${running.source} is still running`, 409, 10);
        }
        return subscribe(existing, false);
      }
      const cached = this.db.prepare("SELECT * FROM bridge_deep_job WHERE query_key=? AND state='done' AND ended_at>? ORDER BY ended_at DESC LIMIT 1").get(key, now - 86_400_000) as JobRow | undefined;
      if (cached) return subscribe(cached, true);
      const last = this.db.prepare("SELECT max(ended_at) AS ended FROM bridge_deep_actor WHERE actor_hash=?").get(hash) as { ended: number | null };
      if (last.ended !== null && now - last.ended < 60_000) throw new BridgeJobError("Please wait before starting another deep search", 429, Math.ceil((60_000 - (now - last.ended)) / 1000));
      const hour = this.db.prepare(`SELECT count(DISTINCT a.job_id) AS n,min(a.admitted_at) AS oldest FROM bridge_deep_actor a
        JOIN bridge_deep_job j ON j.id=a.job_id WHERE a.actor_hash=? AND a.admitted_at>? AND a.admitted_at<=coalesce(j.ended_at,a.admitted_at)`)
        .get(hash, now - 3_600_000) as { n: number; oldest: number | null };
      if (hour.n >= 10) throw new BridgeJobError("Deep search hourly limit reached", 429, Math.max(1, Math.ceil((hour.oldest! + 3_600_000 - now) / 1000)));
      const pending = this.db.prepare("SELECT * FROM bridge_deep_job WHERE query_key=? AND state IN ('queued','running') ORDER BY created_at LIMIT 1").get(key) as JobRow | undefined;
      if (pending) return subscribe(pending, false);
      const queued = this.db.prepare("SELECT count(*) AS n FROM bridge_deep_job WHERE state='queued'").get() as { n: number };
      if (queued.n >= 100) throw new BridgeJobError("Bridge search queue is busy", 429, 10);
      const id = randomUUID();
      this.db.prepare("INSERT INTO bridge_deep_job(id,query_key,query_json,state,step,created_at) VALUES(?,?,?,'queued','candidates',?)")
        .run(id, key, JSON.stringify(query), now);
      this.db.prepare("INSERT INTO bridge_deep_actor(job_id,actor_hash,guild_id,admitted_at,genesys_remaining,deck_cards_json) VALUES(?,?,?,?,?,?)")
        .run(id, hash, actor.guildId, now, query.genesysRemaining ?? null, query.deckCards ? JSON.stringify(query.deckCards) : null);
      return { jobId: id, state: "queued" as BridgeJobState, cached: false };
    }).immediate();
    this.drain();
    return { ...admitted, state: (this.db.prepare("SELECT state FROM bridge_deep_job WHERE id=?").get(admitted.jobId) as JobRow).state };
  }

  status(actor: BridgeSearchActor, jobId: string) {
    const row = this.db.prepare(`SELECT j.*,a.genesys_remaining,a.deck_cards_json FROM bridge_deep_job j JOIN bridge_deep_actor a ON a.job_id=j.id
      WHERE j.id=? AND a.actor_hash=? AND a.guild_id=?`).get(jobId, this.actorHash(actor), actor.guildId) as JobRow & { genesys_remaining: number | null; deck_cards_json: string | null } | undefined;
    if (!row) throw new BridgeJobError("Not found", 404);
    const query = { ...JSON.parse(row.query_json) as BridgeSearchQuery, genesysRemaining: row.genesys_remaining ?? undefined,
      deckCards: row.deck_cards_json ? JSON.parse(row.deck_cards_json) as number[] : undefined };
    const visible = row.state === "done" ? this.options.project(JSON.parse(row.result_json), query) : { results: [], inReview: 0 };
    return { jobId: row.id, state: row.state, step: row.step, progress: row.progress, ...visible, ...(row.error ? { error: row.error } : {}) };
  }

  private drain(): void {
    if (this.stopped) return;
    while (this.active.size < 2) {
      const row = this.db.prepare("SELECT * FROM bridge_deep_job WHERE state='queued' ORDER BY created_at,id LIMIT 1").get() as JobRow | undefined;
      if (!row) break;
      this.db.prepare("UPDATE bridge_deep_job SET state='running' WHERE id=?").run(row.id);
      this.active.add(row.id);
      const progress = (step: BridgeJobStep, value: number) => {
        this.db.prepare("UPDATE bridge_deep_job SET step=?,progress=max(progress,?) WHERE id=? AND state='running'")
          .run(step, Math.max(0, Math.min(99, Math.floor(value))), row.id);
      };
      const work = (async () => {
        let result: ArchetypeBridge[] = [], error: string | null = null;
        try { result = await this.options.execute(JSON.parse(row.query_json), progress); }
        catch { error = "Bridge search could not finish. Try again shortly."; }
        this.db.transaction(() => {
          const now = this.now();
          this.db.prepare("UPDATE bridge_deep_job SET state=?,step=CASE WHEN ? THEN step ELSE 'done' END,progress=CASE WHEN ? THEN progress ELSE 100 END,result_json=?,error=?,ended_at=? WHERE id=? AND state='running'")
            .run(error ? "failed" : "done", error ? 1 : 0, error ? 1 : 0, JSON.stringify(result), error, now, row.id);
          this.db.prepare("UPDATE bridge_deep_actor SET ended_at=? WHERE job_id=? AND ended_at IS NULL").run(now, row.id);
        }).immediate();
      })().finally(() => { this.active.delete(row.id); this.running.delete(work); this.drain(); });
      this.running.add(work);
    }
  }

  async close(): Promise<void> { this.stopped = true; await Promise.allSettled(this.running); }
}
