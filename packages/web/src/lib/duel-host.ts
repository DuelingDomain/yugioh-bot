import { errorResponseBody, report, log } from "@yugidraft/shared/observability";
import { signedTransport } from "@yugidraft/shared/internal-auth";
import { NextResponse } from "next/server";
import { ReplayAccessError } from "@yugidraft/shared/access/owner-access";
import {
  createDuelService,
  createPlayerService,
  redactDuelTournamentMetadata,
  DuelInviteRefusalError,
  DuelServiceError,
  SavedDeckServiceError,
  TournamentDuelError,
  type DuelService,
  type DeckSuggestionQuery,
} from "@yugidraft/shared/services";
import { isReplayFork, seatCountFor, type CardQuery, type DuelChainMode, type DuelCommand, type DuelDeck, type DuelFirstChoice,
  type DuelFormat, type DuelMasterRule, type DuelMode, type DuelRpsMove, type DuelRoom, type ReplayForkRequest, type ReplayUnverifiedReason,
  type SandboxHostOp, type SandboxBoard, type SandboxRun, type SandboxBotMode } from "@yugidraft/shared/duels";
import { requireWebAccess } from "@/lib/web-access";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import type { CardDataStatus } from "@yugidraft/shared/types";
import type { BridgeRequest } from "./bridges-server-api";

export type DuelHostOp = "bridges" | "admin-spectate" | "kick" | "invite-player" | "engine-data-status" | "capabilities" | "view" | "start" | "respond" | "deck" | "validate-deck" | "validate-deck-master" | "suggestion-scope" | "deck-suggestions" | "cards" | "card-details" | "card-artworks" | "card-query" | "card-facets" | "surrender" | "add-bot" | "archive" | "cancel" | "replay" | "owner-replay" | "replay-fork" | "fork-list" | "fork-restart" | "fork-cancel" | "ready" | "unready" | "series-side" | "series-ready" | "series-unready" | "series-first" | "opening-pick" | "opening-choose" | "normalize-codes" | "check-deck" | "list-presets" | "start-preset" | "start-test-duel" | "warm-test-duel" | "report" | "debug-trace" | "bug-context" | "bug-replay-frame" | "chain-mode" | SandboxHostOp;

/** Read-only seat identity stays separate from creator identity. Unknown control flags fail closed. */
export function readDuelControl(request: Request, room?: DuelRoom, allowed: "view" | "action" | "cards" | "none" = "none") {
  const query = new URL(request.url).searchParams;
  const flags = ["as", "reveal", "promptId", "revision"];
  const present = flags.filter(key => query.has(key));
  const fork = room && isReplayFork(room.session);
  const permitted = allowed === "view" ? ["as", "reveal"] : allowed === "action" ? ["as"]
    : allowed === "cards" ? ["as", "promptId", "revision"] : [];
  if (present.some(key => !fork || !permitted.includes(key) || query.getAll(key).length !== 1)) {
    throw new DuelServiceError("Control overrides are only available on replay fork controls", 400);
  }
  const as = query.get("as"), reveal = query.get("reveal"), promptId = query.get("promptId"), revision = query.get("revision");
  if ((as !== null && (!/^[0-3]$/.test(as) || Number(as) >= seatCountFor(room!.session.format)))
    || (reveal !== null && reveal !== "0" && reveal !== "1")
    || (promptId !== null && (!promptId || promptId.length > 200))
    || (revision !== null && (!/^(0|[1-9]\d*)$/.test(revision) || !Number.isSafeInteger(Number(revision))))
    || (fork && allowed === "cards" && (as === null || promptId === null || revision === null))) {
    throw new DuelServiceError("Invalid replay fork control request", 400);
  }
  return { ...(as !== null ? { as: Number(as) } : {}), ...(reveal !== null ? { reveal: reveal === "1" } : {}),
    ...(promptId !== null ? { promptId } : {}), ...(revision !== null ? { revision: Number(revision) } : {}) };
}

/** Normal admission and series routes never accept a fork or a seat override. */
export function assertNormalDuelRequest(request: Request, room: DuelRoom) {
  if (room && isReplayFork(room.session)) throw new DuelServiceError("Replay forks cannot use lobby or series operations", 409);
  readDuelControl(request, room);
}

/** Dev scenario tools (presets page, Report button). Server side only. Exactly "1" turns them on. */
export function scenariosEnabled(): boolean {
  return process.env.DUEL_SCENARIOS === "1";
}

export function scenariosOffResponse(): NextResponse {
  return NextResponse.json({ error: "Not found" }, { status: 404, headers: { "cache-control": "private, no-store" } });
}

export type DuelActor =
  | { ok: true; guildId: string; playerId: number; userId: number; duels: DuelService }
  | { ok: false; response: NextResponse };

export async function requireDuelActor(options: { createPlayer?: boolean } = {}): Promise<DuelActor> {
  const actor = await requireWebAccess();
  if (!actor.ok) { actor.response.headers.set("cache-control", "private, no-store"); return actor; }
  const guildId = env.discordGuildId;
  if (!guildId) {
    return { ok: false, response: NextResponse.json({ error: "Guild is not configured" }, { status: 500, headers: { "cache-control": "private, no-store" } }) };
  }
  const db = getDb();
  const players = createPlayerService(db);
  const player = options.createPlayer === false ? players.findByGuildAndUser(guildId, actor.userId)
    : players.findOrCreate(guildId, actor.userId, actor.userName);
  if (!player) return { ok: false, response: NextResponse.json({ error: "Player not found" }, { status: 404 }) };
  return { ok: true, guildId, playerId: player.id, userId: actor.userId, duels: createDuelService(db) };
}

export function duelErrorResponse(error: unknown) {
  if (error instanceof DuelInviteRefusalError) {
    return NextResponse.json({
      error: error.message,
      code: error.code,
    }, { status: 409, headers: { "cache-control": "private, no-store" } });
  }
  // Missing slugs and hidden replay forks must have the same response.
  if (error instanceof DuelServiceError && error.status === 404 && error.message === "Duel not found") {
    error = new ReplayAccessError(404);
  }
  if (error instanceof ReplayAccessError) {
    return NextResponse.json({ error: error.message, code: error.code }, {
      status: error.status, headers: { "cache-control": "private, no-store" },
    });
  }
  if (
    error instanceof DuelServiceError ||
    error instanceof TournamentDuelError ||
    error instanceof SavedDeckServiceError
  ) {
    return NextResponse.json({ error: error.message, ...(error instanceof DuelServiceError && error.code ? { code: error.code } : {}) }, { status: error.status, headers: { "cache-control": "private, no-store" } });
  }
  const { body, status } = errorResponseBody(error, { tags: { operation: "[api/duels]" } });
  return NextResponse.json(body, { status, headers: { "cache-control": "private, no-store" } });
}

/** Redact only when internal duel data leaves the web server for a viewer. */
export function redactDuelResult<T>(data: T, guildId: string, playerId: number): T {
  return redactDuelTournamentMetadata(getDb, data, guildId, playerId);
}

function hostErrorBody(text: string, status: number): { expected: boolean; body: { error: string; code?: string; finalBoard?: "available" | "none";
  canOpenUnchecked?: boolean; reason?: ReplayUnverifiedReason; limit?: number; forksUrl?: string; retryAfter?: number } } | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === "object" && "error" in parsed && typeof parsed.error === "string" && parsed.error.trim()) {
      const recovery = "code" in parsed && parsed.code === "FORK_LIMIT"
        && "limit" in parsed && typeof parsed.limit === "number" && Number.isSafeInteger(parsed.limit) && parsed.limit > 0
        && "forksUrl" in parsed && parsed.forksUrl === "/api/admin/duels/forks"
        ? { limit: parsed.limit, forksUrl: parsed.forksUrl } : {};
      const unverified: { reason?: ReplayUnverifiedReason; canOpenUnchecked?: boolean } = status === 409 && "code" in parsed && parsed.code === "REPLAY_UNVERIFIED"
        && "reason" in parsed && (parsed.reason === "board_mismatch" || parsed.reason === "command_mismatch" || parsed.reason === "no_saved_board")
        ? { reason: parsed.reason, canOpenUnchecked: "canOpenUnchecked" in parsed && parsed.canOpenUnchecked === true } : {};
      return { expected: "expected" in parsed && parsed.expected === true, body: { error: parsed.error, ...("code" in parsed && typeof parsed.code === "string" ? { code: parsed.code } : {}),
        ...("code" in parsed && typeof parsed.code === "string"
          && ((status === 409 && ["ENGINE_UNAVAILABLE_FOR_SOURCE", "REPLAY_MISMATCH", "NOT_PLAYABLE", "REPLAY_UNVERIFIED"].includes(parsed.code))
            || (status === 413 && parsed.code === "REPLAY_TOO_LARGE"))
          && "finalBoard" in parsed && (parsed.finalBoard === "available" || parsed.finalBoard === "none") ? { finalBoard: parsed.finalBoard } : {}), ...recovery, ...unverified,
        ...((status === 429 || status === 503) && "retryAfter" in parsed && typeof parsed.retryAfter === "number" && Number.isSafeInteger(parsed.retryAfter) && parsed.retryAfter > 0
          ? { retryAfter: parsed.retryAfter } : {}) } };
    }
  } catch {}
  return undefined;
}

export function duelHostConfigProblem(cfg: { url: string; secret: string }): string | null {
  const missing = [!cfg.url && "DUEL_INTERNAL_URL", !cfg.secret && "DUEL_INTERNAL_SECRET"].filter(Boolean);
  if (missing.length === 0) return null;
  return `The duel engine is not set up on this server: ${missing.join(" and ")} ${missing.length > 1 ? "are" : "is"} missing. Ask the server admin to add ${missing.length > 1 ? "them" : "it"} to .env and restart the web and duel services.`;
}

export async function callDuelHost(input: {
  op: DuelHostOp;
  reportId?: number;
  slug?: string;
  guildId: string;
  /** Admin spectate POV or add-bot target seat. Never an action identity. */
  seat?: number | null;
  /** Trusted web session users.id. Owner operations must recheck its stored player mapping on the host. */
  userId?: number;
  as?: number;
  promptId?: string;
  revision?: number;
  cursor?: ReplayForkRequest["cursor"];
  sourceVersion?: string;
  requestId?: string;
  unchecked?: boolean;
  /** Replay contract and server card projection. Camera position stays in the browser. */
  version?: 1 | 2;
  visibility?: "mine" | "public";
  /** Owner replay and fork views: reveal hands/Extra Decks in the selected projection. */
  reveal?: boolean;
  /** view only: an eliminated FFA player watches through the public view. */
  spectate?: boolean;
  command?: DuelCommand;
  board?: SandboxBoard;
  run?: SandboxRun;
  scenarioId?: number;
  control?: SandboxBotMode;
  to?: string;
  /** Bounded presentation preference of this authenticated viewer. */
  animationSpeed?: number;
  deck?: DuelDeck;
  query?: string;
  codes?: number[];
  /** normalize-codes only: retain known artwork passcodes for storage/display. */
  preserveArtwork?: boolean;
  /** normalize-codes only: remote lookup allowance, carried between batches. */
  lookupLimit?: number;
  cacheOnly?: boolean;
  includeCanonical?: boolean;
  /** Host-only kick or explicit player invitation. Never an acting identity. */
  targetPlayerId?: number;
  /** start-preset only. */
  presetId?: string;
  /** start-preset only: four decimal strings (the core seed). */
  seed?: string[];
  /** start-test-duel only: shuffle the deck, go first, and the Genesys cap of the deck's format. */
  shuffle?: boolean;
  goFirst?: boolean;
  genesys?: { pointCap: number } | null;
  /** report only: the tester's note. */
  note?: string;
  cardQuery?: CardQuery;
  /** Rules for `check-deck`. */
  mode?: DuelMode;
  format?: DuelFormat;
  masterRule?: DuelMasterRule;
  settings?: unknown;
  /** suggestion-scope only: deck-building format, separate from the duel table format. */
  suggestionFormat?: "normal" | "domain" | "genesys" | "genesys-domain";
  /** deck-suggestions only: strict public query and a completed web result's context version. */
  suggestionQuery?: DeckSuggestionQuery;
  suggestionVersion?: string;
  /** bridges only: bounded public query; the host rechecks the trusted actor. */
  bridgeRequest?: BridgeRequest;
  banlist?: string;
  deckMaster?: number;
  /** check-deck only: the server loads this player's durable draft pool. */
  draftId?: number | null;
  /** Rock-paper-scissors move for `opening-pick`. */
  move?: DuelRpsMove;
  /** First or second for `opening-choose` and `series-first`. */
  choice?: DuelFirstChoice;
  /** chain-mode only: the response switch position for the caller's own seat. */
  chainMode?: DuelChainMode;
} & ({ op: "admin-spectate"; userId: number; playerId?: never } | { op: Exclude<DuelHostOp, "admin-spectate">; playerId: number }), signal?: AbortSignal): Promise<{ ok: true; data: unknown } | { ok: false; response: NextResponse; retryable?: boolean }> {
  const replayOp = input.op === "bug-replay-frame" || input.op === "replay" || input.op === "owner-replay" || input.op === "replay-fork"
    || input.op === "fork-list" || input.op === "fork-restart" || input.op === "fork-cancel";
  const failure = (body: NonNullable<ReturnType<typeof hostErrorBody>>["body"], status: number): NextResponse => NextResponse.json({
    ...body, ...(!body.code && (replayOp ? status >= 500 : [502, 503, 504].includes(status))
      ? { code: replayOp ? "ENGINE_BUSY" : "DUEL_ENGINE_ERROR" } : {}),
  }, { status: replayOp && status >= 500 ? 503 : status,
    headers: { "cache-control": "private, no-store", ...((status === 429 || status === 503) && body.retryAfter ? { "Retry-After": String(body.retryAfter) } : {}) } });
  const cfg = { url: env.duelInternalUrl, secret: env.duelInternalSecret };
  const configProblem = duelHostConfigProblem(cfg);
  if (configProblem) {
    log("warn", "[duel-host] configuration is incomplete");
    return { ok: false, response: failure({ error: configProblem, ...(!replayOp ? { code: "DUEL_ENGINE_CONFIG" } : {}) }, 503), retryable: false };
  }
  const bridgeRead = input.op === "bridges" && ["engines", "from", "between"].includes(input.bridgeRequest?.op ?? "");
  const bridgeReadTimeoutMs = 25_000;
  const transport = signedTransport({ ...cfg, signal, purpose: "duel-host", ...(bridgeRead ? { timeoutMs: bridgeReadTimeoutMs }
    : input.op === "engine-data-status" || input.op === "bug-context" || input.op === "bridges" ? { timeoutMs: 5000 }
    : input.op === "normalize-codes" || input.op === "validate-deck-master" ? { timeoutMs: 20000 }
    : replayOp ? { timeoutMs: 30_000 } : {}) });
  const payload: Record<string, unknown> = {
    op: input.op,
    guildId: input.guildId,
    playerId: input.playerId,
  };
  if (input.targetPlayerId !== undefined) payload.targetPlayerId = input.targetPlayerId;
  if (input.reportId !== undefined) payload.reportId = input.reportId;
  if (input.userId !== undefined) payload.userId = input.userId;
  if (input.as !== undefined) payload.as = input.as;
  if (input.promptId !== undefined) payload.promptId = input.promptId;
  if (input.revision !== undefined) payload.revision = input.revision;
  if (input.cursor !== undefined) payload.cursor = input.cursor;
  if (input.sourceVersion !== undefined) payload.sourceVersion = input.sourceVersion;
  if (input.requestId !== undefined) payload.requestId = input.requestId;
  if (input.unchecked !== undefined) payload.unchecked = input.unchecked;
  if (input.version !== undefined) payload.version = input.version;
  if (input.visibility !== undefined) payload.visibility = input.visibility;
  if (input.reveal !== undefined) payload.reveal = input.reveal;
  if (input.slug) payload.slug = input.slug;
  if (input.op === "view" && input.spectate === true) payload.spectate = true;
  if (input.command) payload.command = input.command;
  if (input.animationSpeed !== undefined) payload.animationSpeed = input.animationSpeed;
  if (input.deck) payload.deck = input.deck;
  if (input.query !== undefined) payload.query = input.query;
  if (input.codes !== undefined) payload.codes = input.codes;
  if (input.preserveArtwork !== undefined) payload.preserveArtwork = input.preserveArtwork;
  if (input.lookupLimit !== undefined) payload.lookupLimit = input.lookupLimit;
  if (input.cacheOnly !== undefined) payload.cacheOnly = input.cacheOnly;
  if (input.includeCanonical !== undefined) payload.includeCanonical = input.includeCanonical;
  if (input.draftId !== undefined) payload.draftId = input.draftId;
  if (input.seat !== undefined) payload.seat = input.seat;
  if (input.presetId !== undefined) payload.presetId = input.presetId;
  if (input.seed !== undefined) payload.seed = input.seed;
  if (input.shuffle !== undefined) payload.shuffle = input.shuffle;
  if (input.goFirst !== undefined) payload.goFirst = input.goFirst;
  if (input.genesys !== undefined) payload.genesys = input.genesys;
  if (input.note !== undefined) payload.note = input.note;
  if (input.cardQuery !== undefined) payload.cardQuery = input.cardQuery;
  if (input.mode !== undefined) payload.mode = input.mode;
  if (input.format !== undefined) payload.format = input.format;
  if (input.masterRule !== undefined) payload.masterRule = input.masterRule;
  if (input.settings !== undefined) payload.settings = input.settings;
  if (input.suggestionFormat !== undefined) payload.suggestionFormat = input.suggestionFormat;
  if (input.suggestionQuery !== undefined) payload.suggestionQuery = input.suggestionQuery;
  if (input.suggestionVersion !== undefined) payload.suggestionVersion = input.suggestionVersion;
  if (input.bridgeRequest !== undefined) payload.bridgeRequest = input.bridgeRequest;
  if (input.banlist !== undefined) payload.banlist = input.banlist;
  if (input.deckMaster !== undefined) payload.deckMaster = input.deckMaster;
  if (input.move !== undefined) payload.move = input.move;
  if (input.choice !== undefined) payload.choice = input.choice;
  if (input.chainMode !== undefined) payload.mode = input.chainMode;

  if (input.as !== undefined) payload.as = input.as;
  if (input.reveal !== undefined) payload.reveal = input.reveal;
  if (input.board !== undefined) payload.board = input.board;
  if (input.run !== undefined) payload.run = input.run;
  if (input.scenarioId !== undefined) payload.scenarioId = input.scenarioId;
  if (input.control !== undefined) payload.control = input.control;
  if (input.to !== undefined) payload.to = input.to;

  const started = performance.now();
  const result = await transport.post("/internal/duel", JSON.stringify(payload));
  if (!result.ok) {
    // Next's ResponseAborted has no message. A caller disconnect is expected,
    // and must never turn into a reported Error("") or a false host outage.
    if (signal?.aborted) {
      log("info", "[duel-host] request cancelled", { operation: input.op, hostStatus: result.status, hostBody: result.text.slice(0, 2048) });
      return { ok: false, response: failure({ error: "The duel engine request was cancelled." }, 503), retryable: false };
    }
    // The web's own deadline can race an empty-message fetch abort. A read
    // still initializing is retryable; it is not evidence that bridge data is absent.
    if (bridgeRead && result.status === 0 && (result.text === "Internal request timed out"
      || performance.now() - started >= bridgeReadTimeoutMs)) {
      log("info", "[duel-host] bridge read still loading", { operation: input.bridgeRequest?.op, hostStatus: result.status });
      return { ok: false, response: failure({ error: "Bridges are still loading. Try again shortly.", code: "BRIDGES_LOADING", retryAfter: 1 }, 503), retryable: true };
    }
    const context = { tags: { operation: input.op }, extra: { hostStatus: result.status, hostBody: result.text.slice(0, 2048) } };
    const hostError = () => new Error(`Duel host ${input.op} failed (HTTP ${result.status}): ${result.text.trim().slice(0, 2048) || "<empty response body>"}`);
    if (input.op === "bug-context") {
      // Capture retries use the original host result. Other operations map some 4xx responses to 503.
      const timedOut = result.status === 0 && result.text === "Internal request timed out";
      const status = result.status >= 400 && result.status < 600 ? result.status : 503;
      return { ok: false, response: failure({ error: "Could not capture duel data" }, status),
        retryable: timedOut || (result.status >= 500 && result.status < 600) };
    }
    if (result.status < 400) {
      report(hostError(), context);
      const error = result.text === "Internal request timed out"
        ? "The duel engine request timed out. It may be restarting. Try again in a moment."
        : "The duel engine did not answer. It may be restarting. Try again in a moment.";
      return { ok: false, response: failure({ error, ...(!replayOp ? { code: "DUEL_UPSTREAM_UNAVAILABLE" } : {}) }, 503) };
    }
    if (result.status === 401) {
      // The host answers 401 only for a bad signature.
      const error = "The duel engine refused the web server: their DUEL_INTERNAL_SECRET values do not match. Ask the server admin to fix .env and restart both services.";
      log("warn", "[duel-host] request was refused", { operation: input.op, hostStatus: result.status, hostBody: result.text.slice(0, 2048) });
      return { ok: false, response: failure({ error, ...(!replayOp ? { code: "DUEL_ENGINE_CONFIG" } : {}) }, 503) };
    }
    const parsed = hostErrorBody(result.text, result.status);
    if (!parsed || (result.status === 500 && !parsed.expected)) {
      const { body, status } = errorResponseBody(hostError(), context);
      return { ok: false, response: NextResponse.json(body, { status, headers: { "cache-control": "private, no-store" } }) };
    }
    return { ok: false, response: failure(parsed.body, result.status) };
  }
  if (!result.text) {
    log("warn", "[duel-host] empty response", { operation: input.op, hostStatus: result.status, hostBody: result.text });
    return { ok: false, response: failure({ error: "Empty engine response" }, 502) };
  }
  let data: unknown;
  try {
    data = JSON.parse(result.text);
  } catch {
    log("warn", "[duel-host] invalid JSON response", { operation: input.op, hostStatus: result.status, hostBody: result.text.slice(0, 2048) });
    return { ok: false, response: failure({ error: "Invalid engine response" }, 502) };
  }
  return { ok: true, data: input.op === "admin-spectate" ? data : redactDuelResult(data, input.guildId, input.playerId) };
}

/** Strict query parsing prevents private view flags from reaching the ordinary host operation. */
export function readReplayQuery(request: Request, privileged = false) {
  const query = new URL(request.url).searchParams;
  const allowed = privileged ? ["version", "visibility", "seat", "reveal", "unchecked"] : ["version", "visibility", "unchecked"];
  const invalid = () => ({ ok: false as const, response: NextResponse.json({ error: "Invalid replay request", code: "INVALID_CURSOR" },
    { status: 400, headers: { "cache-control": "private, no-store" } }) });
  if ([...query.keys()].some(key => !allowed.includes(key) || query.getAll(key).length !== 1)) return invalid();
  const version = query.get("version"); const visibility = query.get("visibility");
  const seat = query.get("seat"); const reveal = query.get("reveal");
  const unchecked = query.get("unchecked");
  if ((version !== null && (privileged ? version !== "2" : version !== "1" && version !== "2"))
    || (visibility !== null && visibility !== "mine" && visibility !== "public")
    || (seat !== null && !/^[0-3]$/.test(seat)) || (reveal !== null && reveal !== "0" && reveal !== "1")
    || (unchecked !== null && unchecked !== "1")) return invalid();
  return { ok: true as const, input: {
    ...(version !== null ? { version: Number(version) as 1 | 2 } : privileged ? { version: 2 as const } : {}),
    ...(visibility !== null ? { visibility: visibility as "mine" | "public" } : {}),
    ...(seat !== null ? { seat: Number(seat) } : {}), ...(reveal !== null ? { reveal: reveal === "1" } : {}),
    ...(unchecked !== null ? { unchecked: true } : {}),
  } };
}

export function sessionFromHost(data: unknown) {
  if (data && typeof data === "object" && "session" in data) {
    return { session: data.session,
      ...("startBlocked" in data && typeof data.startBlocked === "string" ? { startBlocked: data.startBlocked } : {}) };
  }
  return { session: data };
}

/** Typed operator snapshot over the same HMAC-authenticated internal channel. */
export async function callEngineDataStatus(input: { guildId: string; playerId: number }): Promise<
  { ok: true; data: CardDataStatus } | { ok: false; response: NextResponse }
> {
  const result = await callDuelHost({ ...input, op: "engine-data-status" });
  if (!result.ok) return result;
  return { ok: true, data: result.data as CardDataStatus };
}

/** Ignore absent/invalid preferences; the host clamps valid rates again. */
export function duelAnimationSpeed(request: Request): { animationSpeed?: number } {
  const raw = request.headers.get("x-duel-animation-speed");
  if (raw === null) return {};
  const speed = Number(raw);
  return Number.isFinite(speed) && speed >= 0.5 && speed <= 2 ? { animationSpeed: speed } : {};
}
