import type Database from "better-sqlite3";
import { bridgeGate, BRIDGE_JUDGE_IDENTITIES, BRIDGE_JUDGE_VERSION, isBridgeDeck, type ArchetypeBridge, type BridgeDeck, type BridgeGraphData } from "@yugidraft/shared/cards/effects";
import { createSavedDeckService } from "@yugidraft/shared/services";
import { isOwnerUser } from "@yugidraft/shared/access/owner-access";
import { createHash } from "node:crypto";
import { BridgeJobError, BridgeReviewUnavailableError, BridgeSearchJobs, type BridgeSearchQuery } from "./bridge-search-jobs.js";
import type { DeckSuggestionWorkers } from "./deck-suggestion-workers.js";
import { BridgeEngineQueries, validateBridgeEngineInput } from "./bridge-engine-queries.js";
import { BridgeFastQueries } from "./bridge-fast-queries.js";
import { searchBridgeEngines } from "./bridge-multi-search.js";
import { compactBridgeRows } from "./bridge-projection-input.js";
import { reuseAcceptedBridge } from "./bridge-reviewed-candidates.js";

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const name = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= 160;
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
      execute: async (query, progress) => {
        if (query.engines) return searchBridgeEngines(this.db, workers, { ...query, engines: query.engines }, progress);
        // Next-engine discovery needs both complete directions. The legacy
        // directed list is projected separately from these same saved rows.
        if (!query.target) return searchBridgeEngines(this.db, workers, { ...query, engines: [query.source] }, progress);
        const result = await workers.bridgeCandidates({ kind: "bridges", source: query.source, format: query.format,
          ...(query.target ? { op: "explain", target: query.target } : { op: "live" }) }, value => {
          progress("candidates", Math.floor(25 * value.completed / Math.max(1, value.total)));
        });
        const read = <T>(callback: () => T) => workers.withBridgeLegality(query.format, callback);
        const rows = await read(() => (Array.isArray(result) ? result : result ? [result] : []).map(row => reuseAcceptedBridge(this.db, row)));
        progress("checking", 30);
        const version = this.groups().source_version;
        this.db.transaction(() => {
          const save = this.db.prepare(`INSERT INTO archetype_bridge(source,target,format,score,grade,bridge_json,evidence_hash,source_version)
            VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(source,target,format) DO UPDATE SET score=excluded.score,grade=excluded.grade,
            bridge_json=excluded.bridge_json,evidence_hash=excluded.evidence_hash,source_version=excluded.source_version`);
          for (const row of rows) save.run(row.source, row.target, row.format, row.score, row.grade, JSON.stringify(row), row.evidence_hash, version);
        }).immediate();
        const candidates = await read(() => rows.filter(row => bridgeGate(this.db, row).state === "pending").slice(0, 10));
        const previousReviews = await read(() => new Set(candidates.flatMap(row => bridgeGate(this.db, row).judgements.map(review => review.judge))));
        let next = 0, completed = 0;
        progress("rating", 35);
        await Promise.all(Array.from({ length: Math.min(2, candidates.length) }, async () => {
          while (next < candidates.length) {
            const row = candidates[next++]!;
            await workers.rateBridge(row);
            progress("rating", 35 + Math.floor(64 * ++completed / candidates.length));
          }
        }));
        if (candidates.length && await read(() => !candidates.some(row => bridgeGate(this.db, row).judgements.some(review => !previousReviews.has(review.judge)))
          && !rows.some(row => bridgeGate(this.db, row).state === "shown"))) throw new BridgeReviewUnavailableError();
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
    if (input.op === "from" || input.op === "between") allowed.push("deck");
    if (Object.keys(input).some(key => !allowed.includes(key)) || (input.source === undefined) === (input.deckId === undefined)
      || (input.source !== undefined && !name(input.source)) || (input.target !== undefined && !name(input.target))
      || (input.deck !== undefined && (input.deckId !== undefined || !isBridgeDeck(input.deck)))
      || (input.format !== undefined && input.format !== "advanced" && input.format !== "genesys")
      || (input.genesysRemaining !== undefined && (!Number.isSafeInteger(input.genesysRemaining) || Number(input.genesysRemaining) < 0 || Number(input.genesysRemaining) > 1000))) {
      throw new BridgeJobError("Invalid bridge query", 400);
    }
    const { groups } = this.groups();
    let source = input.source as string | undefined, remaining = input.genesysRemaining as number | undefined, deckCards: number[] | undefined, deck: BridgeDeck | undefined;
    if (input.deck !== undefined) {
      const context = this.engineQueries.deckContext(input.deck as BridgeDeck, input.format === "genesys" ? "genesys" : "advanced", remaining);
      deckCards = context.deckCards;
      deck = context.deck;
      remaining = context.genesysRemaining;
    }
    if (input.deckId !== undefined) {
      if (!Number.isSafeInteger(input.deckId) || Number(input.deckId) <= 0) throw new BridgeJobError("Invalid deck", 400);
      let saved;
      try { saved = createSavedDeckService(this.db).get(Number(input.deckId), guildId, userId); }
      catch { throw new BridgeJobError("Deck not found", 404); }
      const artwork = this.db.prepare("SELECT card_id FROM card_artworks WHERE artwork_id=?");
      const mainId = (id: number) => (artwork.get(id) as { card_id: number } | undefined)?.card_id ?? id;
      deck = { main: saved.deck.main.map(mainId), extra: saved.deck.extra.map(mainId), side: saved.deck.side.map(mainId), mode: saved.mode,
        ...(saved.deck.deckMaster === undefined ? {} : { deckMaster: mainId(saved.deck.deckMaster) }), ...(saved.genesys ? { pointCap: saved.genesys.pointCap } : {}) };
      deckCards = [...deck.main, ...deck.extra];
      const cards = new Set(saved.deck.main.map(mainId));
      source = Object.entries(groups).map(([key, ids]) => ({ key, count: ids.filter(id => cards.has(id)).length }))
        .filter(row => row.count > 0).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))[0]?.key;
      if (!source) throw new BridgeJobError("The deck needs an archetype before searching bridges", 400);
      if (input.format === "genesys") {
        if (remaining === undefined) {
          let spent = 0;
          for (const id of [...deckCards, ...saved.deck.side.map(mainId), ...(saved.deck.deckMaster === undefined ? [] : [mainId(saved.deck.deckMaster)])]) {
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
      ...(remaining === undefined ? {} : { genesysRemaining: remaining }), ...(deckCards ? { deckCards } : {}), ...(deck ? { deck } : {}) };
  }

  async handle(body: Record<string, unknown>, guildId: string, playerId: number, signal?: AbortSignal) {
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
      if (["source", "deckId"].some(key => input[key] !== undefined)) throw new BridgeJobError("Choose one bridge source selector", 400);
      validateBridgeEngineInput(input);
      const { query } = await this.workers.bridgeResolve(input, guildId);
      if (!query.engines.length) throw new BridgeJobError("The deck needs an engine before searching bridges", 400);
      return this.workers.withBridgeLegality(query.format, () => this.jobs.start(actor, query, join));
    }
    if (input.op === "engines") return this.fastQueries.run(input, guildId, actor.userId, undefined, signal);
    if (!["from", "between", "start"].includes(String(input.op))) throw new BridgeJobError("Invalid bridge operation", 400);
    const query = this.query(input, guildId, actor.userId);
    if (input.op === "start") return this.workers.withBridgeLegality(query.format, () => this.jobs.start(actor, query, join));
    if (input.op === "between" && !query.target) throw new BridgeJobError("Target archetype is required", 400);
    return this.workers.bridgeDirectedProjection(query);
  }
}
