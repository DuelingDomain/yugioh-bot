import { NextResponse } from "next/server";
import { createPlayerService } from "@yugidraft/shared/services";
import { requireWebAccess } from "./web-access";
import { getDb } from "./db";
import { env } from "./env";
import { callDuelHost } from "./duel-host";
import { apiErrorResponse } from "./api-errors";
import { readJsonBody } from "./bug-reports/read-body";

type BridgeFormat = "advanced" | "genesys";
type BridgeQuery = ({ source: string; deckId?: never } | { deckId: number; source?: never }) & {
  target?: string;
  format: BridgeFormat;
  genesysRemaining?: number;
};
export type BridgeRequest =
  | (BridgeQuery & { op: "from" | "between" | "start" })
  | { op: "status"; jobId: string }
  | { op: "feedback"; evidenceHash: string; reason?: string }
  | { op: "review" };

const NO_STORE = { "cache-control": "private, no-store" };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const integer = (value: unknown, max = Number.MAX_SAFE_INTEGER): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= max;
const name = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= 120 && !/[\u0000-\u001f\u007f]/.test(value);
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
function parseQuery(value: unknown): BridgeQuery | null {
  if (!object(value) || !keys(value, ["source", "deckId", "target", "format", "genesysRemaining"])) return null;
  if ((value.source === undefined) === (value.deckId === undefined)) return null;
  if (value.source !== undefined && !name(value.source)) return null;
  if (value.deckId !== undefined && (!integer(value.deckId) || value.deckId === 0)) return null;
  if (value.target !== undefined && !name(value.target)) return null;
  if (value.format !== undefined && !format(value.format)) return null;
  if (value.genesysRemaining !== undefined && !integer(value.genesysRemaining, 1000)) return null;
  return { ...(typeof value.source === "string" ? { source: value.source.trim() } : { deckId: value.deckId as number }),
    ...(typeof value.target === "string" ? { target: value.target.trim() } : {}), format: value.format ?? "advanced",
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

export async function readBridgeBody(request: Request, op: "start" | "feedback") {
  if (new URL(request.url).search) return { ok: false as const, response: invalidBridgeRequest() };
  const body = await readJsonBody(request, 4096);
  if (!body.ok) return { ok: false as const, response: body.response.status === 413
    ? bridgeJson({ error: "Bridge request is too large" }, 413) : invalidBridgeRequest() };
  if (op === "start") {
    const query = parseQuery(body.value);
    return query ? { ok: true as const, value: { ...query, op } as BridgeRequest }
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

function shownBridge(value: unknown): boolean {
  if (!object(value) || !name(value.source) || !name(value.target) || !format(value.format)
    || value.judge !== "accepted" || value.validation !== "deterministic" || !hash(value.evidence_hash)
    || typeof value.score !== "number" || !Number.isFinite(value.score) || value.score < 0 || value.score > 100
    || !["Strong", "Good", "Niche", "Risky"].includes(String(value.grade))
    || !Array.isArray(value.cards) || value.cards.length > 100 || !value.cards.every(card => integer(card, 0xffffffff) && card > 0)
    || !Array.isArray(value.reasons) || value.reasons.length > 100 || !Array.isArray(value.warnings) || value.warnings.length > 100) return false;
  const review = value.review;
  return object(review) && ["strong", "good", "niche", "risky"].includes(String(review.grade))
    && strings(review.pros, 2, 3, 2000) && strings(review.cons, 2, 3, 2000) && text(review.lock_note, 4000)
    && strings(review.line, 1, 100, 200);
}

const results = (value: unknown, expectedFormat?: BridgeFormat) => Array.isArray(value) && value.length <= 4
  && value.every(row => shownBridge(row) && (expectedFormat === undefined || row.format === expectedFormat));
const state = (value: unknown) => value === "queued" || value === "running" || value === "done" || value === "failed";
function validResponse(value: unknown, request: BridgeRequest): boolean {
  if (!object(value)) return false;
  switch (request.op) {
    case "from": case "between": return results(value.results, request.format) && integer(value.inReview)
      && (value.reverse === undefined || results(value.reverse, request.format));
    case "start": return jobId(value.jobId) && state(value.state) && typeof value.cached === "boolean"
      && (value.error === undefined || text(value.error, 2000));
    case "status": return value.jobId === request.jobId && state(value.state)
      && ["candidates", "checking", "rating", "done"].includes(String(value.step))
      && integer(value.progress, 100) && results(value.results) && integer(value.inReview)
      && (value.error === undefined || text(value.error, 2000));
    case "feedback": return value.accepted === true && typeof value.hidden === "boolean";
    case "review": return Array.isArray(value.feedback) && value.feedback.length <= 200 && integer(value.inReview)
      && value.feedback.every(row => object(row) && hash(row.evidenceHash) && name(row.source) && name(row.target)
        && format(row.format) && integer(row.users) && Array.isArray(row.reasons) && row.reasons.length <= 200 && row.reasons.every(reason => text(reason, 512))
        && text(row.createdAt, 100) && typeof row.hidden === "boolean");
  }
}

export async function callBridgeHost(actor: { guildId: string; userId: number; playerId: number }, request: BridgeRequest) {
  const response = await callDuelHost({ op: "bridges", ...actor, bridgeRequest: request });
  if (!response.ok) return response;
  if (!validResponse(response.data, request)) return { ok: false as const, response: bridgeJson({ error: "Invalid engine bridge response" }, 502) };
  return response;
}

export async function answerBridgeRequest(actor: { guildId: string; userId: number; playerId: number }, request: BridgeRequest) {
  const response = await callBridgeHost(actor, request);
  if (!response.ok) return response.response;
  const data = response.data as Record<string, unknown>;
  return bridgeJson(data, request.op === "start" && (data.state === "queued" || data.state === "running") ? 202 : 200);
}

export function bridgeErrorResponse(error: unknown) {
  const response = apiErrorResponse(error, "card bridges");
  response.headers.set("cache-control", "private, no-store");
  return response;
}
