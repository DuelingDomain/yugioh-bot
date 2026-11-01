import type Database from "better-sqlite3";
import { displayBridgeGroups, resolveBridgeGroup, BRIDGE_JUDGE_IDENTITIES, BRIDGE_JUDGE_VERSION, isBridgeDeck, type BridgeDeck, type BridgeGraphData } from "@yugidraft/shared/cards/effects";
import { isOwnerUser } from "@yugidraft/shared/access/owner-access";
import { createHash } from "node:crypto";
import { BridgeJobError, BridgeSearchJobs, type BridgeSearchQuery } from "./bridge-search-jobs.js";
import type { DeckSuggestionWorkers } from "./deck-suggestion-workers.js";
import { BridgeEngineQueries, validateBridgeEngineInput } from "./bridge-engine-queries.js";
import { BridgeFastQueries } from "./bridge-fast-queries.js";
import { searchBridgeEngines } from "./bridge-multi-search.js";
import { compactBridgeRows } from "./bridge-projection-input.js";

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const name = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= 120 && !/[\u0000-\u001f\u007f]/.test(value);
const hash = (userId: number) => createHash("sha256").update(`bridge-user:${userId}`).digest("hex");

export class BridgeApi {
  readonly jobs: BridgeSearchJobs;
  private readonly engineQueries: BridgeEngineQueries;
  private readonly fastQueries: BridgeFastQueries;
  private graph?: { source_version: string; groups: BridgeGraphData["groups"] };
  constructor(private readonly db: Database.Database, private readonly workers: Pick<DeckSuggestionWorkers, "bridgeCandidates" | "rateBridge" | "bridgeEngines" | "bridgeEngineProjection" | "bridgeEngineShortlist" | "bridgeDirectedProjection" | "bridgeResolve" | "withBridgeLegality">, now?: () => number) {
    this.engineQueries = new BridgeEngineQueries(db);
    this.fastQueries = new BridgeFastQueries(db, workers, now);
    this.jobs = new BridgeSearchJobs(db, {
      // Old subscriber arrays included Side or Deck Master without recording
      // their zones. Require refreshed context; evidence/review caches survive.
      now, version: () => `${this.groups().source_version}:${BRIDGE_JUDGE_VERSION}:main-extra-packages-v1:full-engine-recall-v1:engine-core-v1:set-access-synergy-v2`,
      project: async (rows, query) => query.engines
        ? { results: [], ...await workers.bridgeEngineProjection(rows, { ...query, engines: query.engines }) }
        : workers.bridgeDirectedProjection(query, rows, true),
      serializeResult: (rows, query) => JSON.stringify(query.engines ? compactBridgeRows(rows) : rows),
      projectStored: async (jobId, query) => query.engines
        ? { results: [], ...await workers.bridgeEngineProjection({ jobId }, { ...query, engines: query.engines }) }
        : workers.bridgeDirectedProjection(query, { jobId }, true),
      execute: (query, progress) => searchBridgeEngines(this.db, workers,
        { ...query, engines: query.engines ?? [query.source] }, progress),
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

  private query(input: Record<string, unknown>): BridgeSearchQuery {
    const allowed = ["op", "source", "format", "genesysRemaining"];
    if (input.op === "from" || input.op === "between") allowed.push("deck", "target");
    if (Object.keys(input).some(key => !allowed.includes(key)) || !name(input.source)
      || input.target !== undefined && !name(input.target)
      || input.deck !== undefined && !isBridgeDeck(input.deck)
      || input.format !== undefined && input.format !== "advanced" && input.format !== "genesys"
      || input.genesysRemaining !== undefined && (!Number.isSafeInteger(input.genesysRemaining) || Number(input.genesysRemaining) < 0 || Number(input.genesysRemaining) > 1000)) {
      throw new BridgeJobError("Invalid bridge query", 400);
    }
    const { groups } = this.groups();
    const source = resolveBridgeGroup(input.source, groups);
    const target = input.target === undefined ? undefined : resolveBridgeGroup(input.target as string, groups);
    if (!source || input.target !== undefined && !target) throw new BridgeJobError("Unknown archetype", 400);
    if (source === target) throw new BridgeJobError("Choose two different archetypes", 400);
    const format = input.format === "genesys" ? "genesys" : "advanced";
    return { source, ...(target ? { target } : {}), format,
      ...this.engineQueries.deckContext(input.deck as BridgeDeck | undefined, format, input.genesysRemaining as number | undefined) };
  }

  async handle(body: Record<string, unknown>, guildId: string, playerId: number, signal?: AbortSignal) {
    try { return displayBridgeGroups(await this.handleStable(body, guildId, playerId, signal)); }
    catch (error) {
      if (error instanceof BridgeJobError) throw new BridgeJobError(displayBridgeGroups(error.message), error.status, error.retryAfter);
      throw error;
    }
  }

  private async handleStable(body: Record<string, unknown>, guildId: string, playerId: number, signal?: AbortSignal) {
    const player = this.db.prepare("SELECT p.user_id FROM players p JOIN users u ON u.id=p.user_id WHERE p.id=? AND p.guild_id=?")
      .get(playerId, guildId) as { user_id: number } | undefined;
    if (!player || !Number.isSafeInteger(body.userId) || body.userId !== player.user_id) throw new BridgeJobError("Authenticated guild player is required", 403);
    const actor = { userId: player.user_id, guildId };
    const request = body.bridgeRequest;
    if (!object(request)) throw new BridgeJobError("Invalid bridge request", 400);
    const join = request.op === "start" && request.join === true;
    if (request.op === "start" && request.join !== undefined && typeof request.join !== "boolean") throw new BridgeJobError("Invalid bridge join option", 400);
    const { join: _join, ...queryInput } = request;
    const input = request.op === "start" ? queryInput : request;
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
      if (input.source !== undefined) throw new BridgeJobError("Choose one bridge source selector", 400);
      validateBridgeEngineInput(input);
      const { query } = await this.workers.bridgeResolve(input, guildId);
      if (!query.engines.length) throw new BridgeJobError("The deck needs an engine before searching bridges", 400);
      return this.workers.withBridgeLegality(query.format, () => this.jobs.start(actor, query, join));
    }
    if (input.op === "engines") return this.fastQueries.run(input, guildId, actor.userId, undefined, signal);
    if (!["from", "between", "start"].includes(String(input.op))) throw new BridgeJobError("Invalid bridge operation", 400);
    const query = this.query(input);
    if (input.op === "start") return this.workers.withBridgeLegality(query.format, () => this.jobs.start(actor, query, join));
    if (input.op === "between" && !query.target) throw new BridgeJobError("Target archetype is required", 400);
    return this.workers.bridgeDirectedProjection(query);
  }
}
