import { NextResponse } from "next/server";
import { createPlayerService } from "@yugidraft/shared/services";
import { requireWebAccess } from "./web-access";
import { getDb } from "./db";
import { env } from "./env";
import { callDuelHost } from "./duel-host";
import { apiErrorResponse } from "./api-errors";
import { readJsonBody } from "./bug-reports/read-body";
import { bridgeGroupName, BridgeAlternativePathSchema, BridgePackageSchema, EngineCoreSchema, isBridgeDeck, isBridgeEngineNames, type BridgeEnginesRequest } from "@yugidraft/shared/cards/effects";
import { isBridgeLoadingResponse, type BridgeDeepSearchRequest, type BridgeListRequest, type BridgeLoadingResponse } from "./bridges-api";

type BridgeFormat = "advanced" | "genesys";
type BridgeQuery = BridgeListRequest & { format: BridgeFormat };
export type BridgeRequest =
  | (BridgeQuery & { op: "from" | "between" })
  | (BridgeDeepSearchRequest & { format: BridgeFormat; op: "start" })
  | (BridgeEnginesRequest & { op: "engines" })
  | { op: "status"; jobId: string }
  | { op: "feedback"; evidenceHash: string; reason?: string }
  | { op: "review" };

const NO_STORE = { "cache-control": "private, no-store" };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const integer = (value: unknown, max = Number.MAX_SAFE_INTEGER): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= max;
const name = (value: unknown, max = 120): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
const text = (value: unknown, max: number): value is string => typeof value === "string" && value.length <= max;
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const format = (value: unknown): value is BridgeFormat => value === "advanced" || value === "genesys";
const jobId = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
const strings = (value: unknown, min: number, max: number, length: number) => Array.isArray(value)
  && value.length >= min && value.length <= max && value.every(item => text(item, length) && item.trim().length > 0);
const keys = (value: Record<string, unknown>, allowed: string[]) => Object.keys(value).every(key => allowed.includes(key));

export const bridgeJson = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: NO_STORE });
export const invalidBridgeRequest = () => bridgeJson({ error: "Invalid bridge request" }, 400);

export async function requireBridgeActor() {
  const actor = await requireWebAccess();
  if (!actor.ok) { actor.response.headers.set("cache-control", "private, no-store"); return actor; }
  const guildId = env.discordGuildId;
  if (!guildId) return { ok: false as const, response: bridgeJson({ error: "community_not_configured" }, 503) };
  const player = createPlayerService(getDb()).findByGuildAndUser(guildId, actor.userId);
  if (!player) return { ok: false as const, response: bridgeJson({ error: "Player access is required for bridges" }, 403) };
  return { ok: true as const, guildId, userId: actor.userId, playerId: player.id };
}

/** Saved deck ownership and its source archetype are resolved again on the host. */
function parseQuery(value: unknown, allowDeck = false): BridgeQuery | null {
  if (!object(value) || !keys(value, ["source", "deckId", "target", "format", "genesysRemaining", ...(allowDeck ? ["deck"] : [])])) return null;
  if ((value.source === undefined) === (value.deckId === undefined)) return null;
  if (value.source !== undefined && !name(value.source)) return null;
  if (value.deckId !== undefined && (!integer(value.deckId) || value.deckId === 0)) return null;
  if (value.deck !== undefined && (value.deckId !== undefined || !isBridgeDeck(value.deck))) return null;
  if (value.target !== undefined && !name(value.target)) return null;
  if (value.format !== undefined && !format(value.format)) return null;
  if (value.genesysRemaining !== undefined && !integer(value.genesysRemaining, 1000)) return null;
  return { ...(typeof value.source === "string" ? { source: value.source.trim() } : { deckId: value.deckId as number }),
    ...(typeof value.target === "string" ? { target: value.target.trim() } : {}), format: value.format ?? "advanced",
    ...(value.deck !== undefined ? { deck: value.deck } : {}),
    ...(value.genesysRemaining !== undefined ? { genesysRemaining: value.genesysRemaining } : {}) } as BridgeQuery;
}

export function readBridgeQuery(request: Request): BridgeRequest | null {
  const query = new URL(request.url).searchParams;
  if ([...query.keys()].some(key => query.getAll(key).length !== 1)) return null;
  const value: Record<string, unknown> = Object.fromEntries(query);
  for (const key of ["deckId", "genesysRemaining"]) {
    if (value[key] === undefined) continue;
    if (typeof value[key] !== "string" || !/^(0|[1-9]\d*)$/.test(value[key])) return null;
    value[key] = Number(value[key]);
  }
  const parsed = parseQuery(value);
  return parsed ? { ...parsed, op: parsed.target ? "between" : "from" } : null;
}

export async function readBridgeBody(request: Request, op: "list" | "start" | "feedback" | "engines") {
  if (new URL(request.url).search) return { ok: false as const, response: invalidBridgeRequest() };
  const body = await readJsonBody(request, 4096);
  if (!body.ok) return { ok: false as const, response: body.response.status === 413
    ? bridgeJson({ error: "Bridge request is too large" }, 413) : invalidBridgeRequest() };
  if (op === "list") {
    const query = parseQuery(body.value, true);
    return query ? { ok: true as const, value: { ...query, op: query.target ? "between" : "from" } as BridgeRequest }
      : { ok: false as const, response: invalidBridgeRequest() };
  }
  if (op === "engines") {
    const value = body.value;
    if (!object(value) || !keys(value, ["format", "deck", "engines", "genesysRemaining"]) || !format(value.format)
      || value.deck === undefined && value.engines === undefined
      || value.deck !== undefined && !isBridgeDeck(value.deck)
      || value.engines !== undefined && !isBridgeEngineNames(value.engines)
      || value.genesysRemaining !== undefined && !integer(value.genesysRemaining, 1000)) return { ok: false as const, response: invalidBridgeRequest() };
    return { ok: true as const, value: { ...value, op } as BridgeRequest };
  }
  if (op === "start") {
    if (!object(body.value) || body.value.join !== undefined && typeof body.value.join !== "boolean") {
      return { ok: false as const, response: invalidBridgeRequest() };
    }
    const { join, ...value } = body.value;
    const options = join === undefined ? {} : { join };
    if (object(value) && (value.engines !== undefined || value.deck !== undefined)) {
      if (!keys(value, ["engines", "deck", "format", "genesysRemaining"])
        || value.deck !== undefined && !isBridgeDeck(value.deck)
        || value.engines !== undefined && !isBridgeEngineNames(value.engines)
        || value.format !== undefined && !format(value.format)
        || value.genesysRemaining !== undefined && !integer(value.genesysRemaining, 1000)) return { ok: false as const, response: invalidBridgeRequest() };
      return { ok: true as const, value: { ...value, ...options, format: value.format ?? "advanced", op } as BridgeRequest };
    }
    const query = parseQuery(value);
    return query ? { ok: true as const, value: { ...query, ...options, op } as BridgeRequest }
      : { ok: false as const, response: invalidBridgeRequest() };
  }
  const value = body.value;
  if (!object(value) || !keys(value, ["evidenceHash", "reason"]) || !hash(value.evidenceHash)
    || (value.reason !== undefined && !text(value.reason, 512))) return { ok: false as const, response: invalidBridgeRequest() };
  return { ok: true as const, value: { op, evidenceHash: value.evidenceHash,
    ...(typeof value.reason === "string" && value.reason.trim() ? { reason: value.reason.trim() } : {}) } as BridgeRequest };
}

export function readBridgeJob(request: Request, value: string): BridgeRequest | null {
  return !new URL(request.url).search && jobId(value) ? { op: "status", jobId: value } : null;
}

function shownBridge(value: unknown, deep: boolean): boolean {
  if (!object(value) || !name(value.source, 160) || !name(value.target, 160) || !format(value.format)
    || value.kind !== undefined && value.kind !== "synergy"
    || value.kind === "synergy" && (!deep || value.tier !== "niche" || value.two_way !== false)
    || !BridgePackageSchema.safeParse(value).success
    || value.core !== undefined && !EngineCoreSchema.safeParse(value.core).success
    || value.judge !== "accepted" || value.validation !== "deterministic" || !hash(value.evidence_hash)
    || value.engine_status !== "unverified"
    || typeof value.score !== "number" || !Number.isFinite(value.score) || value.score < 0 || value.score > 100
    || typeof value.grade !== "string" || !["Strong", "Good", "Niche", "Risky"].includes(value.grade)
    || (value.tier !== undefined && (!deep || value.tier !== "niche" || value.grade !== "Niche"))
    || !Array.isArray(value.cards) || value.cards.length > 100 || !value.cards.every(card => integer(card, 0xffffffff) && card > 0)
    || !Array.isArray(value.reasons) || value.reasons.length > 100 || !Array.isArray(value.warnings) || value.warnings.length > 100) return false;
  const review = value.review;
  if (!object(review)) return false;
  const line = review.line;
  return typeof review.grade === "string" && ["strong", "good", "niche", "risky"].includes(review.grade)
    && (review.alternative_paths === undefined || Array.isArray(review.alternative_paths) && review.alternative_paths.length <= 3
      && review.alternative_paths.every(path => BridgeAlternativePathSchema.safeParse(path).success))
    && (value.tier !== "niche" || review.grade === "niche")
    && strings(review.pros, 0, 3, 500) && strings(review.cons, 0, 3, 500)
    // The host falls back to joined printed locks, which have no judge-note length cap.
    && typeof review.lock_note === "string" && Array.isArray(line) && strings(line, 1, 3, 200)
    && (review.steps === undefined || Array.isArray(review.steps) && review.steps.length === line.length
      && review.steps.every((step, i) => object(step) && keys(step, ["card", "text"]) && step.card === line[i]
        && typeof step.text === "string" && step.text.length <= 500));
}

const results = (value: unknown, expectedFormat?: BridgeFormat, deep = false) => Array.isArray(value) && value.length <= (deep ? 10 : 4)
  && value.filter(row => object(row) && row.kind === "synergy").length <= 2
  && value.every(row => shownBridge(row, deep) && (expectedFormat === undefined || row.format === expectedFormat));
const state = (value: unknown) => value === "queued" || value === "running" || value === "done" || value === "failed";
function engineSuggestions(value: unknown, expectedFormat?: BridgeFormat, max = 4): boolean {
  return Array.isArray(value) && value.length <= max && value.filter(row => object(row) && row.kind === "synergy").length <= 2
    && value.every(row => object(row) && name(row.engine, 160)
    && (row.kind === undefined || row.kind === "synergy")
    && BridgePackageSchema.safeParse(row).success
    && (row.core === undefined || EngineCoreSchema.safeParse(row.core).success)
    && typeof row.score === "number" && Number.isFinite(row.score) && row.score >= 0 && (row.tier === "niche" || row.score >= 4)
    && typeof row.grade === "string" && ["Strong", "Good", "Niche", "Risky"].includes(row.grade)
    && (row.tier === "strict" || row.tier === "niche") && integer(row.of, 4) && row.of >= 1 && integer(row.covered, row.of)
    && Array.isArray(row.twoWay) && row.twoWay.length <= row.of && row.twoWay.every(value => name(value, 160))
    && (row.kind !== "synergy" || row.tier === "niche" && row.covered === 0 && row.twoWay.length === 0)
    && Array.isArray(row.links) && row.links.length >= 1 && row.links.length <= 3 && row.links.every(link => object(link)
      && name(link.from, 160) && name(link.to, 160) && shownBridge(link.bridge, true) && object(link.bridge)
      && row.kind === link.bridge.kind
      && link.from === link.bridge.source && link.to === link.bridge.target && (link.from === row.engine || link.to === row.engine)
      && (expectedFormat === undefined || link.bridge.format === expectedFormat))
    && [row.cards, row.missing].every(ids => Array.isArray(ids) && ids.length <= 300 && ids.every(id => integer(id, 0xffffffff) && id > 0))
    && (row.genesysPoints === null || integer(row.genesysPoints)) && strings(row.pros, 0, 3, 500) && strings(row.cons, 0, 3, 500));
}
function detectedEngines(value: unknown): boolean {
  return Array.isArray(value) && value.length <= 1000 && value.every(row => object(row) && name(row.name, 160)
    && typeof row.weight === "number" && Number.isFinite(row.weight) && row.weight >= 1.5 && row.weight <= 182
    && integer(row.copies, 91) && integer(row.distinct, row.copies) && (row.status === "engine" || row.status === "light")
    && Array.isArray(row.hybrids) && row.hybrids.length <= 91 && row.hybrids.every(id => integer(id, 0xffffffff) && id > 0)
    && (row.includes === undefined || Array.isArray(row.includes) && row.includes.every(value => name(value, 160))));
}
function validResponse(value: unknown, request: BridgeRequest): boolean {
  if (!object(value)) return false;
  switch (request.op) {
    case "engines": return isBridgeLoadingResponse(value) || Array.isArray(value.engines) && value.engines.length <= 4 && value.engines.every(value => name(value, 160))
      && (request.deck === undefined ? value.detected === undefined : detectedEngines(value.detected))
      && Array.isArray(value.between) && value.between.length <= 12 && value.between.every(row => shownBridge(row, true) && object(row)
        && row.kind === undefined
        && row.format === request.format && (value.engines as string[]).includes(String(row.source)) && (value.engines as string[]).includes(String(row.target)))
      && engineSuggestions(value.next, request.format) && integer(value.inReview);
    case "from": case "between": return results(value.results, request.format) && integer(value.inReview)
      && (value.reverse === undefined || results(value.reverse, request.format));
    case "start": return jobId(value.jobId) && state(value.state) && typeof value.cached === "boolean"
      && (value.error === undefined || text(value.error, 2000));
    case "status": return value.jobId === request.jobId && state(value.state)
      && typeof value.step === "string" && ["candidates", "checking", "rating", "done"].includes(value.step)
      && integer(value.progress, 100) && results(value.results, undefined, true) && integer(value.inReview)
      && (value.engines === undefined || Array.isArray(value.engines) && value.engines.length >= 1 && value.engines.length <= 4 && value.engines.every(value => name(value, 160)))
      && (value.next === undefined || engineSuggestions(value.next, undefined, 6))
      && (value.error === undefined || text(value.error, 2000));
    case "feedback": return value.accepted === true && typeof value.hidden === "boolean";
    case "review": return Array.isArray(value.feedback) && value.feedback.length <= 200 && integer(value.inReview)
      && value.feedback.every(row => object(row) && hash(row.evidenceHash) && name(row.source, 160) && name(row.target, 160)
        && format(row.format) && integer(row.users) && Array.isArray(row.reasons) && row.reasons.length <= 200 && row.reasons.every(reason => text(reason, 512))
        && text(row.createdAt, 100) && typeof row.hidden === "boolean");
  }
}

export async function callBridgeHost(actor: { guildId: string; userId: number; playerId: number }, request: BridgeRequest, signal?: AbortSignal) {
  const response = await callDuelHost({ op: "bridges", ...actor, bridgeRequest: request }, signal);
  if (!response.ok) return response;
  if (!validResponse(response.data, request)) return { ok: false as const, response: bridgeJson({ error: "Invalid engine bridge response" }, 502) };
  return response;
}

export async function answerBridgeRequest(actor: { guildId: string; userId: number; playerId: number }, request: BridgeRequest, signal?: AbortSignal) {
  const response = await callBridgeHost(actor, request, signal);
  if (!response.ok) {
    const retryAfter = Number(response.response.headers.get("retry-after"));
    // Cold initialization and queue pressure are temporary. Keep the browser
    // helper pending instead of turning these into a false unavailable/empty state.
    if (request.op === "engines" && !signal?.aborted && response.response.status === 503
      && Number.isSafeInteger(retryAfter) && retryAfter > 0) {
      const loading: BridgeLoadingResponse = { state: "loading", retryAfter: Math.min(10, retryAfter) };
      const answer = bridgeJson(loading, 202);
      answer.headers.set("retry-after", String(loading.retryAfter));
      return answer;
    }
    return response.response;
  }
  const data = response.data as Record<string, unknown>;
  if (request.op === "engines" && isBridgeLoadingResponse(data)) {
    const answer = bridgeJson(data, 202);
    answer.headers.set("retry-after", String(data.retryAfter));
    return answer;
  }
  return bridgeJson(data, request.op === "start" && (data.state === "queued" || data.state === "running") ? 202 : 200);
}

export function bridgeErrorResponse(error: unknown) {
  const response = apiErrorResponse(error, "card bridges");
  response.headers.set("cache-control", "private, no-store");
  return response;
}

/** The archetypes that have bridge data, for the two-archetype search box. A name list only; no bridge is exposed here. */
export function listBridgeArchetypes(): string[] {
  const rows = getDb().prepare("SELECT source AS name FROM archetype_bridge UNION SELECT target FROM archetype_bridge ORDER BY name COLLATE NOCASE").all() as { name: string }[];
  return [...new Set(rows.map(row => bridgeGroupName(row.name)))].sort((a, b) => a.localeCompare(b));
}
