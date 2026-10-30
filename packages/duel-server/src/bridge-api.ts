import type Database from "better-sqlite3";
import { bridgeGate, BRIDGE_JUDGE_IDENTITIES, BRIDGE_JUDGE_VERSION, shownBridge, type ArchetypeBridge, type BridgeGraphData } from "@yugidraft/shared/cards/effects";
import { createBridgeService, createSavedDeckService } from "@yugidraft/shared/services";
import { isOwnerUser } from "@yugidraft/shared/access/owner-access";
import { createHash } from "node:crypto";
import { BridgeJobError, BridgeReviewUnavailableError, BridgeSearchJobs, type BridgeSearchQuery } from "./bridge-search-jobs.js";
import type { DeckSuggestionWorkers } from "./deck-suggestion-workers.js";
import { BridgeEngineQueries } from "./bridge-engine-queries.js";
import { BridgeFastQueries } from "./bridge-fast-queries.js";
import { searchBridgeEngines } from "./bridge-multi-search.js";
import { bridgeRevision } from "./bridge-revision.js";

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const name = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= 160;
const hash = (userId: number) => createHash("sha256").update(`bridge-user:${userId}`).digest("hex");

export class BridgeApi {
  readonly jobs: BridgeSearchJobs;
  private readonly service;
  private readonly engineQueries: BridgeEngineQueries;
  private readonly fastQueries: BridgeFastQueries;
  private graph?: { source_version: string; groups: BridgeGraphData["groups"] };
  private readonly storedCache = new Map<string, { revision: string; rows: ArchetypeBridge[] }>();
  constructor(private readonly db: Database.Database, workers: Pick<DeckSuggestionWorkers, "bridgeCandidates" | "rateBridge" | "bridgeEngines" | "bridgeEngineProjection" | "bridgeEngineShortlist">, now?: () => number) {
    this.service = createBridgeService(db);
    this.engineQueries = new BridgeEngineQueries(db);
    this.fastQueries = new BridgeFastQueries(db, workers, now);
    this.jobs = new BridgeSearchJobs(db, {
      now, version: () => `${this.groups().source_version}:${BRIDGE_JUDGE_VERSION}`,
      project: async (rows, query) => {
        const multi = await workers.bridgeEngineProjection(rows, { ...query, engines: query.engines ?? [query.source] });
        return query.engines ? { results: [], ...multi } : { ...this.project(rows, query, true), next: multi.next };
      },
      execute: async (query, progress) => {
        if (query.engines) return searchBridgeEngines(this.db, workers, { ...query, engines: query.engines }, progress);
        const result = await workers.bridgeCandidates({ kind: "bridges", source: query.source, format: query.format,
          ...(query.target ? { op: "explain", target: query.target } : { op: "live" }) }, value => {
          progress("candidates", Math.floor(25 * value.completed / Math.max(1, value.total)));
        });
        const rows = this.service.deepTargets(Array.isArray(result) ? result : result ? [result] : [], 25);
        progress("checking", 30);
        const version = this.groups().source_version;
        this.db.transaction(() => {
          const save = this.db.prepare(`INSERT INTO archetype_bridge(source,target,format,score,grade,bridge_json,evidence_hash,source_version)
            VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(source,target,format) DO UPDATE SET score=excluded.score,grade=excluded.grade,
            bridge_json=excluded.bridge_json,evidence_hash=excluded.evidence_hash,source_version=excluded.source_version`);
          for (const row of rows) save.run(row.source, row.target, row.format, row.score, row.grade, JSON.stringify(row), row.evidence_hash, version);
        }).immediate();
        const candidates = rows.filter(row => bridgeGate(this.db, row).state === "pending").slice(0, 10);
        const previousReviews = new Set(candidates.flatMap(row => bridgeGate(this.db, row).judgements.map(review => review.judge)));
        let next = 0, completed = 0;
        progress("rating", 35);
        await Promise.all(Array.from({ length: Math.min(2, candidates.length) }, async () => {
          while (next < candidates.length) {
            const row = candidates[next++]!;
            await workers.rateBridge(row);
            progress("rating", 35 + Math.floor(64 * ++completed / candidates.length));
          }
        }));
        if (candidates.length && !candidates.some(row => bridgeGate(this.db, row).judgements.some(review => !previousReviews.has(review.judge)))
          && !rows.some(row => bridgeGate(this.db, row).state === "shown")) throw new BridgeReviewUnavailableError();
        return rows;
      },
    });
  }

  private groups() {
    const row = this.db.prepare("SELECT source_version FROM bridge_graph WHERE id=1").get() as { source_version: string } | undefined;
    if (!row) throw new BridgeJobError("Bridge data is unavailable", 503);
    if (this.graph?.source_version !== row.source_version) {
      const graph = this.db.prepare("SELECT graph_json FROM bridge_graph WHERE id=1").get() as { graph_json: string };
      this.graph = { source_version: row.source_version, groups: (JSON.parse(graph.graph_json) as BridgeGraphData).groups };
    }
    return this.graph!;
  }

  private query(input: Record<string, unknown>, guildId: string, userId: number): BridgeSearchQuery {
    const allowed = ["op", "source", "deckId", "target", "format", "genesysRemaining"];
    if (Object.keys(input).some(key => !allowed.includes(key)) || (input.source === undefined) === (input.deckId === undefined)
      || (input.source !== undefined && !name(input.source)) || (input.target !== undefined && !name(input.target))
      || (input.format !== undefined && input.format !== "advanced" && input.format !== "genesys")
      || (input.genesysRemaining !== undefined && (!Number.isSafeInteger(input.genesysRemaining) || Number(input.genesysRemaining) < 0 || Number(input.genesysRemaining) > 1000))) {
      throw new BridgeJobError("Invalid bridge query", 400);
    }
    const { groups } = this.groups();
    let source = input.source as string | undefined, remaining = input.genesysRemaining as number | undefined, deckCards: number[] | undefined;
    if (input.deckId !== undefined) {
      if (!Number.isSafeInteger(input.deckId) || Number(input.deckId) <= 0) throw new BridgeJobError("Invalid deck", 400);
      let saved;
      try { saved = createSavedDeckService(this.db).get(Number(input.deckId), guildId, userId); }
      catch { throw new BridgeJobError("Deck not found", 404); }
      const cards = new Set(saved.deck.main);
      source = Object.entries(groups).map(([key, ids]) => ({ key, count: ids.filter(id => cards.has(id)).length }))
        .filter(row => row.count > 0).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))[0]?.key;
      if (!source) throw new BridgeJobError("The deck needs an archetype before searching bridges", 400);
      if (input.format === "genesys") {
        deckCards = [...saved.deck.main, ...saved.deck.extra, ...saved.deck.side];
        if (remaining === undefined) {
          let spent = 0;
          for (const id of deckCards) {
            const row = this.db.prepare("SELECT capabilities_json FROM card_capability WHERE passcode=?").get(id) as { capabilities_json: string } | undefined;
            const points = row ? JSON.parse(row.capabilities_json).card.genesysPoints as number | undefined : undefined;
            if (points === undefined) throw new BridgeJobError("Genesys points are unavailable for this deck", 400);
            spent += points;
          }
          remaining = (saved.genesys?.pointCap ?? 100) - spent;
        }
      }
    }
    const canonical = (value: string) => Object.keys(groups).find(key => key.toLowerCase() === value.trim().toLowerCase());
    const resolved = canonical(source!);
    const target = input.target === undefined ? undefined : canonical(input.target as string);
    if (!resolved || input.target !== undefined && !target) throw new BridgeJobError("Unknown archetype", 400);
    if (resolved === target) throw new BridgeJobError("Choose two different archetypes", 400);
    return { source: resolved, ...(target ? { target } : {}), format: input.format === "genesys" ? "genesys" : "advanced",
      ...(remaining === undefined ? {} : { genesysRemaining: remaining }), ...(deckCards ? { deckCards } : {}) };
  }

  private incrementalPoints(row: ArchetypeBridge, query: BridgeSearchQuery): number {
    if (!query.deckCards) return row.genesys_points ?? Infinity;
    let total = 0;
    for (const id of row.cards) {
      const required = Math.max(1, ...row.reasons.map(reason => reason.materials?.filter(code => code === id).length ?? 0));
      const missing = Math.max(0, required - query.deckCards.filter(code => code === id).length);
      if (!missing) continue;
      const stored = this.db.prepare("SELECT capabilities_json FROM card_capability WHERE passcode=?").get(id) as { capabilities_json: string } | undefined;
      const points = stored ? JSON.parse(stored.capabilities_json).card.genesysPoints as number | undefined : undefined;
      if (points === undefined) return Infinity;
      total += points * missing;
    }
    return total;
  }

  private storedRows(source: string, target: string | undefined, format: BridgeSearchQuery["format"]): ArchetypeBridge[] {
    const revision = bridgeRevision(this.db);
    const key = JSON.stringify([source, target, format]), cached = this.storedCache.get(key);
    if (cached?.revision === revision) return cached.rows;
    const pair = target ? this.service.bridgeBetween(source, target, format) : null;
    const rows = target ? pair ? [pair] : [] : this.service.bridgesFrom(source, format, 25);
    this.storedCache.delete(key); this.storedCache.set(key, { revision, rows });
    if (this.storedCache.size > 64) this.storedCache.delete(this.storedCache.keys().next().value!);
    return rows;
  }

  private project(rows: ArchetypeBridge[], query: BridgeSearchQuery, deep = false) {
    const candidates = rows.filter(row => (deep || row.tier !== "niche") && row.source === query.source && row.format === query.format
      && (!query.target || row.target === query.target)
      && (row.format !== "genesys" || this.incrementalPoints(row, query) <= (query.genesysRemaining ?? 100)));
    const shown = candidates
      .flatMap(row => { const shown = shownBridge(this.db, row); if (!shown) return [];
        const reverse = deep ? this.service.deepBetween(row.target, row.source, row.format) : this.service.bridgeBetween(row.target, row.source, row.format);
        const twoWay = !!reverse && !!shownBridge(this.db, reverse)
          && (reverse.format !== "genesys" || this.incrementalPoints(reverse, query) <= (query.genesysRemaining ?? 100));
        return [{ ...shown, two_way: twoWay }]; });
    const results = deep ? this.service.deepTargets(shown, 10) : this.service.distinctTargets(shown, 4);
    return { results, inReview: candidates.filter(row => ["pending", "review"].includes(bridgeGate(this.db, row).state)).length };
  }

  async handle(body: Record<string, unknown>, guildId: string, playerId: number) {
    const player = this.db.prepare("SELECT p.user_id FROM players p JOIN users u ON u.id=p.user_id WHERE p.id=? AND p.guild_id=?")
      .get(playerId, guildId) as { user_id: number } | undefined;
    if (!player || !Number.isSafeInteger(body.userId) || body.userId !== player.user_id) throw new BridgeJobError("Authenticated guild player is required", 403);
    const actor = { userId: player.user_id, guildId }, input = body.bridgeRequest;
    if (!object(input)) throw new BridgeJobError("Invalid bridge request", 400);
    if (input.op === "review") {
      if (Object.keys(input).length !== 1) throw new BridgeJobError("Invalid bridge request", 400);
      if (!isOwnerUser(actor.userId)) throw new BridgeJobError("Owner access is required", 403);
      const feedback = this.db.prepare(`SELECT f.evidence_hash AS evidenceHash,
        (SELECT source FROM archetype_bridge WHERE evidence_hash=f.evidence_hash ORDER BY source,target,format LIMIT 1) AS source,
        (SELECT target FROM archetype_bridge WHERE evidence_hash=f.evidence_hash ORDER BY source,target,format LIMIT 1) AS target,
        (SELECT format FROM archetype_bridge WHERE evidence_hash=f.evidence_hash ORDER BY source,target,format LIMIT 1) AS format,
        count(DISTINCT f.actor_hash) AS users,
        (SELECT json_group_array(reason) FROM (SELECT reason FROM bridge_feedback WHERE evidence_hash=f.evidence_hash
          AND resolved_at IS NULL ORDER BY id DESC LIMIT 200)) AS reasons,min(f.created_at) AS createdAt
        FROM bridge_feedback f WHERE f.resolved_at IS NULL AND EXISTS(SELECT 1 FROM archetype_bridge WHERE evidence_hash=f.evidence_hash)
        GROUP BY f.evidence_hash ORDER BY users DESC,createdAt LIMIT 200`).all() as
        { evidenceHash: string; source: string; target: string; format: string; users: number; reasons: string; createdAt: string }[];
      const inReview = (this.db.prepare(`SELECT count(DISTINCT evidence_hash) AS n FROM (
        SELECT evidence_hash FROM bridge_judgement WHERE judge LIKE ? OR judge LIKE ?
        GROUP BY evidence_hash,json_extract(judgement_json,'$.input_hash')
        HAVING max(verdict='review')=1 OR count(DISTINCT json_extract(judgement_json,'$.framing'))=2 AND (
          min(verdict)<>max(verdict) OR min(verdict)='approved' AND (
            max(CASE json_extract(judgement_json,'$.result.grade') WHEN 'strong' THEN 0 WHEN 'good' THEN 1 WHEN 'niche' THEN 2 ELSE 3 END)
            -min(CASE json_extract(judgement_json,'$.result.grade') WHEN 'strong' THEN 0 WHEN 'good' THEN 1 WHEN 'niche' THEN 2 ELSE 3 END)>1))
        UNION SELECT evidence_hash FROM bridge_feedback WHERE resolved_at IS NULL GROUP BY evidence_hash HAVING count(DISTINCT actor_hash)>=2
      )`).get(`${BRIDGE_JUDGE_IDENTITIES.mechanic}:%`, `${BRIDGE_JUDGE_IDENTITIES.skeptic}:%`) as { n: number }).n;
      return { feedback: feedback.map(row => ({ ...row, reasons: JSON.parse(row.reasons), hidden: row.users >= 2 })), inReview };
    }
    if (input.op === "status") {
      if (Object.keys(input).some(key => !["op", "jobId"].includes(key)) || typeof input.jobId !== "string" || !/^[a-f\d-]{36}$/.test(input.jobId)) throw new BridgeJobError("Invalid bridge job", 400);
      return this.jobs.status(actor, input.jobId);
    }
    if (input.op === "feedback") {
      if (Object.keys(input).some(key => !["op", "evidenceHash", "reason"].includes(key)) || typeof input.evidenceHash !== "string" || !/^[a-f\d]{64}$/.test(input.evidenceHash)
        || (input.reason !== undefined && (typeof input.reason !== "string" || input.reason.length > 512))) throw new BridgeJobError("Invalid bridge feedback", 400);
      if (!this.db.prepare("SELECT 1 FROM archetype_bridge WHERE evidence_hash=?").get(input.evidenceHash)) throw new BridgeJobError("Bridge not found", 404);
      this.db.prepare("INSERT OR IGNORE INTO bridge_feedback(evidence_hash,actor_hash,reason) VALUES(?,?,?)").run(input.evidenceHash, hash(actor.userId), typeof input.reason === "string" ? input.reason.trim() : "");
      const users = (this.db.prepare("SELECT count(DISTINCT actor_hash) AS n FROM bridge_feedback WHERE evidence_hash=? AND resolved_at IS NULL").get(input.evidenceHash) as { n: number }).n;
      return { accepted: true, hidden: users >= 2 };
    }
    if (input.op === "start" && (input.engines !== undefined || input.deck !== undefined)) {
      if (["source", "deckId"].some(key => input[key] !== undefined)) throw new BridgeJobError("Choose one bridge source selector", 400);
      const { query } = this.engineQueries.resolve(input, guildId);
      if (!query.engines.length) throw new BridgeJobError("The deck needs an engine before searching bridges", 400);
      return this.jobs.start(actor, query);
    }
    if (input.op === "engines") return this.fastQueries.run(input, guildId, actor.userId);
    if (!["from", "between", "start"].includes(String(input.op))) throw new BridgeJobError("Invalid bridge operation", 400);
    const query = this.query(input, guildId, actor.userId);
    if (input.op === "start") return this.jobs.start(actor, query);
    if (input.op === "between" && !query.target) throw new BridgeJobError("Target archetype is required", 400);
    const result = this.project(this.storedRows(query.source, query.target, query.format), query);
    if (!query.target) return result;
    const reversed = this.project(this.storedRows(query.target, query.source, query.format), { ...query, source: query.target, target: query.source });
    return { ...result, reverse: reversed.results, inReview: result.inReview + reversed.inReview };
  }
}
