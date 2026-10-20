import { ExpectedError, errorResponseBody, log, report } from "@yugidraft/shared/observability";
import { createBugReportService, createStoredBoardReader, readStoredBoard, storedBoardStamp, STORED_BOARD_COLUMNS, duelSnapshotRetentionConfig, runDuelSnapshotRetention, DUEL_LIVE_IDLE_REASON, parseDeckSuggestionQuery, type StoredDuelBoards } from "@yugidraft/shared/services";
import { cardBlockIndex, loadCardBlockList, mergeCardBlockEntries, type CardBlockEntry } from "./card-block-list.js";
import { createAutoBlockPolicy } from "./script-error-autoblock.js";
import { cardScriptHash, scriptEngineKind, type ScriptEngineKind } from "./card-script-hash.js";
import { loadCardPasscodeRemaps } from "@yugidraft/shared/db";
import { createScriptErrorRecorder } from "./script-error-store.js";
import { scriptErrorModeFromEnv } from "./script-errors.js";
import { createHash, randomBytes } from "node:crypto";
import { readSignedRequest } from "@yugidraft/shared/internal-auth";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type Database from "better-sqlite3";
import { assertDuelForkAccess, assertOwnerReplaySourceAccess, assertReplayForkAccess, resolveOwnerPlayer, ReplayAccessError } from "@yugidraft/shared/access/owner-access";
import { createLocalCardDataStatus, type EngineDataManifest } from "./card-data-status.js";
import { createGithubCardDataStatus } from "./github-card-data-status.js";
import { CARD_LOOKUP_LIMIT, readArchetypeGuide, createCardLookupBudget, loadArtworkIdentityCatalog, createDeckCopyRepairService, findDuelEventTarget, createDuelSeriesService, createDeckTypeLookup, createDuelService, createReplayForkService, createTournamentDuelService, ReplayForkStorageError, DuelServiceError, TournamentDuelError, isCardFetchError, type DuelFinalSnapshots, type DuelPrivateState } from "@yugidraft/shared/services";
import type {
  DuelAnswer,
  DuelCardInfo,
  DuelCommand,
  DuelDeck,
  DuelEngineChoice,
  DuelEngineView,
  DuelFormat,
  DuelMode,
  DuelOpeningState,
  DuelPrompt,
  DuelReplayV2,
  ReplayFrameV2,
  ReplayVisibility,
  DuelRoom,
  DuelSeriesSummary,
  DuelSession,
  DuelSettings,
  DuelScriptErrorMode,
  ReplaySource,
  ReplayErrorCode,
} from "@yugidraft/shared/duels";
import {
  CardQueryError, DUEL_BANLIST_OPTIONS, DuelSettingsError, deckCardCounts, duel1v1EngineForMode, isFirstChoice, isReplayFork, isReplaySeed, isRpsMove, multiplayerSeatsBlockReason, multiplayerTablesEnabled,
  COIN_TIMING, COIN_CHAIN_BEAT_MAX_MS, MIN_DUEL_FX_SPEED, coinTossDurationMs,
  CHAIN_MODE_JOURNAL_LIMIT, CHAIN_MODE_PROMPT_PREFIX, chainModeOf, isDuelChainMode, normalizeDuelSettings, opponentSeatsOf, parseCardQuery, seatCountFor, teamOfSeat, DUEL_OPENING_PICK_MS, DUEL_OPENING_REVEAL_MS, DUEL_RPS_MOVES,
  isCompetitiveDuel,
} from "@yugidraft/shared/duels";
import { ELIMINATE_PROMPT_PREFIX as ELIMINATE_PREFIX, eliminationCodeOf, eliminationAtTurnEnd } from "./engine.js";
import { EngineAnswerError } from "./prompts.js";
import { ENGINE_LOOP_REASON, EngineLoopError } from "./engine-loop-error.js";
import { validateAnswer } from "./answer-validation.js";
import { RequestError } from "./request-error.js";
import { WorkerPool, type WorkerReservation } from "./worker-pool.js";
import { DeckSuggestionWorkers } from "./deck-suggestion-workers.js";
import { workerLimitsFromEnv } from "./config.js";
import { GameWorker, limitWorkerOperations, type DuelGameWorker, type LimitedGameWorker, type GameOptions, type WorkerDebugState } from "./worker-client.js";
import { DeckLegalityError, ExtraDeckCardError, deckSuggestionScope, inspectDeck, validateDeck, validateExtraDeckTypes, validateDeckMasterType, type InspectDeckOptions } from "./deck-legality.js";
import { cardArtworkFamily } from "./card-artworks.js";
import { canonicalEngineCardCode, loadDraftDeckPool, normalizeCardCodes, normalizeImportedDeck } from "./deck-import.js";
import { loadCardDatabase } from "./cards.js";
import { cardFacets, queryCards, deckCardUnavailableReason } from "./card-search.js";
import { deckSuggestionsEnabled, effectSearchEnabled, readingArchetypes } from "@yugidraft/shared/cards/effects";
import { cardEffectIndex, cardReleaseIndex, initializeCardEffectIndex } from "./card-effects.js";
import { activeMultiScriptsHash, loadMultiScriptsFor, pinnedEngineVersion } from "./multi-scripts.js";
import { firstTurnDrawFor, savedFirstTurnDraw } from "./first-turn-draw.js";
import { EngineResourceCache } from "./engine-resource-cache.js";
import { ReplayJsonEncoder, replayJsonResponse, type ReplayHttpResult } from "./replay-json.js";
import { buildReplayData, projectReplayFrames, projectReplaySteps, type ReplayBuildData, replayBuildError, replayHasUnsequencedLoss, revealReplayHands, ReplayBuildCache, ReplayBuildError, REPLAY_BUILD_TIMEOUT_MS } from "./replay-builder.js";
import { createReplayCursorCodec, replayPrefixHash, replaySourceVersion, ReplayCursorError } from "./replay-cursor.js";
import { createReplayForkLauncher, listActiveReplayForks, REPLAY_FORK_ACTIVE_LIMIT, ReplayForkLaunchError } from "./replay-fork.js";
import { initialForkSeat, resolveReplayForkSeat, replayForkRoom } from "./replay-fork-seats.js";
import { JournalRunnerError, runJournalPrefix, type JournalResources } from "./journal-runner.js";
import { EngineResourceUnavailableError, resolveEngineResourcesForSource, type EngineResources } from "./engine-resource-resolver.js";
import { isEngineIdentity, isUnknownEngineChoice, sourceEngineChoice, sameEngineIdentity, type EngineIdentity, type ReplayVerification, type ReplayUnverifiedReason } from "@yugidraft/shared/duels";
import { sameReplayBoard } from "./replay-board-comparator.js";
import { createReplayVerificationStore, type ReplayVerificationKey } from "./replay-verification-store.js";
import { botTableOf, buildPracticeBotDeck, choosePracticeBotAnswer, chooseSurrenderedAnswer, PracticeBotError } from "./practice-bot.js";
import {
  freezeContinueClock,
  isClockDue,
  isSeatIndex,
  persistedClockState,
  startDecisionClock,
  stopSeatClock,
  syncDecisionClock,
  withServerNow,
  type DecisionClockView,
} from "./clock.js";
import { chooseScripted, ScriptedBotError, type Rule, type RuleTraceEntry } from "./scripted-bot.js";
import { compileBoard } from "./presets/board.js";
import { setCatalogDirectory } from "./presets/catalog.js";
import { multiDomainCoreAvailable, multiStartProblem } from "./multi-domain-guard.js";
import { getPreset, multiCoreAvailable, multiCoreInfo, PRESETS, SCRIPTED_POLICY, summarizePreset, type PresetIssue } from "./presets/index.js";

/**
 * Most bot answers in one turn before the table counts as stuck. The count restarts when the turn number changes, so a table that
 * only bots are left in (every human gave up at an N-seat table) can play to the end: a duel with 3 bots needs far more than 128
 * answers, and a random bot always ends it (the Decks run out). A bot that loops inside one turn is still caught.
 */
const BOT_ADVANCE_LIMIT = 128;
const BOT_REPLAN_LIMIT = 32;
const BOT_ONLY_TURN_LIMIT = 200;
const DEFAULT_ARCHIVE_AFTER_MS = 10 * 60 * 1000;
const DEFAULT_IDLE_WORKER_MS = 5 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 30 * 1000;
const ARCHIVE_SWEEP_LIMIT = 32;
const CLOCK_SWEEP_LIMIT = 32;
const SERIES_SWEEP_LIMIT = 16;
/** Wait after the 1st, 2nd and later failed starts of one series game; the last value is the cap. */
const START_BACKOFF_MS = [60 * 1000, 5 * 60 * 1000, 15 * 60 * 1000];
const DECK_START_BLOCK_TTL_MS = 15 * 60 * 1000;
const DECK_START_BLOCK_MAX = 256;
const MAX_TIMER_MS = 2 ** 31 - 1;
/** A short pause to show the bot's winning hands before it chooses the first turn. */
const BOT_OPENING_CHOICE_MS = 1_000;
/** Bound one live coin presentation pause, including any already queued grace. */
const MAX_COIN_TOSS_GRACE_MS = 60_000;
/**
 * Real-time margin for pre-toss moves/summons and delivery. The client's move-plan/effect-sequence
 * can queue an 860ms placement and a 1,625ms ordinary summon: 4,970ms at MIN_DUEL_FX_SPEED.
 * Leave another 1,030ms for delivery. This conservative fixed bound avoids duplicating its visual planner.
 */
const COIN_PRE_TOSS_MARGIN_MS = 6_000;
const TIME_LIMIT_REASON = "Time limit";
/** MSG_WIN reason codes from the core (strings.conf victory reasons): 0 Surrendered, 3 Time limit up. */
const WIN_REASON_SURRENDER = 0;
const WIN_REASON_TIME_LIMIT = 3;
const ELIMINATE_PROMPT_PREFIX = ELIMINATE_PREFIX;

/** The win reason code of a journaled elimination, or null when the command is an ordinary answer. */
export function eliminationReasonOf(command: DuelCommand): number | null {
  return eliminationCodeOf(command.promptId);
}
/** Journal note of an answer that the host gave for a surrendered seat. The report uses it to place the surrender line. */
const SURRENDER_AUTOPILOT_NOTE = "autopilot: surrendered";
const DEFAULT_STALL_MS = 30 * 1000;
/** A debug read of a stuck worker gives up after this long. */
const DEFAULT_DEBUG_READ_TIMEOUT_MS = 2000;
/** A report or a room read waits this long in a blocked duel queue before it answers without the core. */
const DEFAULT_QUEUE_BLOCKED_MS = 3000;
const TRACE_LIMIT = 40;
/** The log lines a bug report keeps (the newest). */
const BUG_CONTEXT_LOG_LINES = 15;
/** Only recognized operation names may appear in unexpected request error logs. */
const DUEL_OPS = new Set([
  "engine-data-status", "capabilities", "view", "start", "respond", "deck", "validate-deck", "cards",
  "card-details", "card-artworks", "card-query", "card-facets", "surrender", "add-bot", "archive", "cancel",
  "replay", "owner-replay", "replay-fork", "fork-list", "fork-restart", "fork-cancel", "ready", "unready", "series-side", "series-ready", "series-unready", "series-first",
  "opening-pick", "opening-choose", "normalize-codes", "check-deck", "list-presets", "start-preset",
  "report", "debug-trace", "bug-context", "bug-replay-frame", "chain-mode", "validate-deck-master", "suggestion-scope", "deck-suggestions",
]);

/** Cache identities treat numeric card lists as multisets; the scorer receives the original order. */
function suggestionQueryIdentity(value: unknown): unknown {
  if (Array.isArray(value)) return value.every(item => typeof item === "number")
    ? [...value].sort((a, b) => a - b) : value.map(suggestionQueryIdentity);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, suggestionQueryIdentity(item)]));
  return value;
}

/** What the `bug-context` op answers: public duel facts only. */
interface BugDuelContext {
  format: DuelFormat;
  mode: DuelMode;
  /** The asking player's seat, or null for a spectator. */
  seat: number | null;
  turn: number | null;
  phase: string | null;
  turnSeat: number | null;
  livingPlayers: number | null;
  /** The newest spectator-view log lines, oldest first. */
  log: string[];
  /** Full spectator snapshot. Saved privately with the report, never included in the public issue. */
  board: DuelEngineView | null;
  source: "live" | "cached" | "stored" | null;
  moment?: Record<string, unknown>;
  missingReason?: string;
}

function withTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ExpectedError(`${what} timed out after ${ms} ms`, 503)), ms);
  });
  return Promise.race([work, limit]).finally(() => clearTimeout(timer));
}

/** Start checks can fail on a different player's private deck. */
class SeatDeckLegalityError extends DeckLegalityError {
  constructor(readonly slug: string, readonly playerId: number, readonly legalityError: DeckLegalityError, readonly startStateHash: string) {
    super(legalityError.message);
    this.name = "SeatDeckLegalityError";
  }
}

type BotOutcome = { kind: "stop" } | { kind: "replan" } | { kind: "acted"; visible: boolean };

type LiveGame = {
  game: DuelGameWorker;
  lastRequestAt: number;
  guildId: string;
  /** Conservative end of live queued chain/coin FX. Recovery skips old FX and starts a fresh queue. */
  fxReadyAt?: number;
  /**
   * Seats whose prompts the host answers with passes after a surrender.
   * Queue commands restore these seats after recovery. Old cores also use the saved setup field.
   */
  surrendered: Set<number>;
  /** Scripted bot rules by seat (hand scenarios). Seats not in the map play like the random practice bot. */
  policies: Map<number, Rule[]>;
  /** The rules tried for each auto seat's latest prompt (debug-trace). Kept in memory only. */
  traces: Map<number, RuleTraceEntry[]>;
  /** A hand scenario table. Its scripts are written against every response window, so it has no chain response switch. */
  presetId?: string;
};

/** One background loop plays the practice bot's turns at a human pace; at most one per duel. */
interface BotLoop {
  cancelled: boolean;
  /** Wakes the loop's current pause so it can notice cancellation. */
  wake: (() => void) | null;
  done: Promise<void>;
  /** The bot's pause before its next step (debug-trace). */
  timer: { seat: number; delayMs: number; startedAt: number; dueAt: number } | null;
}

interface BotPlan {
  /** The seat the bot answers for. Every bot answers only its own seat's prompts. */
  seat: number;
  promptId: string;
  revision: number;
  answer: DuelAnswer;
  /** Scripted bot: why the rule answered. Saved in the journal next to the command. */
  note?: string;
  delayMs: number;
  /** Relative weight of what the bot is about to do, used to size the pause after a visible action. */
  cost: number;
  /** The turn number of the duel when the step was planned (the stuck-bot count restarts with a new turn). */
  turn: number;
}

/** Relative pause weights. The base delay is the pause before a summon, set or activation. */
const BOT_COST_PHASE = 0.6;
const BOT_COST_CHAIN = 0.75;
const BOT_COST_SUMMON = 1;
const BOT_COST_ATTACK = 1.5;
const BOT_COST_FOLLOW_UP = 0.3;
const BOT_JITTER = 0.12;

function botAnswerCost(prompt: DuelPrompt, answer: DuelAnswer): number {
  if (prompt.context?.type === "chain") return BOT_COST_CHAIN;
  const choice = answer.choice;
  if (prompt.kind !== "choice" || typeof choice !== "string") return BOT_COST_FOLLOW_UP;
  if (choice.startsWith("attack:")) return BOT_COST_ATTACK;
  if (/^(summon|spsummon|mset|sset|activate):/.test(choice)) return BOT_COST_SUMMON;
  if (choice === "to_bp" || choice === "to_m2" || choice === "to_ep" || choice === "shuffle") return BOT_COST_PHASE;
  if (prompt.context?.type === "action") return BOT_COST_PHASE;
  return BOT_COST_FOLLOW_UP;
}

/** Human-like pause: `base` ms scaled by what the bot does, with a little jitter. Exported for tests. */
export function practiceBotDelay(base: number, cost: number, random: () => number = Math.random): number {
  if (!(base > 0)) return 0;
  const jitter = 1 + (random() * 2 - 1) * BOT_JITTER;
  return Math.max(0, Math.round(base * cost * jitter));
}

function newestEventId(view: DuelEngineView): number {
  let newest = 0;
  for (const event of view.events) newest = Math.max(newest, event.id);
  return newest;
}

function chainBeatDurationMs(view: DuelEngineView, afterEventId: number, throughEventId = Infinity): number {
  const beats = view.events.filter((event) => event.id > afterEventId && event.id < throughEventId
    && (event.kind === "chain-end" || (event.chainIndex != null && event.chainIndex >= 1
      && ["activate", "target", "chain-resolving", "chain-resolved", "chain-negated"].includes(event.kind)))).length;
  return beats * COIN_CHAIN_BEAT_MAX_MS / MIN_DUEL_FX_SPEED;
}

/** Only events emitted by this live command count; snapshots and journal replay do not grant grace. */
function freshCoinTossGraceMs(view: DuelEngineView, afterEventId: number): number {
  let duration = 0;
  let events = 0;
  let lastTossId = 0;
  for (const event of view.events) {
    if (event.id <= afterEventId || event.kind !== "toss" || event.toss?.type !== "coin" || event.toss.results.length === 0) continue;
    duration += coinTossDurationMs(event.toss.results.length, MIN_DUEL_FX_SPEED);
    events++;
    lastTossId = Math.max(lastTossId, event.id);
  }
  if (events === 0) return 0;
  // Earlier batches are already accounted for by fxReadyAt. Count only this command's
  // beats before the toss, so a fast answer cannot charge the same chain prefix twice.
  return Math.min(MAX_COIN_TOSS_GRACE_MS, duration + chainBeatDurationMs(view, afterEventId, lastTossId)
    + (COIN_TIMING.chainLeadMs + (events - 1) * COIN_TIMING.gapMs) / MIN_DUEL_FX_SPEED
    + COIN_TIMING.safetyMarginMs + COIN_PRE_TOSS_MARGIN_MS);
}

function freezeView(
  view: DuelEngineView,
  result: NonNullable<DuelEngineView["result"]>,
): DuelEngineView {
  return { ...view, prompt: null, prioritySeat: null, result,
    seats: view.seats.map((seat) => seat.pendingElimination ? { ...seat, pendingElimination: false } : seat) };
}

/** What the duel host tells the ws server about a tournament bracket slot. */
export interface TournamentNotice {
  kind: "match-updated" | "completed";
  /** Tournament web slug. */
  slug: string;
}

export interface DuelHost {
  handle(request: Request): Promise<Response>;
  close(): Promise<void>;
}

/** Remove private creator/origin metadata from manual and partial report setup. */
export function reportSetup(setup: DuelPrivateState["setup"]) {
  if (!setup) return null;
  const { replayFork: _replayFork, ...rules } = setup;
  return rules;
}

export function createDuelHost(options: {
  db: Database.Database;
  dataDirectory: string;
  secret: string;
  searchCards: (query: string) => DuelCardInfo[];
  onChange?: (slug: string, guildId: string) => void | Promise<void>;
  /** A finished game moved a tournament bracket slot (`match-updated`) or finished the tournament (`completed`). */
  notifyTournament?: (notice: TournamentNotice) => void | Promise<void>;
  archiveAfterMs?: number;
  idleWorkerMs?: number;
  pollIntervalMs?: number;
  now?: () => number;
  createWorker?: () => DuelGameWorker;
  maxWorkers?: number;
  maxTablesPerPlayer?: number;
  workerHeapMb?: number;
  opTimeoutMs?: number;
  createTimeoutMs?: number;
  /**
   * Practice bot pacing. 0 or undefined keeps the synchronous behaviour: the bot answers every prompt inside the
   * human's request. A positive number is the base pause in ms (scaled by action: about 0.6x for phase moves,
   * 1x for summons, sets and activations, 1.5x for attacks); a function returns the pause in ms for a prompt.
   * When positive, the bot plays in a background loop and calls `onChange` after each step.
   */
  botStepDelayMs?: number | ((prompt: DuelPrompt) => number);
  /**
   * Stall watchdog: when the revision of an active duel stays the same for this many ms while a bot seat or the
   * core must act, the host writes one `auto-stall` report folder. Default: env `DUEL_STALL_MS`, else 30000 when `DUEL_SCENARIOS=1`, else 0. 0 turns it off.
   */
  stallMs?: number;
  /** How long a debug read (views, diagnostics) waits for a stuck worker. Default 2000. Tests make it shorter. */
  debugReadTimeoutMs?: number;
  /**
   * How long a `report` or a room read (`view`) waits in a blocked duel queue. After that, a report is written
   * without the core (`partial: true`) and a room read answers the last view sent to that seat (`stale: true`). Default 3000 when
   * `DUEL_SCENARIOS=1`, else 0 (off: a room read waits for the queue). A `report` needs `DUEL_SCENARIOS=1` anyway.
   */
  queueBlockedMs?: number;
  /** Total replay/fork request deadline, including queue/resources. Capped at 28s, below web transport (30s). */
  replayRequestTimeoutMs?: number;
  /** Detached fork run and handoff limit. Production defaults to 20s, capped at 25s. */
  forkTimeoutMs?: number;
  /** Known problems per preset id, for the dev presets page (`list-presets` answers them as `issues`). Default: none. */
  presetIssues?: (presetId: string) => PresetIssue[];
  /**
   * Rock-paper-scissors before game 1 of every 1v1 duel and match. Off by default so a Start duel starts at once
   * (tests, tools); the duel server turns it on.
   */
  openingRps?: boolean;
  /** Random source for the practice bot's moves and for timed-out picks. */
  random?: () => number;
  /** Optional deterministic die source for tests. Production uses crypto.randomInt(1, 7). */
  rollDie?: () => number;
}): DuelHost {
  if (!options.secret) throw new Error("DUEL_INTERNAL_SECRET is required");
  let deckCopies: ReturnType<typeof createDeckCopyRepairService> | undefined;
  const repairEngine = () => loadArtworkIdentityCatalog(options.dataDirectory);
  const repairDeckCopies = () => deckCopies ??= createDeckCopyRepairService(options.db, repairEngine);
  const service = createDuelService(options.db, { rollDie: options.rollDie });
  const series = createDuelSeriesService(options.db, repairEngine);
  const competitive = (session: DuelSession) => !isReplayFork(session)
    && isCompetitiveDuel(session.ranked === true, series.forDuel(session.id)?.tournamentMatchId);
  const manifest = JSON.parse(readFileSync(join(options.dataDirectory, "manifest.json"), "utf8")) as EngineDataManifest;
  if (!manifest.bundleVersion) throw new Error("Engine resource manifest has no bundle version");
  const localCardDataStatus = createLocalCardDataStatus(options.db, options.dataDirectory, { manifest, now: options.now });
  const githubCardDataStatus = createGithubCardDataStatus({ now: options.now });
  setCatalogDirectory(options.dataDirectory);
  const pinnedVersionFor = (format: DuelFormat): string =>
    pinnedEngineVersion(manifest.bundleVersion, seatCountFor(format), seatCountFor(format) > 2 ? activeMultiScriptsHash(options.dataDirectory) : null);
  const games = new Map<string, LiveGame>();
  const replayCache = new ReplayBuildCache<ReplayBuildData>(value => value.cacheBytes);
  const replayVerifications = createReplayVerificationStore(options.db);
  const replayJsonEncoder = new ReplayJsonEncoder();
  const engineResourceCache = new EngineResourceCache();
  const replayCursorCodec = createReplayCursorCodec(options.secret);
  const queues = new Map<string, Promise<unknown>>();
  const remaps = existsSync(join(options.dataDirectory, "card-remaps.json"))
    ? loadCardPasscodeRemaps(options.dataDirectory) : new Map<number, number>();
  const hashes = new Map<string, string | null>();
  let revisionOverlay: ReturnType<typeof loadMultiScriptsFor> | undefined;
  const autoBlocks = createAutoBlockPolicy(options.db, { bundleVersion: manifest.bundleVersion,
    remaps,
    exactCodes: code => {
      const codes = new Set([code]);
      for (const card of loadCardDatabase(options.dataDirectory).all()) {
        if (card.alias && Math.abs(card.alias - card.code) < 10 && (remaps.get(card.alias) ?? card.alias) === code) codes.add(card.code);
      }
      for (const [old, target] of remaps) if (codes.has(target)) codes.add(old);
      return [...codes];
    },
    scriptHash: (code, kind, helperScripts) => {
      const key = JSON.stringify([code, kind, helperScripts]);
      if (!hashes.has(key)) {
        if (kind.startsWith("multi-")) revisionOverlay ??= loadMultiScriptsFor(options.dataDirectory);
        hashes.set(key, cardScriptHash(loadCardDatabase(options.dataDirectory), code, kind, revisionOverlay, helperScripts));
      }
      return hashes.get(key)!;
    }, now: options.now });
  const admissionEntries = (mode: DuelMode = "normal", format: DuelFormat = "1v1", engine: DuelEngineChoice = duel1v1EngineForMode(mode)) =>
    mergeCardBlockEntries(loadCardBlockList(undefined, options.dataDirectory), autoBlocks.entries(scriptEngineKind(mode, format, engine)));
  const recordScriptError = createScriptErrorRecorder(options.db, undefined, autoBlocks);
  const limits = workerLimitsFromEnv();
  const pool = new WorkerPool(options.maxWorkers ?? limits.maxWorkers, options.maxTablesPerPlayer ?? limits.maxTablesPerPlayer);
  const suggestionWorkers = new DeckSuggestionWorkers(options.db, options.dataDirectory);
  const suggestingPlayers = new Set<number>();
  const reservations = new Map<DuelGameWorker, { release: WorkerReservation; session?: DuelSession }>();
  const reservedTableState = options.db.prepare<[number], { status: string; archived_at: string | null }>(
    "select status, archived_at from duels where id = ?",
  );
  function isFinishedTable(session: DuelSession): boolean {
    const row = reservedTableState.get(session.id);
    return !row || row.archived_at !== null || (row.status !== "active" && row.status !== "lobby");
  }
  function releaseFinishedPlayers(): void {
    for (const { release, session } of reservations.values()) {
      if (session && isFinishedTable(session)) release.releasePlayers();
    }
  }
  async function spawn(session?: DuelSession, spawnOptions: {
    duelRef?: number | (() => number | undefined);
    recordErrors?: () => boolean;
    table?: string | (() => string | undefined);
    signal?: AbortSignal;
    players?: number[];
    wait?: boolean;
  } = {}): Promise<LimitedGameWorker> {
    releaseFinishedPlayers();
    for (const [game, { session }] of reservations) {
      if (!game.running && !game.closing) await safeClose(game);
      else if (session && games.get(session.slug)?.game === game && !queues.has(session.slug)
        && !game.debugState?.().busy && isFinishedTable(session)) await disposeGame(session.slug);
    }
    const release = await pool.acquire(spawnOptions.players ?? session?.seats.flatMap((seat) => seat.playerId === null ? [] : [seat.playerId]) ?? [],
      spawnOptions.wait ?? !session, spawnOptions.signal, session?.id);
    try {
      spawnOptions.signal?.throwIfAborted();
      if (stopped) throw new RequestError("The duel server is shutting down.", 503);
      const duelRef = spawnOptions.duelRef ?? session?.id;
      const recordErrors = spawnOptions.recordErrors ?? (() => true);
      const table = spawnOptions.table ?? session?.slug;
      const worker = options.createWorker?.() ?? new GameWorker(
        duelRef === undefined ? undefined : (error) => {
          const duelId = typeof duelRef === "function" ? duelRef() : duelRef;
          if (duelId !== undefined && recordErrors()) recordScriptError(duelId, error);
        },
        (error) => {
          const duelId = typeof duelRef === "function" ? duelRef() : duelRef;
          if (duelId === undefined || !recordErrors()) return;
          const fork = options.db.prepare<[number], { kind: string }>("select kind from duels where id = ?").get(duelId)?.kind === "replay-fork";
          const tableSlug = typeof table === "function" ? table() : table;
          report(new Error(error.message), { tags: { operation: "Card script fatal",
            event: fork ? "replay_fork_script_fatal" : "card_script_fatal",
            ...(fork ? { duelKind: "replay-fork" } : {}),
            ...(tableSlug ? { table: tableSlug } : {}) } });
        },
        { table, heapMb: options.workerHeapMb ?? limits.heapMb, onExit: () => { release(); reservations.delete(game); } },
      );
      const game = limitWorkerOperations(worker, options.opTimeoutMs ?? limits.opTimeoutMs, () => {
        release();
        reservations.delete(game);
      }, options.createTimeoutMs ?? limits.createTimeoutMs);
      reservations.set(game, { release, session });
      return game;
    } catch (error) {
      release();
      throw error;
    }
  }
  const archiveAfterMs = options.archiveAfterMs ?? DEFAULT_ARCHIVE_AFTER_MS;
  const idleWorkerMs = options.idleWorkerMs ?? DEFAULT_IDLE_WORKER_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const now = options.now ?? Date.now;
  const botLoops = new Map<string, BotLoop>();
  const advanceTimers = new Map<number, ReturnType<typeof setTimeout>>();
  /** One timer per duel with a running opening: it fires at the phase deadline. */
  const openingTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Engine starts remain queued; authenticated reads can show startup progress. */
  const startingGames = new Set<string>();
  const random = options.random ?? Math.random;
  /** Series games whose last start failed: the tick sweep skips a slug until `retryAt`. */
  const startBackoff = new Map<string, {
    failures: number;
    retryAt: number;
  }>();
  /** Bounded, short-lived start blockers; hashes avoid retaining private deck data. */
  const deckStartBlocks = new Map<string, { playerId: number; stateHash: string; blockedAt: number }>();
  const deckBlockSession = options.db.prepare<[string], { status: string }>("select status from duels where web_slug = ?");
  const pacedBot = typeof options.botStepDelayMs === "function" || (options.botStepDelayMs ?? 0) > 0;
  const envStall = Number(process.env.DUEL_STALL_MS);
  // The watchdog is a test tool (it reads every seat's view and writes report folders): on only where DUEL_SCENARIOS=1,
  // or where DUEL_STALL_MS says so.
  const defaultStallMs = process.env.DUEL_SCENARIOS === "1" ? DEFAULT_STALL_MS : 0;
  const stallMs = options.stallMs ?? (process.env.DUEL_STALL_MS !== undefined && Number.isFinite(envStall) && envStall >= 0 ? envStall : defaultStallMs);
  const debugReadTimeoutMs = options.debugReadTimeoutMs ?? DEFAULT_DEBUG_READ_TIMEOUT_MS;
  // The stale room read is a test tool like the watchdog: production 1v1 waits for the queue exactly as main did. Off (0) unless
  // DUEL_SCENARIOS=1 or the caller sets queueBlockedMs.
  const queueBlockedMs = options.queueBlockedMs ?? (process.env.DUEL_SCENARIOS === "1" ? DEFAULT_QUEUE_BLOCKED_MS : 0);
  /** The last view built for each seat of each duel (key -1: the spectator). Only views that were built for that seat are kept. */
  const lastViews = new Map<string, Map<number, DuelEngineView>>();
  function rememberView(slug: string, seat: number | null, view: DuelEngineView | null | undefined, source: DuelGameWorker | undefined): void {
    const live = games.get(slug);
    if (!view || !source || live?.game !== source || !source.running || service.get(slug, live.guildId).status !== "active") return;
    let perSeat = lastViews.get(slug);
    if (!perSeat) lastViews.set(slug, (perSeat = new Map()));
    perSeat.set(seat ?? -1, view);
  }
  // A capture and its journal boundary are saved together, before the next command can run.
  const reportCaptures = new Map<string, { board: DuelEngineView; moment: Record<string, unknown> }>();
  function rememberReportCapture(slug: string, guildId: string, board: DuelEngineView) {
    const state = service.privateState(slug, guildId);
    if (!state.seed || !state.bundleVersion || isReplayFork(state.session)) return;
    reportCaptures.set(slug, { board, moment: {
      duelId: state.session.id, journalCount: state.commands.length,
      journalSeq: state.commands.at(-1)?.storedSeq ?? 0, revision: board.revision,
      bundleVersion: state.bundleVersion, engineIdentity: state.setup?.engineIdentity ?? null,
      ruleVersion: state.setup?.engineIdentity?.hostRuleVersion ?? null,
      masterRule: state.session.masterRule, result: board.result,
    } });
  }
  let stopped = false;

  function startedMatch(session: DuelSession): boolean {
    return session.seriesId != null && (
      (session.gameNumber ?? 1) > 1 || session.status !== "lobby" || series.get(session.seriesId, session.guildId).tournamentId !== null
    );
  }

  /** Check one deck against the real table format, so a Tag or FFA table also refuses the cards that do not work there. */
  function sessionCardEntries(session: DuelSession): readonly CardBlockEntry[] {
    return startedMatch(session) ? loadCardBlockList(undefined, options.dataDirectory) : admissionEntries(session.mode, session.format);
  }

  const admittedMatchDeck = options.db.prepare<[number, number, number, number], { deck: string | null }>(`
    select case when player0_id = ? then base_deck0_json
      when player1_id = ? or (vs_bot = 1 and ? is null) then base_deck1_json end as deck
    from duel_series where id = ?
  `);
  function hasAdmittedGenesysPoints(session: DuelSession, playerId: number, deck?: DuelDeck): boolean {
    if (!session.settings.genesys || !deck || !startedMatch(session)) return false;
    // Base decks are captured on game 1 activation or copied from admitted tournament registrations.
    // They survive host restarts. Side swaps and artworks preserve the points-bearing multiset,
    // including every copy and the Deck Master; new identities still require live admission.
    const stored = admittedMatchDeck.get(playerId, playerId, playerId, session.seriesId!)?.deck;
    if (!stored) return false;
    const base = JSON.parse(stored) as DuelDeck;
    const resolve = (code: number) => canonicalEngineCardCode(code, options.dataDirectory);
    const admitted = deckCardCounts(base, resolve);
    const proposed = deckCardCounts(deck, resolve);
    return admitted.size === proposed.size && [...admitted].every(([code, count]) => proposed.get(code) === count);
  }

  const currentGenesysPoints = options.db.prepare<[], { code: number; points: number | null }>(`
    select c.ygoprodeck_id as code,
      case when c.genesys_revision = m.revision then c.genesys_points else null end as points
    from card_catalog c left join genesys_points_meta m on m.id = 1
  `);
  async function genesysAdmissionPoints(settings?: Pick<DuelSettings, "genesys">): Promise<InspectDeckOptions["genesysPoints"]> {
    if (settings && !settings.genesys) return undefined;
    // Read each admission afresh: a new sync must invalidate stale per-card revisions immediately.
    const rows = currentGenesysPoints.all();
    const points = new Map(rows.map(row => [row.code, row.points]));
    const bridged = new Map<number, number | null>();
    const bridge = (code: number, value: number | null) => {
      // Exact canonical rows, even unknown ones, take precedence over all fallback identities.
      if (!points.has(code)) bridged.set(code, bridged.has(code) && bridged.get(code) !== value ? null : value);
    };
    for (const row of rows) {
      const code = remaps.get(row.code);
      if (code !== undefined) bridge(code, row.points);
    }
    const engine = repairEngine();
    const external = rows.filter(row => row.points !== null && !engine.has(remaps.get(row.code) ?? row.code));
    if (external.length) {
      // Imported API passcodes can resolve by name to a different installed engine passcode.
      const normalized = await normalizeCardCodes(external.map(row => row.code), options.dataDirectory, options.db, { cacheOnly: true });
      for (const row of external) {
        const code = normalized.get(row.code);
        // Engine-known artwork rows never supply canonical fallback points.
        if (code != null) bridge(code, row.points);
      }
    }
    for (const [code, value] of bridged) points.set(code, value);
    return points;
  }

  async function withGenesysPoints<T extends DuelCardInfo>(cards: T[]): Promise<T[]> {
    const points = await genesysAdmissionPoints();
    return cards.map(card => ({ ...card, genesysPoints: points?.get(card.canonicalPasscode ?? card.code) ?? null }));
  }

  async function sessionDeckOptions(session: DuelSession, playerId: number, deck?: DuelDeck): Promise<InspectDeckOptions> {
    const table = session.format;
    const cardBlocks = sessionCardEntries(session);
    const genesysPointsAdmitted = hasAdmittedGenesysPoints(session, playerId, deck);
    const genesysPoints = genesysPointsAdmitted ? undefined : await genesysAdmissionPoints(session.settings);
    const tournamentId = session.seriesId ? series.get(session.seriesId, session.guildId).tournamentId : null;
    const draftId = tournamentId === null ? null : createTournamentDuelService(options.db).rules(tournamentId).draftId;
    if (draftId === null) return { table, cardBlocks, genesysPoints, genesysPointsAdmitted };
    const draftPool = await loadDraftDeckPool({ draftId, playerId, guildId: session.guildId, dataDirectory: options.dataDirectory, db: options.db });
    return { table, draftPool, cardBlocks, genesysPoints, genesysPointsAdmitted };
  }

  function cardRequestEntries(body: Record<string, unknown>, guildId: string, playerId: number): readonly CardBlockEntry[] {
    if (typeof body.slug === "string" && body.slug) {
      const { session } = service.room(body.slug, guildId, playerId);
      return sessionCardEntries(session);
    }
    return admissionEntries(body.mode === "domain" ? "domain" : "normal", body.format === "tag" || body.format === "ffa3" || body.format === "ffa4" ? body.format : "1v1");
  }

  const findDeckType = createDeckTypeLookup(options.db, () => loadArtworkIdentityCatalog(options.dataDirectory));

  async function validateSessionDeck(mode: DuelMode, deck: DuelDeck, settings: DuelSettings, format: DuelFormat, context?: { session: DuelSession; playerId: number }): Promise<void> {
    const checks = context ? await sessionDeckOptions(context.session, context.playerId, deck)
      : { table: format, cardBlocks: admissionEntries(mode, format), genesysPoints: await genesysAdmissionPoints(settings) };
    validateExtraDeckTypes(deck, options.dataDirectory, findDeckType);
    validateDeck(mode, deck, options.dataDirectory, settings, checks);
  }

  async function validateDeckMasterWrite(mode: DuelMode, deck: DuelDeck): Promise<void> {
    if (mode !== "domain" || deck?.deckMaster === undefined) return;
    // Resolve imports and artwork ids, but do not require a complete library deck.
    const master = await normalizeImportedDeck({ main: [], extra: [], side: [], deckMaster: deck.deckMaster }, options.dataDirectory, options.db);
    validateDeckMasterType(mode, master, options.dataDirectory);
  }

  function workerCreateOptions(
    mode: DuelMode,
    decks: DuelDeck[],
    seed: string[],
    masterRule: DuelSession["masterRule"],
    settings: DuelSettings,
    format: DuelFormat = "1v1",
    startupScripts?: string[],
    engine?: DuelEngineChoice,
    firstTurnDraw = firstTurnDrawFor(mode, masterRule, format, settings),
    scriptErrorMode: DuelScriptErrorMode = scriptErrorModeFromEnv(),
    resources?: EngineResources,
  ): GameOptions {
    const created: GameOptions = {
      mode,
      decks,
      seed,
      dataDirectory: options.dataDirectory,
      masterRule,
      settings,
      firstTurnDraw,
      scriptErrorMode,
      ...(resources ? { engineIdentity: resources.identity,
        ...(resources.multiScriptsDirectory ? { multiScriptsDirectory: resources.multiScriptsDirectory } : {}) } : {}),
    };
    // 1v1 keeps the exact old options. Other formats name the format; `decks` is one deck per seat in seat order.
    if (format !== "1v1") created.format = format;
    // Hand scenarios: the engine runs these Lua chunks before the duel starts. The worker passes options on unchanged.
    if (startupScripts?.length) {
      created.startupScripts = startupScripts.map((content, index) => ({ name: `startup-${index}.lua`, content }));
    }
    // Only a 1v1 table has a choice of engine. Without a name the worker uses the merged engine.
    if (format === "1v1" && engine) created.engine = engine;
    return created;
  }

  /** Read the global and Standard switches at start. Scenarios need pinned; other formats have no choice. */
  function engineForNewTable(format: DuelFormat, mode: DuelMode, hasStartupScripts = false): DuelEngineChoice | undefined {
    if (format !== "1v1") return undefined;
    return hasStartupScripts ? "pinned" : duel1v1EngineForMode(mode);
  }

  function warmLobbyResources(session: DuelSession): void {
    if (session.status !== "lobby" || isReplayFork(session)) return;
    engineResourceCache.warm(options.dataDirectory, { mode: session.mode, format: session.format,
      engine: engineForNewTable(session.format, session.mode) });
  }

  /** Lift the recorded identity; keep clocks and private fork metadata outside the runner. */
  function journalSourceOf(state: DuelPrivateState): ReplaySource {
    if (!isReplaySeed(state.seed)) throw new JournalRunnerError("Saved seed must contain four nonzero decimal uint64 words", "REPLAY_MISMATCH");
    if (!state.bundleVersion) throw new JournalRunnerError("Source engine resources are not available", "ENGINE_UNAVAILABLE_FOR_SOURCE");
    const { engineIdentity, replayFork: _fork, ...setup } = state.setup ?? {};
    return { session: state.session, decks: state.decks, seed: state.seed, bundleVersion: state.bundleVersion,
      setup, engineIdentity: engineIdentity ?? null, commands: state.commands };
  }

  async function resourcesOfSource(state: DuelPrivateState, purpose: "replay" | "live-recovery" | "fork-recovery" = "replay", engine?: DuelEngineChoice): Promise<EngineResources | undefined> {
    if (stopped) throw new RequestError("The duel server is shutting down.", 503, "ENGINE_BUSY");
    // Old live recovery keeps its historical path. Replays always resolve and check resources.
    if (state.setup?.engineIdentity == null && purpose !== "replay") return undefined;
    try {
      if (engine !== undefined && (purpose !== "replay" || !isUnknownEngineChoice({ session: state.session,
        setup: state.setup, engineIdentity: state.setup?.engineIdentity ?? null }))) {
        throw new EngineResourceUnavailableError("only an unknown replay engine family can be selected");
      }
      const current = await engineResourceCache.get(options.dataDirectory, { mode: state.session.mode, format: state.session.format,
        engine: engine ?? sourceEngineChoice({ setup: state.setup, engineIdentity: state.setup?.engineIdentity ?? null }) });
      if (stopped) throw new RequestError("The duel server is shutting down.", 503, "ENGINE_BUSY");
      return resolveEngineResourcesForSource(options.dataDirectory, {
        session: state.session, setup: engine === undefined ? state.setup : { ...state.setup, engine }, bundleVersion: state.bundleVersion ?? "",
        engineIdentity: state.setup?.engineIdentity ?? null,
      }, current, purpose === "replay" ? "replay-verification" : purpose === "fork-recovery" ? "replay" : purpose);
    } catch (error) {
      if (stopped) throw new RequestError("The duel server is shutting down.", 503, "ENGINE_BUSY");
      if (error instanceof EngineResourceUnavailableError) throw new RequestError(error.message, error.status, error.code);
      throw error;
    }
  }

  /** The runner pins the raw manifest version; B5 also supplies verified files and the exact overlay. */
  function journalResourcesOf(resources?: EngineResources): JournalResources {
    return {
      dataDirectory: resources?.dataDirectory ?? options.dataDirectory,
      bundleVersion: resources?.rawBundleVersion ?? manifest.bundleVersion,
      ...(resources ? { engineIdentity: resources.identity,
        ...(resources.multiScriptsDirectory ? { multiScriptsDirectory: resources.multiScriptsDirectory } : {}) } : {}),
    };
  }

  function drawRuleOf(state: ReturnType<typeof service.privateState>): boolean {
    return savedFirstTurnDraw(state.setup?.firstTurnDraw, state.session.mode, state.session.masterRule, state.session.format);
  }

  /** Seats the host answers for: practice bots, plus seats that surrendered (they only pass). */
  function autoSeatsOf(session: DuelSession, entry: LiveGame | undefined): number[] {
    if (isReplayFork(session)) return [];
    const seats = new Set<number>();
    for (const seat of session.seats) if (seat.isBot) seats.add(seat.seat);
    for (const seat of entry?.surrendered ?? []) seats.add(seat);
    return [...seats].sort((a, b) => a - b);
  }

  type AutoPrompt = { kind: "result"; view: DuelEngineView } | { kind: "prompt"; seat: number; view: DuelEngineView };

  /** The first autopilot seat that has the open prompt, or the finished result, or null when a human must act. */
  async function findAutoPrompt(game: DuelGameWorker, seats: number[]): Promise<AutoPrompt | null> {
    for (const seat of seats) {
      const view = await game.view(seat);
      if (view.result) return { kind: "result", view };
      if (view.prompt && view.prompt.seat === seat) return { kind: "prompt", seat, view };
    }
    return null;
  }

  /** Rebuild the scripted bot rules of a preset table from its saved setup. */
  function policiesOf(setup: { presetId?: string; botPolicies?: Record<string, string> } | undefined): Map<number, Rule[]> {
    const policies = new Map<number, Rule[]>();
    const preset = setup?.presetId ? getPreset(setup.presetId) : undefined;
    if (!preset) return policies;
    for (const [seat, policy] of Object.entries(setup?.botPolicies ?? {})) {
      if (policy === SCRIPTED_POLICY) policies.set(Number(seat), preset.bots[Number(seat)] ?? []);
    }
    return policies;
  }

  async function chooseAutoAnswer(
    game: DuelGameWorker,
    entry: LiveGame | undefined,
    seat: number,
    prompt: DuelPrompt,
    view: DuelEngineView,
  ): Promise<{ answer: DuelAnswer; note?: string }> {
    const permittedCards = prompt.kind === "announce-card" ? await game.search("") : undefined;
    const trace: RuleTraceEntry[] = [];
    const record = (entry0: RuleTraceEntry) => {
      if (trace.length < TRACE_LIMIT) trace.push(entry0);
    };
    entry?.traces.set(seat, trace);
    if (entry?.surrendered.has(seat)) {
      const answer = chooseSurrenderedAnswer(prompt, { permittedCards, table: botTableOf(view) });
      record({ rule: SURRENDER_AUTOPILOT_NOTE, matched: true, answer });
      return { answer, note: SURRENDER_AUTOPILOT_NOTE };
    }
    const rules = entry?.policies.get(seat);
    if (rules) {
      try {
        const chosen = chooseScripted(rules, prompt, view, { seat, permittedCards, table: botTableOf(view), trace: record });
        return { answer: chosen.answer, note: chosen.note };
      } catch (error) {
        if (error instanceof ScriptedBotError) throw new PracticeBotError(error.message);
        throw error;
      }
    }
    const answer = choosePracticeBotAnswer(prompt, { permittedCards, table: botTableOf(view) });
    record({ rule: "practice bot", matched: true, answer });
    return { answer };
  }

  function stampRoomClock(room: DuelRoom, nowMs: number): DuelRoom {
    room.clock = withServerNow(persistedClockState(room.clock), nowMs);
    return room;
  }

  async function emitChange(slug: string, guildId: string): Promise<void> {
    try {
      const target = findDuelEventTarget(options.db, slug, guildId);
      if (!target) return;
      await options.onChange?.(target.slug, target.guildId);
    } catch (error) {
      report(error, { tags: { operation: "[duel] onChange failed" } });
    }
  }

  async function emitTournament(kind: TournamentNotice["kind"], slug: string): Promise<void> {
    try {
      await options.notifyTournament?.({ kind, slug });
    } catch (error) {
      report(error, { tags: { operation: "[duel] tournament notify failed" } });
    }
  }

  /** Every seat of the table is filled and ready: 2 at a 1v1 table, 3 or 4 at a free-for-all or Tag table. */
  function allSeatsReady(session: DuelSession): boolean {
    return session.seats.length === seatCountFor(session.format) && session.seats.every((entry) => entry.ready);
  }

  /** A between-games series is due when both players are ready or the side deck window has ended. */
  function isSeriesDue(info: DuelSeriesSummary, at: number): boolean {
    if (info.status !== "between_games") return false;
    // The loser of the last game may still be choosing first or second; the window end decides then.
    if (info.sideReady[0] && info.sideReady[1] && (info.firstChooser === null || info.firstChoice !== null)) return true;
    if (info.nextGameAt === null) return false;
    const deadline = Date.parse(info.nextGameAt);
    return Number.isFinite(deadline) && deadline <= at;
  }

  function clearAdvanceTimer(seriesId: number): void {
    const timer = advanceTimers.get(seriesId);
    if (timer === undefined) return;
    advanceTimers.delete(seriesId);
    clearTimeout(timer);
  }

  function scheduleAdvance(info: DuelSeriesSummary, guildId: string): void {
    clearAdvanceTimer(info.id);
    if (stopped || info.status !== "between_games" || info.nextGameAt === null) return;
    const deadline = Date.parse(info.nextGameAt);
    if (!Number.isFinite(deadline)) return;
    const timer = setTimeout(() => {
      advanceTimers.delete(info.id);
      // A timer can fire a little before the deadline by the host clock; the deadline itself is the due time.
      void advanceSeries(info.id, guildId, Math.max(now(), deadline)).catch((error) => {
        report(error, { tags: { operation: "[duel] series advance failed" } });
      });
    }, isSeriesDue(info, now()) ? 0 : Math.min(MAX_TIMER_MS, Math.max(0, deadline - now())));
    timer.unref();
    advanceTimers.set(info.id, timer);
  }

  function tournamentCompleted(tournamentId: number): boolean {
    const row = options.db
      .prepare<[number], { status: string }>("select status from tournaments where id = ?")
      .get(tournamentId);
    return row?.status === "completed";
  }

  /**
   * After a game ends (result or interrupt): time the next game of a between-games series, and tell the
   * ws server when the game moved a tournament bracket slot. Never throws; the game is already recorded.
   */
  async function afterGameEnded(slug: string, guildId: string): Promise<void> {
    try {
      const session = service.get(slug, guildId);
      if (isReplayFork(session) || !session.seriesId) return;
      const info = series.get(session.seriesId, guildId);
      if (info.currentDuelSlug !== slug) return;
      if (info.status === "between_games") scheduleAdvance(info, guildId);
      if (info.tournamentSlug && info.status !== "cancelled") {
        await emitTournament("match-updated", info.tournamentSlug);
        if (info.status === "completed" && info.tournamentId !== null && tournamentCompleted(info.tournamentId)) {
          await emitTournament("completed", info.tournamentSlug);
        }
      }
    } catch (error) {
      report(error, { tags: { operation: "[duel] series follow-up failed" } });
    }
  }

  async function safeClose(game: DuelGameWorker): Promise<void> {
    try {
      await game.close();
    } catch {
      // Worker may already have exited.
    }
  }

  async function disposeGame(slug: string): Promise<void> {
    releaseFinishedPlayers();
    const entry = games.get(slug);
    games.delete(slug);
    lastViews.delete(slug);
    reportCaptures.delete(slug);
    cancelBotLoop(slug);
    if (entry) await safeClose(entry.game);
  }

  /** A loop is a core invariant failure; recovering the same journal would just repeat it. */
  async function interruptEngineLoop(slug: string, guildId: string, error: unknown): Promise<boolean> {
    if (!(error instanceof EngineLoopError)) return false;
    service.interrupt(slug, guildId, ENGINE_LOOP_REASON);
    await disposeGame(slug);
    await emitChange(slug, guildId);
    await afterGameEnded(slug, guildId);
    return true;
  }

  function cancelBotLoop(slug: string): void {
    const loop = botLoops.get(slug);
    if (!loop) return;
    botLoops.delete(slug);
    loop.cancelled = true;
    loop.wake?.();
  }

  async function captureSnapshots(
    game: DuelGameWorker,
    format: DuelFormat,
    winnerSeat: number | null,
    reason: string,
  ): Promise<DuelFinalSnapshots> {
    // Replay verification compares board state, not log history. Final snapshots keep the normal 400-entry tail.
    const publicView = await game.view(null);
    const result: NonNullable<DuelEngineView["result"]> = { winnerSeat, reason,
      ...(publicView.result?.victory === "exodia" ? { victory: "exodia" as const } : {}) };
    // Tag: a team wins. `winnerSeat` is the lowest seat of the team; `winnerTeam` names it.
    if (format === "tag") result.winnerTeam = winnerSeat === null ? null : teamOfSeat(format, winnerSeat);
    const seats: DuelEngineView[] = [];
    for (let seat = 0; seat < seatCountFor(format); seat += 1) {
      seats.push(freezeView(await game.view(seat), result));
    }
    return {
      public: freezeView(publicView, result),
      seat0: seats[0],
      seat1: seats[1],
      seats,
    };
  }

  async function persistComplete(
    slug: string,
    guildId: string,
    game: DuelGameWorker,
    winnerSeat: number | null,
    reason: string,
  ): Promise<void> {
    if (reason === "Surrendered") reason = "Surrender";
    let snapshots: DuelFinalSnapshots;
    try {
      snapshots = await captureSnapshots(game, service.get(slug, guildId).format, winnerSeat, reason);
    } catch (error) {
      await disposeGame(slug);
      throw error;
    }
    service.complete(slug, guildId, winnerSeat, reason, snapshots);
    await disposeGame(slug);
    await emitChange(slug, guildId);
    await afterGameEnded(slug, guildId);
  }

  /** Who holds the open prompt, read from every seat's view. `stopped` seats (surrendered, eliminated, loss pending) do not get a running clock. */
  async function readClockView(
    game: DuelGameWorker,
    seatCount: number,
    surrendered?: Iterable<number>,
  ): Promise<DecisionClockView> {
    const stopped = new Set<number>(surrendered ?? []);
    let firstTurn = 0;
    // The first snapshot of a new game gets the opening grace (clock.ts DUEL_OPENING_GRACE_MS).
    let opening = false;
    const finish = (turn: number, promptSeat: number | null): DecisionClockView => {
      const clockView: DecisionClockView = { turn, promptSeat };
      if (promptSeat !== null && opening) clockView.opening = true;
      if (stopped.size > 0) clockView.stoppedSeats = [...stopped].sort((a, b) => a - b);
      return clockView;
    };
    for (let seat = 0; seat < seatCount; seat += 1) {
      const view = await game.view(seat);
      if (seat === 0) {
        firstTurn = view.turn;
        opening = view.revision === 0 && view.turn <= 1;
      }
      if (view.result) return finish(firstTurn, null);
      // A seat whose loss is only flagged (the core lands it at the next Adjust) has left already: its clock must not run.
      for (const entry of view.seats ?? []) if (entry.eliminated || entry.pendingElimination) stopped.add(entry.seat);
      if (view.prompt && isSeatIndex(view.prompt.seat)) return finish(view.turn, view.prompt.seat);
    }
    return finish(firstTurn, null);
  }

  /** Persist only confirmed losses; LP zero and pending surrender can still leave a response window open. */
  function persistEliminatedSeats(slug: string, guildId: string, state: DuelPrivateState, view: DuelEngineView): void {
    if (state.session.format === "1v1" || isReplayFork(state.session)) return;
    const eliminated = new Set(state.setup?.eliminatedSeats ?? []);
    const previousCount = eliminated.size;
    for (const seat of view.seats) if (seat.eliminated) eliminated.add(seat.seat);
    if (eliminated.size !== previousCount) {
      service.setSetup(slug, guildId, { ...state.setup, eliminatedSeats: [...eliminated].sort((a, b) => a - b) });
    }
  }

  async function persistAcceptedCommand(
    slug: string,
    guildId: string,
    seat: number,
    command: DuelCommand,
    game: DuelGameWorker,
    decidedAt: number,
    afterEventId: number,
    note?: string,
    touchActivity = true,
  ): Promise<void> {
    const state = service.privateState(slug, guildId);
    if (isReplayFork(state.session)) {
      service.recordCommand(slug, guildId, seat, note ? ({ ...command, note } as DuelCommand) : command, null);
      return;
    }
    const view = await readClockView(game, seatCountFor(state.session.format), games.get(slug)?.surrendered);
    const after = await game.view(null, { fullLog: true });
    const grace = freshCoinTossGraceMs(after, afterEventId);
    const finishedAt = now();
    const entry = games.get(slug);
    // A fast answer or a bot can queue another toss before the previous presentation ends.
    const graceEndsAt = grace === 0 ? null : Math.min(finishedAt + MAX_COIN_TOSS_GRACE_MS,
      Math.max(finishedAt, entry?.fxReadyAt ?? finishedAt, state.clock?.startedAt ?? finishedAt) + grace);
    const clock = syncDecisionClock(
      state.clock,
      view,
      state.session.settings.turnSeconds,
      decidedAt,
      finishedAt,
      state.session.settings.timeout,
      isSeatIndex(seat) ? seat : undefined,
      graceEndsAt,
    );
    // The journal keeps the reason of a scripted bot in `note`. Replay reads only promptId, revision and answer.
    options.db.transaction(() => {
      service.recordCommand(slug, guildId, seat, note ? ({ ...command, note } as DuelCommand) : command, clock, {
        touchActivity: touchActivity && !state.session.seats.some(s => s.seat === seat && s.isBot)
          && !(state.setup?.surrenderedSeats ?? []).includes(seat),
      });
      persistEliminatedSeats(slug, guildId, state, after);
    })();
    rememberReportCapture(slug, guildId, after);
    if (entry) {
      // An engine chain-end can precede its visible end. Track that backlog even
      // for commands with no coin; it delays the next coin, without pausing their clock.
      const lastCoinId = after.events.reduce((id, event) => event.id > afterEventId && event.kind === "toss"
        && event.toss?.type === "coin" && event.toss.results.length > 0 ? Math.max(id, event.id) : id, afterEventId);
      entry.fxReadyAt = Math.min(finishedAt + MAX_COIN_TOSS_GRACE_MS,
        (graceEndsAt ?? Math.max(finishedAt, entry.fxReadyAt ?? finishedAt)) + chainBeatDurationMs(after, lastCoinId));
    }
  }

  /** Stop a long duel once no human can play. This is an interruption, not a game draw. */
  async function stopLongBotDuel(slug: string, guildId: string, session: DuelSession, entry: LiveGame | undefined, view: DuelEngineView): Promise<boolean> {
    if (isReplayFork(session) || view.turn < BOT_ONLY_TURN_LIMIT) return false;
    const humanLiving = session.seats.some((seat) => {
      if (seat.isBot || entry?.surrendered.has(seat.seat)) return false;
      const state = view.seats.find((state) => state.seat === seat.seat);
      return !state?.eliminated && !state?.pendingElimination;
    });
    if (humanLiving) return false;
    await interruptBrokenBot(slug, guildId, `No human seat is living. The duel reached the limit of ${BOT_ONLY_TURN_LIMIT} turns.`);
    return true;
  }

  async function advancePracticeBot(slug: string, guildId: string, game: DuelGameWorker): Promise<void> {
    let stepsInTurn = 0;
    let lastTurn: number | null = null;
    while (stepsInTurn < BOT_ADVANCE_LIMIT) {
      stepsInTurn += 1;
      const session = service.get(slug, guildId);
      if (session.status !== "active") return;
      const entry = games.get(slug);
      const autoSeats = autoSeatsOf(session, entry);
      if (autoSeats.length === 0) return;
      const found = await findAutoPrompt(game, autoSeats);
      if (!found || found.kind === "result") return;
      const { seat, view } = found;
      if (await stopLongBotDuel(slug, guildId, session, entry, view)) return;
      const prompt = view.prompt!;
      if (view.turn !== lastTurn) {
        lastTurn = view.turn;
        stepsInTurn = 1;
      }

      const { answer, note } = await chooseAutoAnswer(game, entry, seat, prompt, view);
      if ((answer as { surrender?: boolean }).surrender) {
        await forfeitSeat(slug, guildId, game, seat, "Surrender", false);
        continue;
      }
      const command: DuelCommand = { promptId: prompt.id, revision: view.revision, answer };
      const decidedAt = now();
      try {
        await game.answer(seat, prompt.id, answer);
      } catch (error) {
        if (await interruptEngineLoop(slug, guildId, error)) return;
        throw error;
      }
      try {
        await persistAcceptedCommand(slug, guildId, seat, command, game, decidedAt, newestEventId(view), note);
      } catch (error) {
        await disposeGame(slug);
        throw error;
      }
    }
    throw new RequestError("Practice bot failed to make progress", 500);
  }

  /** Answer bot prompts now (unpaced) or hand them to the background loop (paced). */
  async function driveBot(slug: string, guildId: string, game: DuelGameWorker): Promise<void> {
    if (isReplayFork(service.get(slug, guildId))) {
      cancelBotLoop(slug);
      return;
    }
    if (!pacedBot) {
      await advancePracticeBot(slug, guildId, game);
      return;
    }
    startBotLoop(slug, guildId);
  }

  function botPause(loop: BotLoop, ms: number): Promise<void> {
    if (ms <= 0 || loop.cancelled || stopped) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        loop.wake = null;
        resolve();
      }, ms);
      loop.wake = () => {
        clearTimeout(timer);
        loop.wake = null;
        resolve();
      };
    });
  }

  function botDelayFor(prompt: DuelPrompt, cost: number, settle: number): number {
    const configured = options.botStepDelayMs;
    if (typeof configured === "function") return Math.max(0, Math.round(configured(prompt)));
    return practiceBotDelay(configured ?? 0, Math.max(cost, settle));
  }

  /** Give up on a bot that cannot choose a legal answer: end the table instead of leaving it stuck. */
  async function interruptBrokenBot(slug: string, guildId: string, reason: string): Promise<void> {
    try {
      const session = service.get(slug, guildId);
      if (session.status === "active") service.interrupt(slug, guildId, reason);
    } catch (error) {
      report(error, { tags: { operation: "[duel] could not interrupt a stuck practice bot table" } });
    }
    await disposeGame(slug);
    await emitChange(slug, guildId);
    await afterGameEnded(slug, guildId);
  }

  function startBotLoop(slug: string, guildId: string): void {
    if (stopped || botLoops.has(slug)) return;
    const loop: BotLoop = { cancelled: false, wake: null, done: Promise.resolve(), timer: null };
    botLoops.set(slug, loop);
    const finish = () => {
      if (botLoops.get(slug) === loop) botLoops.delete(slug);
    };
    // The loop only ever touches the duel from inside the per-duel queue, so human commands and the
    // clock sweep interleave with bot steps but never overlap them. Every stop decision is taken inside
    // the queue and unregisters the loop right there, so a human command queued next always sees the
    // registry as it truly is and can start a fresh loop.
    loop.done = (async () => {
      let steps = 0;
      let replans = 0;
      let lastTurn: number | null = null;
      let settle = 0;
      for (;;) {
        if (loop.cancelled || stopped) return finish();
        let plan: BotPlan | null;
        try {
          plan = await enqueue(slug, () => planBotStep(slug, guildId, loop, finish, settle));
        } catch (error) {
          report(error, { tags: { operation: "[duel] practice bot planning failed" } });
          return finish();
        }
        if (!plan) return;
        if (plan.turn !== lastTurn) {
          lastTurn = plan.turn;
          steps = 0;
        }
        const startedAt = now();
        loop.timer = { seat: plan.seat, delayMs: plan.delayMs, startedAt, dueAt: startedAt + plan.delayMs };
        await botPause(loop, plan.delayMs);
        loop.timer = null;
        if (loop.cancelled || stopped) return finish();
        let outcome: BotOutcome;
        try {
          outcome = await enqueue(slug, () => actBotStep(slug, guildId, loop, finish, plan));
        } catch (error) {
          report(error, { tags: { operation: "[duel] practice bot step failed" } });
          return finish();
        }
        if (outcome.kind === "stop") return;
        if (outcome.kind === "replan") {
          replans += 1;
          if (replans < BOT_REPLAN_LIMIT) continue;
        } else {
          replans = 0;
          steps += 1;
          settle = outcome.visible ? plan.cost : 0;
        }
        if (steps >= BOT_ADVANCE_LIMIT || replans >= BOT_REPLAN_LIMIT) {
          await enqueue(slug, async () => {
            if (loop.cancelled || stopped) return;
            finish();
            await interruptBrokenBot(slug, guildId, replans >= BOT_REPLAN_LIMIT
              ? "The practice bot could not keep a valid plan."
              : "The practice bot failed to make progress.");
          }).catch((error) => report(error, { tags: { operation: "[duel] practice bot interrupt failed" } }));
          return;
        }
      }
    })().catch((error) => {
      report(error, { tags: { operation: "[duel] practice bot loop crashed" } });
      finish();
    });
  }

  /** Runs inside the duel queue. Returns the next bot step, or null after ending the loop. */
  async function planBotStep(
    slug: string,
    guildId: string,
    loop: BotLoop,
    finish: () => void,
    settle: number,
  ): Promise<BotPlan | null> {
    if (loop.cancelled || stopped) {
      finish();
      return null;
    }
    const session = service.get(slug, guildId);
    const entry = games.get(slug);
    const autoSeats = autoSeatsOf(session, entry);
    if (session.status !== "active" || autoSeats.length === 0 || !entry?.game.running) {
      finish();
      return null;
    }
    const game = entry.game;
    let found: AutoPrompt | null;
    try {
      found = await findAutoPrompt(game, autoSeats);
    } catch (error) {
      report(error, { tags: { operation: "[duel] practice bot could not read the duel" } });
      finish();
      await disposeGame(slug);
      return null;
    }
    if (found?.kind === "result") {
      finish();
      const result = found.view.result!;
      try {
        await persistComplete(slug, guildId, game, result.winnerSeat, result.reason);
      } catch (error) {
        report(error, { tags: { operation: "[duel] could not record the finished duel" } });
      }
      return null;
    }
    if (!found) {
      finish();
      return null;
    }
    const { view, seat } = found;
    if (await stopLongBotDuel(slug, guildId, session, entry, view)) {
      finish();
      return null;
    }
    const prompt = view.prompt!;
    let answer: DuelAnswer;
    let note: string | undefined;
    try {
      ({ answer, note } = await chooseAutoAnswer(game, entry, seat, prompt, view));
    } catch (error) {
      finish();
      if (!game.running) {
        await disposeGame(slug);
        return null;
      }
      const message = error instanceof PracticeBotError ? error.message : "Practice bot failed to choose";
      log("warn", "[duel] Practice bot could not choose an answer");
      await interruptBrokenBot(slug, guildId, "The practice bot could not continue.");
      return null;
    }
    const cost = botAnswerCost(prompt, answer);
    return {
      seat,
      promptId: prompt.id,
      revision: view.revision,
      answer,
      note,
      cost,
      delayMs: botDelayFor(prompt, cost, settle),
      turn: view.turn,
    };
  }

  /** Runs inside the duel queue. Applies a planned step if the duel is still exactly where the plan left it. */
  async function actBotStep(
    slug: string,
    guildId: string,
    loop: BotLoop,
    finish: () => void,
    plan: BotPlan,
  ): Promise<BotOutcome> {
    if (loop.cancelled || stopped) {
      finish();
      return { kind: "stop" };
    }
    const session = service.get(slug, guildId);
    const entry = games.get(slug);
    if (session.status !== "active" || !autoSeatsOf(session, entry).includes(plan.seat) || !entry?.game.running) {
      finish();
      return { kind: "stop" };
    }
    const game = entry.game;
    let before: DuelEngineView;
    try {
      before = await game.view(plan.seat);
    } catch (error) {
      report(error, { tags: { operation: "[duel] practice bot could not read the duel" } });
      finish();
      await disposeGame(slug);
      return { kind: "stop" };
    }
    if (before.result || before.prompt?.seat !== plan.seat) return { kind: "replan" };
    if (before.prompt.id !== plan.promptId || before.revision !== plan.revision) return { kind: "replan" };

    if ((plan.answer as { surrender?: boolean }).surrender) {
      try {
        await forfeitSeat(slug, guildId, game, plan.seat, "Surrender", false);
      } catch (error) {
        finish();
        report(error, { tags: { operation: "[duel] scripted bot could not surrender" } });
        await interruptBrokenBot(slug, guildId, "The practice bot could not continue.");
        return { kind: "stop" };
      }
      return { kind: "acted", visible: true };
    }
    const command: DuelCommand = { promptId: plan.promptId, revision: plan.revision, answer: plan.answer };
    const decidedAt = now();
    try {
      await game.answer(plan.seat, plan.promptId, plan.answer);
    } catch (error) {
      finish();
      if (await interruptEngineLoop(slug, guildId, error)) return { kind: "stop" };
      const reason = error instanceof EngineAnswerError ? error.message
        : errorResponseBody(error, { tags: { operation: "[duel] practice bot answer was rejected" } }).body.error;
      const rejectedTrace = entry.traces.get(plan.seat) ?? [];
      rejectedTrace.push({ rule: plan.note ?? "practice bot", matched: true, answer: plan.answer, rejected: true, reason });
      entry.traces.set(plan.seat, rejectedTrace);
      if (!game.running) await disposeGame(slug);
      else await interruptBrokenBot(slug, guildId, "The practice bot could not continue.");
      return { kind: "stop" };
    }
    try {
      await persistAcceptedCommand(slug, guildId, plan.seat, command, game, decidedAt, newestEventId(before), plan.note);
    } catch (error) {
      // The answer was applied but not journaled. Dropping the worker makes the next request rebuild the
      // duel from the journal, which never contains an unrecorded command.
      finish();
      report(error, { tags: { operation: "[duel] could not record the practice bot's move" } });
      await disposeGame(slug);
      return { kind: "stop" };
    }
    let visible = false;
    try {
      visible = newestEventId(await game.view(plan.seat)) > newestEventId(before);
    } catch {
      // Pacing hint only.
    }
    await emitChange(slug, guildId);
    return { kind: "acted", visible };
  }

  async function recover(slug: string, guildId: string): Promise<DuelGameWorker> {
    const session = service.get(slug, guildId);
    if (competitive(session) && await settleRankedDeadline(slug, guildId)) {
      throw new RequestError("This duel has ended on time", 409);
    }
    const fork = isReplayFork(session);
    if (fork) assertDuelForkAccess(options.db, slug, { guildId, playerId: session.organizerPlayerId });
    const existing = games.get(slug);
    if (existing?.game.running) {
      existing.lastRequestAt = now();
      await driveBot(slug, guildId, existing.game);
      return existing.game;
    }
    games.delete(slug);
    const state = fork ? createReplayForkService(options.db).privateState(slug, { guildId, playerId: session.organizerPlayerId })
      : service.privateState(slug, guildId);
    if (state.session.status !== "active") throw new RequestError("This duel is not active", 409);
    const seed = state.seed;
    if (!seed || !state.bundleVersion) throw new RequestError("Duel has not started", 409);
    if (state.bundleVersion !== pinnedVersionFor(state.session.format)) {
      service.interrupt(slug, guildId, "The pinned engine resources changed; this duel cannot be recovered safely.");
      await emitChange(slug, guildId);
      await afterGameEnded(slug, guildId);
      throw new RequestError("Duel interrupted: engine resource version changed", 409, "ENGINE_UNAVAILABLE_FOR_SOURCE");
    }
    let resources: EngineResources | undefined;
    if (state.setup?.engineIdentity) {
      try {
        resources = await resourcesOfSource(state, fork ? "fork-recovery" : "live-recovery");
      } catch (error) {
        if (error instanceof RequestError && error.status === 503) throw error;
        service.interrupt(slug, guildId, "The recorded engine resources or runtime rules changed; this duel cannot be recovered safely.");
        await emitChange(slug, guildId);
        await afterGameEnded(slug, guildId);
        throw error;
      }
    }
    try {
      drawRuleOf(state);
    } catch (error) {
      service.interrupt(slug, guildId, error instanceof ExpectedError ? error.message : "Something went wrong");
      await emitChange(slug, guildId);
      throw error;
    }
    let game: DuelGameWorker | undefined;
    let recordRecoveryErrors = !fork;
    try {
      const recoverySource = journalSourceOf(state);
      // Pin today's worker rules for live play without rewriting the durable replay identity.
      if (!fork && recoverySource.engineIdentity && resources) {
        recoverySource.engineIdentity = { ...recoverySource.engineIdentity, hostRuleVersion: resources.identity.hostRuleVersion };
      }
      const replayRun = runJournalPrefix({
        ...(fork ? { manualLossAnswersAfter: state.setup!.replayFork!.origin.prefixCount } : {}),
        source: recoverySource,
        resources: journalResourcesOf(resources),
        prefixCount: state.commands.length,
        createWorker: async () => (game = await spawn(state.session, { recordErrors: () => recordRecoveryErrors })),
      });
      // Recover committed forks under their slug queue, like ordinary duels.
      // The worker bounds the full initialization separately from live operations.
      const result = await replayRun;
      game = result.worker;
    } catch (error) {
      if (fork && game) await safeClose(game);
      if (error instanceof RequestError) throw error;
      if (error instanceof JournalRunnerError && error.cause instanceof RequestError && error.cause.status === 429) throw error.cause;
      if (await interruptEngineLoop(slug, guildId, error) && game) return game;
      if (error instanceof JournalRunnerError && error.code !== "ENGINE_BUSY") {
        service.interrupt(slug, guildId, "The saved engine state could not be recovered.");
        await emitChange(slug, guildId);
        await afterGameEnded(slug, guildId);
        throw new RequestError(error.message, 409,
          error.code === "ENGINE_UNAVAILABLE_FOR_SOURCE" ? error.code : undefined);
      }
      if (error instanceof JournalRunnerError) {
        throw new RequestError(fork ? "Replay fork engine is temporarily unavailable" : "Duel engine is temporarily unavailable", 503,
          fork ? "ENGINE_BUSY" : undefined);
      }
      throw error;
    }
    games.set(slug, {
      game,
      lastRequestAt: now(),
      guildId,
      surrendered: new Set(fork ? [] : state.setup?.surrenderedSeats ?? []),
      policies: fork ? new Map() : policiesOf(state.setup),
      traces: new Map(),
      ...(state.setup?.presetId ? { presetId: state.setup.presetId } : {}),
    });
    recordRecoveryErrors = true;
    if (!fork) rememberReportCapture(slug, guildId, await game.view(null, { fullLog: true }));
    await driveBot(slug, guildId, game);
    return game;
  }

  const forkLauncher = createReplayForkLauncher({ db: options.db, codec: replayCursorCodec,
    sourceOf: journalSourceOf, resourcesOf: async (state, purpose) => {
      const resources = await resourcesOfSource(state, purpose === "restart" ? "fork-recovery" : "replay");
      return journalResourcesOf(resources);
    },
    authorizeSource: async (state, actor, unchecked, signal) => {
      const source = journalSourceOf(state), resources = await resourcesOfSource(state);
      const crossVersion = isCrossVersion(source, resources);
      const unknownChoice = isUnknownEngineChoice(source);
      const defaults = { ...journalResourcesOf(resources), ...(crossVersion ? { allowVersionMismatch: true } : {}) };
      if (!crossVersion || (unchecked && !unknownChoice)) return defaults;
      const owner = resolveOwnerPlayer(options.db, actor);
      if (!owner) throw new ReplayAccessError();
      const saved = savedReplayBoards(state.session.slug, actor.guildId);
      const selection = await replayVerificationSelection(state, source, resources!, saved);
      const previous = selection.previous;
      if (previous?.result === "verified") return { ...journalResourcesOf(selection.resources), allowVersionMismatch: true };
      if (unchecked) return { ...journalResourcesOf(selection.resources), allowVersionMismatch: true };
      if (previous?.result === "unverified") {
        throw new RequestError("Replay could not be verified against the saved final board.", 409, "REPLAY_UNVERIFIED",
          readStoredBoard(saved, null) ? "available" : "none", { canOpenUnchecked: previous.reason !== "command_mismatch", reason: previous.reason! });
      }
      await replay(state.session.slug, actor.guildId, { session: state.session, role: "spectator", mySeat: null,
        myDeck: null, engine: null, clock: null, metadataOnly: true },
      { version: 2, visibility: "public", dataSeat: null, ownerUserId: owner.userId, ownerPlayerId: owner.playerId }, signal, resources);
      // Keep the full verification and the prefix launch in separate bounded requests.
      throw new RequestError("Replay source is verified. Retry Jump in to start the fork.", 503, "REPLAY_VERIFIED_RETRY");
    },
    createWorker: (duelRef, actor, session, table, signal) => spawn(session, { duelRef, table, signal, players: [actor.playerId], wait: false }),
    timeoutMs: options.forkTimeoutMs, isStopped: () => stopped,
    remove: async (slug, game) => { if (games.get(slug)?.game === game) await disposeGame(slug); },
    register: (session, game, views) => {
      if (!game.running || stopped) throw new ReplayForkLaunchError("Fork worker cannot be registered.", "ENGINE_BUSY");
      const state = service.privateState(session.slug, session.guildId);
      const room = replayForkRoom(stampRoomClock(service.room(session.slug, session.guildId, session.organizerPlayerId), now()),
        state.setup!.replayFork!, views, initialForkSeat(views[0]!), true);
      assertReplayForkAccess(options.db, session.slug, { guildId: session.guildId, playerId: session.organizerPlayerId });
      const reservation = reservations.get(game);
      if (reservation) {
        reservation.session = session;
        reservation.release.setTableId(session.id);
      }
      const previous = games.get(session.slug);
      games.set(session.slug, { game, guildId: session.guildId, lastRequestAt: now(), surrendered: new Set(),
        policies: new Map(), traces: new Map() });
      lastViews.set(session.slug, new Map(views.map((view, seat) => [seat, view])));
      if (previous) void safeClose(previous.game);
      return room;
    },
    room: (slug, actor) => enqueue(slug, async () => {
      assertReplayForkAccess(options.db, slug, actor);
      const session = service.get(slug, actor.guildId);
      const game = session.status === "active" ? await recover(slug, actor.guildId) : undefined;
      const room = await project(slug, actor.guildId, actor.playerId, game);
      assertReplayForkAccess(options.db, slug, actor);
      return room;
    }),
  });

  /**
   * Remove a seat through Debug.SurrenderDuelist (surrender) or Debug.EliminateDuelist (time limit).
   * Returns false when the core cannot do it. Keep the old fallback for time losses;
   * refuse a new surrender when the core has no loss function.
   */
  async function eliminateInCore(slug: string, guildId: string, game: DuelGameWorker, seat: number, code: number): Promise<boolean> {
    if (typeof game.eliminate !== "function") return false;
    const before = await game.view(seat);
    try {
      await game.eliminate(seat, code);
    } catch (error) {
      if (await interruptEngineLoop(slug, guildId, error)) return true;
      const message = error instanceof Error ? error.message : "Engine rejected the elimination";
      if (/no Debug\.EliminateDuelist/.test(message)) return false;
      if (/already eliminated/.test(message)) return true;
      const stillRunning = game.running;
      if (!(error instanceof EngineAnswerError)) await disposeGame(slug);
      if (error instanceof EngineAnswerError) throw new RequestError(error.message, stillRunning ? 409 : 503, error.code);
      throw error;
    }
    const command: DuelCommand = { promptId: `${ELIMINATE_PROMPT_PREFIX}${code}`, revision: before.revision, answer: {} };
    try {
      await persistAcceptedCommand(slug, guildId, seat, command, game, now(), newestEventId(before), undefined, code === WIN_REASON_SURRENDER);
    } catch (error) {
      // Applied but not journaled: drop the worker so the next request rebuilds the duel from the journal.
      await disposeGame(slug);
      throw error;
    }
    return true;
  }

  /**
   * A seat gives up (surrender or time limit).
   * 1v1 surrender and Tag time losses end the duel at once. Multiplayer surrender flags a loss now
   * on any turn. In FFA, the current chain finishes before the loss lands. Tag surrender with an
   * open chain ends the duel at once.
   */
  async function forfeitSeat(
    slug: string,
    guildId: string,
    game: DuelGameWorker,
    seat: number | null,
    reason: string,
    drive = true,
  ): Promise<void> {
    const state = service.privateState(slug, guildId);
    const format = state.session.format;
    if (seat === null || seat >= seatCountFor(format)) {
      await persistComplete(slug, guildId, game, null, reason);
      return;
    }
    if (format === "1v1" || (format === "tag" && reason === TIME_LIMIT_REASON)) {
      const winner = opponentSeatsOf(format, seat)[0];
      if (winner === undefined) throw new RequestError("Opponent is missing", 409);
      await persistComplete(slug, guildId, game, winner, reason);
      return;
    }
    const entry = games.get(slug);
    if (!entry) throw new RequestError("Duel is not running", 409);
    if (entry.surrendered.has(seat)) return;
    const before = await game.view(seat);
    if (before.seats?.find((view) => view.seat === seat)?.eliminated) return;
    if (format === "tag" && (before.chain?.length ?? 0) > 0) {
      const winner = opponentSeatsOf(format, seat)[0];
      if (winner === undefined) throw new RequestError("Opponent is missing", 409);
      await persistComplete(slug, guildId, game, winner, reason);
      return;
    }
    if (!entry.surrendered.has(seat) && (await eliminateInCore(slug, guildId, game, seat, reason === TIME_LIMIT_REASON ? WIN_REASON_TIME_LIMIT : WIN_REASON_SURRENDER))) {
      if (service.get(slug, guildId).status !== "active") return;
      // The core removed the seat (journaled like an answer). The last duelist standing ends the duel.
      const after = await game.view(0);
      if (after.result) {
        await persistComplete(slug, guildId, game, after.result.winnerSeat, reason);
        return;
      }
      // Keep the current final-seat rule for time-limit losses. A surrender waits for the chain to end.
      const { living } = botTableOf(after);
      if (reason === TIME_LIMIT_REASON && format !== "tag" && living?.length === 1) {
        await persistComplete(slug, guildId, game, living[0] ?? null, reason);
        return;
      }
      await emitChange(slug, guildId);
      if (drive) await driveBot(slug, guildId, game);
      return;
    }
    if (reason !== TIME_LIMIT_REASON) throw new RequestError("This engine cannot eliminate a surrendering duelist", 409);
    if (!entry.surrendered.has(seat)) {
      entry.surrendered.add(seat);
      const { engineIdentity: _identity, ...setup } = state.setup ?? {};
      service.setSetup(slug, guildId, { ...setup, surrenderedSeats: [...entry.surrendered].sort((a, b) => a - b) });
    }
    if (state.clock) service.setClock(slug, guildId, stopSeatClock(state.clock, seat, now()));
    const view = await game.view(0);
    const living: number[] = [];
    for (let index = 0; index < seatCountFor(format); index += 1) {
      const eliminated = view.seats?.find((entryView) => entryView.seat === index)?.eliminated === true;
      if (!entry.surrendered.has(index) && !eliminated) living.push(index);
    }
    if (living.length <= 1) {
      await persistComplete(slug, guildId, game, living[0] ?? null, reason);
      return;
    }
    await emitChange(slug, guildId);
    if (drive) await driveBot(slug, guildId, game);
  }

  async function settleRankedDeadline(slug: string, guildId: string, game?: DuelGameWorker, at = now()): Promise<boolean> {
    const state = service.privateState(slug, guildId);
    const seat = state.clock?.activeSeat;
    if (!competitive(state.session) || state.session.format !== "1v1" || state.session.status !== "active"
      || !state.clock || seat == null || !isClockDue(state.clock, at)
      || state.session.seats.some(entry => entry.seat === seat && entry.isBot)) return false;
    const winner = opponentSeatsOf("1v1", seat)[0]!;
    const resident = game?.running ? game : games.get(slug)?.game;
    // The saved deadline proves the loss even when resources/journal recovery would fail after a restart.
    if (resident?.running) {
      await persistComplete(slug, guildId, resident, winner, TIME_LIMIT_REASON);
    } else {
      service.complete(slug, guildId, winner, TIME_LIMIT_REASON);
      await emitChange(slug, guildId);
      await afterGameEnded(slug, guildId);
    }
    return true;
  }

  async function settleClock(slug: string, guildId: string, game?: DuelGameWorker, at = now()): Promise<void> {
    const state = service.privateState(slug, guildId);
    if (isReplayFork(state.session) || state.session.status !== "active") return;
    if (!state.clock) {
      // Legacy competitive timed games acquire their bank once. Unlimited tournaments keep no clock.
      if (competitive(state.session) && state.session.settings.turnSeconds > 0) {
        const live = game?.running ? game : await recover(slug, guildId);
        const seatCount = seatCountFor(state.session.format);
        service.setClock(slug, guildId, startDecisionClock(await readClockView(live, seatCount), state.session.settings.turnSeconds, at, seatCount));
        await emitChange(slug, guildId);
      }
      return;
    }
    const clock = state.clock;
    if (!isClockDue(clock, at)) return;

    const expired = clock.activeSeat;
    const surrenderedSeat = expired !== null && (state.setup?.surrenderedSeats ?? []).includes(expired);
    if (expired !== null && (surrenderedSeat || state.session.seats.some((seat) => seat.seat === expired && seat.isBot))) {
      const live = game?.running ? game : await recover(slug, guildId);
      if (game?.running) await driveBot(slug, guildId, live);
      return;
    }

    const settings = state.session.settings;
    if (settings.timeout === "continue") {
      service.setClock(slug, guildId, freezeContinueClock(clock, at));
      await emitChange(slug, guildId);
      return;
    }

    if (competitive(state.session) && await settleRankedDeadline(slug, guildId, game, at)) return;
    const live = game?.running ? game : await recover(slug, guildId);
    await forfeitSeat(slug, guildId, live, expired, TIME_LIMIT_REASON);
  }

  async function project(slug: string, guildId: string, playerId: number, game?: DuelGameWorker, spectate = false, control: { as?: unknown; reveal?: boolean } = {}): Promise<DuelRoom> {
    const room = stampRoomClock(service.room(slug, guildId, playerId, { includeStoredBoard: false }), now());
    warmLobbyResources(room.session);
    if (isReplayFork(room.session)) {
      const state = service.privateState(slug, guildId);
      const saved = game?.running && room.session.status === "active" ? undefined : savedReplayBoards(slug, guildId);
      const readSaved = createStoredBoardReader(saved);
      const ownViews: Array<DuelEngineView | null> = [];
      for (let seat = 0; seat < seatCountFor(room.session.format); seat++) {
        ownViews.push(game?.running && room.session.status === "active" ? await game.view(seat) : readSaved(seat));
      }
      const first = ownViews.find(view => view !== null);
      if (first?.result && game?.running && room.session.status === "active") {
        await persistComplete(slug, guildId, game, first.result.winnerSeat, first.result.reason);
        return project(slug, guildId, playerId, undefined, false, control);
      }
      let seat: number;
      try { seat = resolveReplayForkSeat(room.session, control.as, first ? initialForkSeat(first) : 0); }
      catch { throw new RequestError("Invalid replay fork acting seat", 400); }
      const projected = replayForkRoom(room, state.setup!.replayFork!, ownViews, seat, control.reveal ?? true);
      assertReplayForkAccess(options.db, slug, { guildId, playerId });
      for (let index = 0; index < ownViews.length; index++) rememberView(slug, index, ownViews[index] ?? null, game);
      return projected;
    }
    if (["completed", "interrupted", "cancelled"].includes(room.session.status)) {
      room.engine = readStoredBoard(savedReplayBoards(slug, guildId), room.mySeat);
      room.metadataOnly = room.engine === null;
    }
    const setup = room.session.format === "1v1" ? null : service.privateState(slug, guildId);
    // Retired commands identify old setup flags; they are not accepted for new surrender.
    const retiredTurnEndSeats = new Set((setup?.commands ?? []).filter((input) => eliminationAtTurnEnd(input.command.promptId)).map((input) => input.seat));
    const legacyLossSeats = new Set((isReplayFork(room.session) ? [] : setup?.setup?.surrenderedSeats ?? []).filter((seat) => !retiredTurnEndSeats.has(seat)));
    const markLegacyLosses = (views: Iterable<DuelEngineView | null>) => {
      for (const view of views) for (const gone of legacyLossSeats) {
        const seat = view?.seats.find((seat) => seat.seat === gone);
        if (seat) seat.eliminated = true;
      }
    };
    if (game && game.running && room.session.status === "active") {
      room.engine = await game.view(room.mySeat);
      // This also backfills older journals when recovery confirms an engine loss.
      if (setup) persistEliminatedSeats(slug, guildId, setup, room.engine);
      // A scenario table has no response switch: its seats keep the duel setting.
      if (games.get(slug)?.presetId) delete room.engine.chainMode;
      if (room.engine.result) {
        await persistComplete(slug, guildId, game, room.engine.result.winnerSeat, room.engine.result.reason);
        return project(slug, guildId, playerId, undefined, spectate);
      }
    }
    const playerView = room.engine;
    let replayedView: DuelEngineView | null = null;
    // With no final board, replay the journal to check that the loss did land.
    let noBoardLoss = false;
    const lossForViewer = room.mySeat !== null && [
      ...(setup?.setup?.surrenderedSeats ?? []),
      ...(setup?.commands ?? []).filter((input) => eliminationReasonOf(input.command) !== null).map((input) => input.seat),
    ].some((seat) => seat === room.mySeat || (room.session.format === "tag"
      && teamOfSeat("tag", seat) === teamOfSeat("tag", room.mySeat!)));
    // A saved core loop must not restart automatically when an eliminated player polls the room.
    if (lossForViewer && room.engine === null && room.session.status === "interrupted" && room.session.resultReason !== ENGINE_LOOP_REASON && room.session.format !== "1v1") {
      try {
        const publicReplay = await replay(slug, guildId, { ...room, role: "spectator", mySeat: null, myDeck: null });
        const last = publicReplay.replay.frames.at(-1)?.view ?? null;
        replayedView = last;
        noBoardLoss = last?.seats.some((seat) => seat.seat === room.mySeat && (seat.eliminated || legacyLossSeats.has(seat.seat))) === true;
      } catch (error) {
        // A missing replay must not prevent a room read. No board is exposed in this case.
        if (!(error instanceof RequestError) || (error.status !== 409 && error.status !== 413 && error.status !== 503)) throw error;
      }
    }
    // Per-seat snapshots of a finished duel still hold that seat's final hand. Returning the room is safe only because
    // service.room picks the actor's OWN snapshot, so a loser who spectated during the duel still sees "lose" and their
    // own row. Never return another seat's or a stored snapshot from this branch.
    const ownResult = room.mySeat !== null && (room.session.status === "completed" || room.session.status === "interrupted" || room.session.status === "cancelled");
    const playerSeat = room.mySeat;
    if (spectate && !ownResult) {
      if ((room.session.format !== "ffa3" && room.session.format !== "ffa4") ||
          (room.mySeat !== null && !(noBoardLoss || legacyLossSeats.has(room.mySeat) || room.engine?.seats.some((seat) => seat.seat === room.mySeat && seat.eliminated)))) {
        throw new RequestError("You can watch after your seat is eliminated", 409);
      }
      if (game?.running && room.session.status === "active") {
        room.engine = await game.view(null);
      } else {
        // Keep the seat record for standings; the saved public view has spectator privacy.
        const saved = options.db.prepare<[string, string], StoredDuelBoards>(
          "select snapshot_public_json from duels where web_slug = ? and guild_id = ?",
        ).get(slug, guildId);
        room.engine = readStoredBoard(saved, null);
      }
      room.role = "spectator";
      room.mySeat = null;
      room.myDeck = null;
      room.mySide = null;
      if (room.engine) room.engine.prompt = null;
    }
    // Keep the player, replay and spectator views consistent. A Set avoids marking the same view twice.
    markLegacyLosses(new Set([playerView, replayedView, room.engine]));
    rememberView(slug, playerSeat, playerView, game);
    if (spectate && !ownResult) rememberView(slug, room.mySeat, room.engine, game);
    // Check only the viewer's own future deck, independent of who last attempted to start.
    const pendingDeck = room.role === "player"
      ? room.series?.status === "between_games" ? room.mySide?.currentDeck
        : room.session.status === "lobby" ? room.myDeck : null
      : null;
    if (pendingDeck) {
      try {
        try {
          await validateSessionDeck(room.session.mode, pendingDeck, room.session.settings, room.session.format,
            { session: room.session, playerId });
        } catch (error) {
          if (!(error instanceof DeckLegalityError)) throw error;
          const checks = await sessionDeckOptions(room.session, playerId, pendingDeck);
          const report = inspectDeck(room.session.mode, pendingDeck, options.dataDirectory, room.session.settings, checks);
          room.startBlocked = { reason: error.message,
            cardNames: [...new Set(report.issues.flatMap(issue => issue.cards.map(card => card.name ?? `card ${card.code}`)))] };
        }
      } catch (error) {
        report(error, { tags: { operation: "[duel] viewer start blocker", table: slug } });
      }
    }
    const deckBlock = deckStartBlocks.get(slug);
    if (deckBlock) {
      if (room.session.status !== "lobby" || deckBlock.stateHash !== startDeckStateHash(service.privateState(slug, guildId))) {
        deckStartBlocks.delete(slug);
        startBackoff.delete(slug);
      } else if (room.role === "player" && room.mySeat !== null && playerId !== deckBlock.playerId && !room.startBlocked) {
        room.startBlockedByOther = true;
      }
    }
    return room;
  }

  /** Stored projections are read only after source access succeeds. */
  function savedReplayBoards(slug: string, guildId: string): StoredDuelBoards | undefined {
    return options.db.prepare<[string, string], StoredDuelBoards>(
      `select ${STORED_BOARD_COLUMNS} from duels where web_slug = ? and guild_id = ?`).get(slug, guildId);
  }

  interface ReplayProjection {
    version: 1 | 2;
    visibility: ReplayVisibility;
    dataSeat: number | null;
    reveal?: boolean;
    ownerUserId?: number;
    ownerPlayerId?: number;
    unchecked?: boolean;
  }

  function isCrossVersion(source: ReplaySource, resources?: EngineResources): boolean {
    return source.engineIdentity === null || source.bundleVersion !== (resources?.bundleVersion ?? pinnedVersionFor(source.session.format))
      || (source.engineIdentity !== null && (!isEngineIdentity(source.engineIdentity) || !resources
        || !sameEngineIdentity(source.engineIdentity, resources.identity)));
  }

  function verificationKeyOf(source: ReplaySource, resources: EngineResources, saved: StoredDuelBoards | undefined, readSaved = createStoredBoardReader(saved)): ReplayVerificationKey {
    return { duelId: source.session.id, bundleVersion: resources.bundleVersion, sourceVersion: replaySourceVersion(source),
      resourceStamp: createHash("sha256").update(JSON.stringify(resources.identity)).digest("hex"),
      boardStamp: storedBoardStamp(saved, null, true, readSaved, source.session.seats.length) };
  }

  async function replayVerificationSelection(state: DuelPrivateState, source: ReplaySource, resources: EngineResources,
    saved: StoredDuelBoards | undefined, readSaved = createStoredBoardReader(saved)) {
    const key = verificationKeyOf(source, resources, saved, readSaved);
    let alternate: EngineResources | undefined;
    if (isUnknownEngineChoice(source)
      && readSaved(null) && source.session.seats.every(seat => readSaved(seat.seat))) {
      try {
        alternate = await resourcesOfSource(state, "replay", sourceEngineChoice(source) === "legacy" ? "pinned" : "legacy");
      } catch (error) {
        if (!(error instanceof RequestError) || error.code !== "ENGINE_UNAVAILABLE_FOR_SOURCE") throw error;
      }
      // Both installed candidates affect an unknown-source verdict. Installing or changing either
      // family invalidates a stored failure as well as a pass, even under an unchanged bundle label.
      key.resourceStamp = createHash("sha256").update(JSON.stringify([resources.identity, alternate?.identity ?? null])).digest("hex");
    }
    const previous = replayVerifications.get(key);
    if (previous?.coreFamily && previous.coreFamily === alternate?.identity.coreFamily) {
      return { key, resources: alternate!, previous, alternate: undefined };
    }
    return { key, resources, previous, alternate: previous ? undefined : alternate };
  }

  async function replay(slug: string, guildId: string, room: DuelRoom,
    projection: ReplayProjection = { version: 1, visibility: "mine", dataSeat: room.mySeat }, signal?: AbortSignal,
    selectedResources?: EngineResources): Promise<ReplayHttpResult> {
    const buildDeadline = Date.now() + REPLAY_BUILD_TIMEOUT_MS;
    const saved = savedReplayBoards(slug, guildId);
    const readSaved = createStoredBoardReader(saved);
    let finalView = readSaved(projection.dataSeat);
    const finalBoard = finalView ? "available" : "none";
    if (room.session.status !== "completed" && room.session.status !== "interrupted") {
      throw new RequestError("Replays are available after the duel ends", 409, "NOT_PLAYABLE", finalBoard);
    }
    let verificationKey: ReplayVerificationKey | undefined;
    const refuseUnverified = (reason: ReplayUnverifiedReason): never => {
      // Recheck the current owner mapping even on a cached failure or a late command failure.
      const canOpenUnchecked = reason !== "command_mismatch" && projection.ownerUserId !== undefined && projection.ownerPlayerId !== undefined
        && !!resolveOwnerPlayer(options.db, { guildId, playerId: projection.ownerPlayerId, userId: projection.ownerUserId });
      throw new RequestError("Replay could not be verified against the saved final board.", 409, "REPLAY_UNVERIFIED", finalBoard,
        { canOpenUnchecked, reason });
    };
    try {
      const state = service.privateState(slug, guildId);
      const source = journalSourceOf(state);
      const sourceVersion = replaySourceVersion(source);
      let resources = selectedResources ?? await resourcesOfSource(state);
      const crossVersion = isCrossVersion(source, resources);
      const unchecked = crossVersion && projection.unchecked === true;
      const verification: ReplayVerification = unchecked ? "unverified" : crossVersion ? "verified" : "exact";
      const unknownChoice = isUnknownEngineChoice(source);
      let alternate: EngineResources | undefined;
      if (crossVersion) {
        verificationKey = verificationKeyOf(source, resources!, saved, readSaved);
        if (!unchecked || unknownChoice) {
          const selection = await replayVerificationSelection(state, source, resources!, saved, readSaved);
          verificationKey = selection.key;
          const previous = selection.previous;
          if (unchecked) {
            if (previous?.result === "unverified") resources = selection.resources;
          } else {
            resources = selection.resources; alternate = selection.alternate;
            if (previous?.result === "unverified") refuseUnverified(previous.reason!);
            if (!previous && (!readSaved(null) || source.session.seats.some(seat => !readSaved(seat.seat)))) {
              replayVerifications.set(verificationKey, "no_saved_board");
              refuseUnverified("no_saved_board");
            }
          }
        }
      }
      if (projection.reveal && finalView) {
        const ownViews = source.session.seats.map(seat => readSaved(seat.seat));
        if (ownViews.every((view): view is DuelEngineView => view !== null)) finalView = revealReplayHands(finalView, ownViews);
      }
      const cacheKey = () => createHash("sha256").update(JSON.stringify([guildId, slug, sourceVersion, resources?.identity ?? null, resources?.bundleVersion ?? pinnedVersionFor(state.session.format), verification, projection.visibility, projection.dataSeat, projection.reveal,
        crossVersion ? [verificationKey!.boardStamp, verificationKey!.resourceStamp]
          : storedBoardStamp(saved, projection.dataSeat, projection.reveal, readSaved, source.session.seats.length)])).digest("hex");
      const build = () => replayCache.getOrBuild(cacheKey(), () => buildReplayData({ source, sourceVersion,
        ...(isReplayFork(state.session) ? { manualLossAnswersAfter: state.setup!.replayFork!.origin.prefixCount } : {}),
        resources: { ...journalResourcesOf(resources), ...(crossVersion ? { allowVersionMismatch: true } : {}) }, dataSeat: projection.dataSeat,
        verifyFinalViews: crossVersion && !unchecked ? views => {
          const previous = replayVerifications.get(verificationKey!);
          if (previous?.result === "verified" && (previous.coreFamily === null || previous.coreFamily === resources!.identity.coreFamily)) return;
          // A concurrent worker may have failed since this build started. This worker must
          // still compare its boards so a valid pass can replace that failure.
          // Reproduce host finalization from the session after checking the engine winner.
          const matchesView = (savedView: DuelEngineView, rebuilt: DuelEngineView): boolean => {
            if (rebuilt.result?.victory !== savedView.result?.victory) return false;
            const expected: NonNullable<DuelEngineView["result"]> = {
              winnerSeat: source.session.winnerSeat, reason: source.session.resultReason ?? "Duel ended",
              ...(source.session.format === "tag" ? { winnerTeam: source.session.winnerSeat === null ? null
                : teamOfSeat("tag", source.session.winnerSeat) } : {}),
              ...(rebuilt.result?.victory === "exodia" ? { victory: "exodia" } : {}),
            };
            if (rebuilt.result && (rebuilt.result.winnerSeat !== expected.winnerSeat
              || (source.session.format === "tag" && rebuilt.result.winnerTeam !== expected.winnerTeam))) return false;
            return sameReplayBoard(savedView, freezeView(rebuilt, expected));
          };
          const matches = matchesView(readSaved(null)!, views.public)
            && source.session.seats.every(seat => matchesView(readSaved(seat.seat)!, views.seats[seat.seat]!));
          if (signal?.aborted) signal.throwIfAborted();
          if (sourceVersion !== replaySourceVersion(journalSourceOf(service.privateState(slug, guildId)))) {
            throw new ReplayBuildError("The source changed. Refresh the replay.", "SOURCE_CHANGED");
          }
          if (!matches) throw new ReplayBuildError("Replay could not be verified.", "REPLAY_UNVERIFIED");
          replayVerifications.set(verificationKey!, null, resources!.identity.coreFamily);
        } : undefined,
        reveal: projection.reveal, retainStepsOnOverflow: true, finalView: unchecked ? null : finalView,
        timeoutMs: Math.max(1, buildDeadline - Date.now()),
        signal, encodeView: view => replayJsonEncoder.encode(view), createWorker: signal => spawn(undefined, { signal, table: slug }) }), alternate !== undefined);
      let built: ReplayBuildData;
      let firstFailure: { reason: ReplayUnverifiedReason; coreFamily: EngineIdentity["coreFamily"] } | undefined;
      let transientFailure: ReplayBuildError | undefined;
      for (;;) {
        const started = Date.now();
        try { built = await build(); break; }
        catch (error) {
          const failure = replayBuildError(error);
          if (transientFailure && failure.code === "ENGINE_UNAVAILABLE_FOR_SOURCE") throw transientFailure;
          if (!verificationKey || (failure.code !== "REPLAY_MISMATCH" && failure.code !== "REPLAY_UNVERIFIED"
            && !(unknownChoice && !unchecked && failure.familyFailed))) throw error;
          signal?.throwIfAborted();
          if (sourceVersion !== replaySourceVersion(journalSourceOf(service.privateState(slug, guildId)))) {
            throw new RequestError("The source changed. Refresh the replay.", 409, "SOURCE_CHANGED");
          }
          if (failure.familyFailed) transientFailure ??= failure;
          const currentFailure = { reason: failure.code === "REPLAY_UNVERIFIED" ? "board_mismatch" as const : "command_mismatch" as const,
            coreFamily: resources!.identity.coreFamily };
          firstFailure ??= currentFailure;
          if (alternate) {
            // Reserve at least the first attempt's duration for the second. Share the 25-second
            // budget and keep the existing 28-second request deadline, rather than doubling them.
            if (buildDeadline - Date.now() < Math.max(1_000, Date.now() - started)) {
              throw new RequestError("Replay verification needs more time. Try again shortly.", 503, "REPLAY_VERIFIED_RETRY");
            }
            resources = alternate; alternate = undefined;
            continue;
          }
          // Crashes and loop limits select the other family but cannot prove a lasting mismatch.
          if (transientFailure) throw transientFailure;
          // Prefer a family that ran the commands, so the owner can open it unchecked.
          // An unchecked failure must never replace a checked pass.
          const preferred = firstFailure.reason === "command_mismatch" ? currentFailure : firstFailure;
          if (!unchecked) {
            // Another projection may have verified while this worker was running. Preserve its
            // pass, and let this projection retry without retaining a second-family failure.
            if (replayVerifications.get(verificationKey)?.result === "verified") throw failure;
            replayVerifications.set(verificationKey, preferred.reason, preferred.coreFamily);
          }
          refuseUnverified(preferred.reason);
        }
      }
      if (sourceVersion !== replaySourceVersion(journalSourceOf(service.privateState(slug, guildId)))) {
        throw new RequestError("The source changed. Refresh the replay.", 409, "SOURCE_CHANGED");
      }
      if (built.oversized && (projection.version !== 2 || projection.ownerUserId === undefined)) {
        throw new RequestError("Replay is too large to load safely (16 MiB limit). Open the saved final board.", 413, "REPLAY_TOO_LARGE", finalBoard);
      }
      const { frames, viewJson } = built;
      const canFork = projection.ownerUserId !== undefined && !isReplayFork(state.session)
        && !replayHasUnsequencedLoss(source) && built.steps.some(step => step.cursor !== null);
      if (projection.version === 1) return { viewJson, replay: { verification, session: room.session, role: room.role, mySeat: room.mySeat,
        frames: frames.map(({ step, actorSeat, view }) => ({ step, actorSeat, view })) } };
      return { viewJson, replay: { verification, version: 2, sourceVersion, visibility: projection.visibility,
        ...(projection.reveal !== undefined ? { reveal: projection.reveal } : {}),
        session: room.session, role: room.role, mySeat: room.mySeat, dataSeat: projection.dataSeat,
        frames: projectReplayFrames(frames, replayCursorCodec, canFork),
        ...(built.oversized ? { forkSteps: projectReplaySteps(built.steps, replayCursorCodec, canFork),
          replayError: { code: "REPLAY_TOO_LARGE" as const, error: "Move views exceed the size limit. Showing the final board; choose a move to Jump in." } } : {}),
        ...(projection.ownerUserId !== undefined ? { capabilities: {
          canFork,
          privateSeats: room.session.seats.map(seat => seat.seat),
        } } : {}),
      } };
    } catch (error) {
      if (error instanceof RequestError && error.code === "ENGINE_UNAVAILABLE_FOR_SOURCE") {
        throw new RequestError(error.message, error.status, error.code, finalBoard);
      }
      if (error instanceof RequestError && error.code) throw error;
      const failure = replayBuildError(error);
      if (verificationKey && (failure.code === "REPLAY_MISMATCH" || failure.code === "REPLAY_UNVERIFIED")) {
        refuseUnverified(failure.code === "REPLAY_MISMATCH" ? "command_mismatch" : "board_mismatch");
      }
      throw new RequestError(failure.message, failure.status, failure.code,
        ["ENGINE_UNAVAILABLE_FOR_SOURCE", "REPLAY_MISMATCH", "NOT_PLAYABLE", "REPLAY_TOO_LARGE"].includes(failure.code) ? finalBoard : undefined);
    }
  }

  async function replayRequest(body: Record<string, unknown>, slug: string, guildId: string, actor: number, signal?: AbortSignal): Promise<ReplayHttpResult> {
    const privileged = body.op === "owner-replay";
    const accessActor = { guildId, playerId: actor, ...(body.userId !== undefined ? { userId: body.userId as number } : {}) };
    if (body.unchecked === true && !resolveOwnerPlayer(options.db, accessActor)) {
      throw new RequestError("Unchecked replay requires owner access.", 403, "ACCESS_DENIED");
    }
    // A signed web request is not owner authority. Check the database mapping and current list first.
    if (privileged) assertOwnerReplaySourceAccess(options.db, slug, accessActor);
    if (body.as !== undefined || (!privileged && (body.seat !== undefined || body.reveal !== undefined))) {
      throw new RequestError("Private replay overrides are not allowed", 400, "INVALID_CURSOR");
    }
    const version = body.version ?? (privileged ? 2 : 1);
    if ((version !== 1 && version !== 2) || (privileged && version !== 2)
      || (body.visibility !== undefined && body.visibility !== "mine" && body.visibility !== "public")
      || (body.reveal !== undefined && typeof body.reveal !== "boolean")
      || (body.unchecked !== undefined && typeof body.unchecked !== "boolean")) {
      throw new RequestError("Invalid replay request", 400, "INVALID_CURSOR");
    }
    let room: DuelRoom;
    if (privileged) {
      const session = service.get(slug, guildId);
      const mySeat = session.seats.find(seat => seat.playerId === actor)?.seat ?? null;
      room = { session, role: mySeat === null ? "spectator" : "player", mySeat, myDeck: null, engine: null, clock: null, metadataOnly: true };
    } else {
      assertDuelForkAccess(options.db, slug, accessActor);
      try { room = service.room(slug, guildId, actor, { includeStoredBoard: false }); }
      catch (error) {
        if (error instanceof DuelServiceError && error.status === 403) throw new RequestError("You cannot view this duel", 403, "ACCESS_DENIED");
        throw error;
      }
    }
    const visibility = (body.visibility ?? "mine") as ReplayVisibility;
    let dataSeat = visibility === "public" ? null : room.mySeat;
    if (privileged && body.seat !== undefined) {
      if (!Number.isInteger(body.seat) || !room.session.seats.some(seat => seat.seat === body.seat)) {
        throw new RequestError("Invalid replay seat", 400, "INVALID_CURSOR");
      }
      dataSeat = body.seat as number;
    }
    const owner = resolveOwnerPlayer(options.db, accessActor);
    const result = await replay(slug, guildId, room, { version, visibility, dataSeat,
      ...(privileged && body.reveal !== undefined ? { reveal: body.reveal as boolean } : {}),
      unchecked: body.unchecked === true,
      ...(owner ? { ownerUserId: owner.userId, ownerPlayerId: owner.playerId } : {}) }, signal);
    // Access can be revoked while a detached worker is building a private projection.
    if (privileged) assertOwnerReplaySourceAccess(options.db, slug, accessActor);
    else {
      assertDuelForkAccess(options.db, slug, accessActor); service.room(slug, guildId, actor, { includeStoredBoard: false });
      if (owner && !resolveOwnerPlayer(options.db, accessActor)) {
        throw new RequestError("Replay access changed. Reload the replay.", 404, "ACCESS_DENIED");
      }
    }
    return result;
  }

  function requireScenarios(): void {
    if (process.env.DUEL_SCENARIOS !== "1") throw new RequestError("Not found", 404);
  }

  /** Hand scenarios: make a table from a preset, fill the bot seats and start the duel. */
  async function startPreset(body: Record<string, unknown>, guildId: string, actor: number): Promise<unknown> {
    const checksAt = performance.now();
    const preset = typeof body.presetId === "string" ? getPreset(body.presetId) : undefined;
    if (!preset) throw new RequestError("Unknown preset", 404);
    const presetBlock = multiplayerSeatsBlockReason(seatCountFor(preset.format), multiplayerTablesEnabled());
    if (presetBlock) throw new RequestError(presetBlock, 403);
    if (preset.needs === "multi-core" && !multiCoreAvailable(options.dataDirectory)) {
      throw new RequestError("This scenario needs the multi-duelist engine core, which is not installed on this server yet.", 409);
    }
    let seed: string[];
    if (body.seed === undefined) {
      const bytes = randomBytes(32);
      seed = [0, 8, 16, 24].map((offset) => bytes.readBigUInt64LE(offset).toString());
    } else if (Array.isArray(body.seed) && body.seed.length === 4 && body.seed.every((item) => typeof item === "string" && /^\d{1,20}$/.test(item))) {
      seed = body.seed as string[];
    } else {
      throw new RequestError("Seed must be 4 decimal strings", 400);
    }
    const compiled = compileBoard(preset.board, options.dataDirectory);
    const catalog = loadCardDatabase(options.dataDirectory);
    const blocked = cardBlockIndex(new Map([...catalog.all()].map((card) => [card.code, card])), admissionEntries(compiled.options.mode ?? "normal", preset.format, "pinned"), options.dataDirectory);
    for (const code of compiled.codes) {
      const entry = blocked.get(code);
      if (entry) throw new RequestError(`${catalog.get(code)?.name ?? code} is unavailable: ${entry.reason}`, 400);
    }
    const copts = compiled.options;
    const seatCount = seatCountFor(preset.format);
    // Mark a scenario before engine startup yields, so a web create cannot replace its temporary lobby.
    const created = options.db.transaction(() => {
      const session = service.create({
        guildId,
        organizerPlayerId: actor,
        name: preset.title,
        mode: copts.mode ?? "normal",
        masterRule: copts.masterRule,
        settings: copts.settings,
        format: preset.format,
      });
      service.setSetup(session.slug, guildId, { presetId: preset.id, scenarioId: preset.id });
      return session;
    }).immediate();
    const slug = created.slug;
    let game: DuelGameWorker | undefined;
    try {
      service.setDeck(slug, guildId, actor, copts.decks[0]!);
      for (let seat = 1; seat < seatCount; seat += 1) service.addPracticeBot(slug, guildId, actor, copts.decks[seat]!, seat);
      const state = service.privateState(slug, guildId);
      const settings = state.session.settings;
      const scripts = (copts.startupScripts ?? []).map((script) => script.content);
      const engine = engineForNewTable(preset.format, copts.mode, true);
      const firstTurnDraw = firstTurnDrawFor(state.session.mode, state.session.masterRule, preset.format, settings);
      const scriptErrorMode = scriptErrorModeFromEnv();
      const resources = await engineResourceCache.get(options.dataDirectory, { mode: state.session.mode, format: preset.format, engine });
      const botPolicies: Record<string, string> = {};
      for (let seat = 1; seat < seatCount; seat += 1) botPolicies[String(seat)] = SCRIPTED_POLICY;
      const started = await createStartingWorker(slug, state.session,
        workerCreateOptions(state.session.mode, state.decks, seed, state.session.masterRule, settings, preset.format, scripts, engine, firstTurnDraw, scriptErrorMode, resources),
        seatCount, performance.now() - checksAt);
      game = started.game;
      const firstView = started.firstView;
      const clock = startDecisionClock(firstView, settings.turnSeconds, now(), seatCount);
      service.activateRecorded(slug, guildId, actor, seed, resources.bundleVersion, clock, {
        firstTurnDraw,
        scriptErrorMode,
        scenarioId: preset.id,
        presetId: preset.id,
        startupScripts: scripts,
        botPolicies,
        ...(preset.format === "1v1" ? { engine: "pinned" as const } : {}),
      }, resources.identity);
      games.set(slug, {
        game,
        lastRequestAt: now(),
        guildId,
        surrendered: new Set(),
        policies: policiesOf({ presetId: preset.id, botPolicies }),
        presetId: preset.id,
        traces: new Map(),
      });
    } catch (error) {
      games.delete(slug);
      if (game) await safeClose(game);
      try {
        service.cancel(slug, guildId, actor);
      } catch {
        // The table is already gone or started.
      }
      throw error;
    }
    rememberReportCapture(slug, guildId, await game.view(null, { fullLog: true }));
    await emitChange(slug, guildId);
    await driveBot(slug, guildId, game);
    const room = await project(slug, guildId, actor, game);
    return { slug, session: room.session, room };
  }

  /** One debug read of a view. A stuck worker never answers, so every read has a time limit. */
  async function readDebugView(slug: string, game: DuelGameWorker, seat: number | null): Promise<{ view: DuelEngineView | null; error?: string }> {
    try {
      const view = await withTimeout(game.view(seat), debugReadTimeoutMs, `view ${seat === null ? "spectator" : `seat ${seat}`}`);
      rememberView(slug, seat, view, game);
      return { view };
    } catch (error) {
      const { body } = errorResponseBody(error, { tags: { operation: "[duel] debug view" } });
      return { view: null, error: body.error };
    }
  }

  function workerStateOf(game: DuelGameWorker | undefined): WorkerDebugState {
    return (
      game?.debugState?.() ?? {
        busy: false,
        lastOp: null,
        lastOpAt: null,
        wasmSha: null,
        wasmFile: null,
        callsSinceLastPrompt: 0,
        messagesSinceLastPrompt: 0,
      }
    );
  }

  /**
   * Hand scenarios: everything a triage tool needs to classify a stuck duel. Reads the worker with time limits and never
   * waits in the duel queue, so it answers even when the core is stuck. `worker.callsSinceLastPrompt` and
   * `worker.messagesSinceLastPrompt` are as of the last request the worker finished.
   */
  async function buildDebugTrace(slug: string, guildId: string): Promise<Record<string, unknown>> {
    const session = service.get(slug, guildId);
    const entry = games.get(slug);
    const game = entry?.game;
    const seatCount = seatCountFor(session.format);
    const errors: string[] = [];
    const reads = game?.running
      ? await Promise.all([...Array.from({ length: seatCount }, (_, seat) => readDebugView(slug, game, seat)), readDebugView(slug, game, null)])
      : [];
    const spectatorRead = reads[seatCount];
    for (const read of reads) if (read.error) errors.push(read.error);
    const seats = Array.from({ length: seatCount }, (_, seat) => {
      const view = reads[seat]?.view ?? null;
      const prompt = view?.prompt && view.prompt.seat === seat ? view.prompt : undefined;
      return { seat, view, ...(prompt ? { prompt } : {}) };
    });
    const spectator = spectatorRead?.view ?? null;
    const revision = spectator?.revision ?? seats.find((item) => item.view)?.view?.revision ?? null;
    const worker = workerStateOf(game);
    const loop = botLoops.get(slug);
    const botSeats = autoSeatsOf(session, entry).map((seat) => {
      const policy = entry?.surrendered.has(seat) ? "surrendered" : entry?.policies.has(seat) ? "scripted" : "practice";
      const timer = loop?.timer && loop.timer.seat === seat ? { delayMs: loop.timer.delayMs, startedAt: loop.timer.startedAt, dueAt: loop.timer.dueAt } : undefined;
      return { seat, policy, ...(timer ? { timer } : {}), lastTrace: entry?.traces.get(seat) ?? [] };
    });
    return {
      revision,
      wasmSha: worker.wasmSha,
      wasmFile: worker.wasmFile,
      seats,
      promptLog: game?.promptLog?.() ?? [],
      spectator,
      bot: { seats: botSeats },
      worker: {
        busy: worker.busy,
        lastOp: worker.lastOp,
        lastOpAt: worker.lastOpAt,
        callsSinceLastPrompt: worker.callsSinceLastPrompt,
        messagesSinceLastPrompt: worker.messagesSinceLastPrompt,
      },
      slug,
      status: session.status,
      at: now(),
      ...(errors.length > 0 ? { errors } : {}),
    };
  }

  /**
   * The journal lines of a report. First line: the e2e journal header (format `yugidraft-duel-journal/1`, decks, settings,
   * startup scripts, core sha and more). Then one line per accepted command at its seq (`answer`, `eliminate` or `chain-mode`). A surrender
   * sits before the first answer that the host gave for that seat on autopilot, so a replayer sees it at its seq.
   */
  function reportJournalLines(state: ReturnType<typeof service.privateState>, worker: WorkerDebugState): unknown[] {
    const session = state.session;
    const startupScripts = (state.setup?.startupScripts ?? []).map((content, index) => ({ name: `startup-${index}.lua`, content }));
    const lines: unknown[] = [
      {
        type: "duel",
        format: "yugidraft-duel-journal/1",
        slug: session.slug,
        name: session.name,
        ...(state.setup?.presetId ? { presetId: state.setup.presetId } : {}),
        mode: session.mode,
        tableFormat: session.format,
        masterRule: session.masterRule,
        status: session.status,
        winnerSeat: session.winnerSeat,
        resultReason: session.resultReason,
        createdAt: session.createdAt,
        endedAt: session.endedAt,
        bundleVersion: state.bundleVersion,
        // The Lua overlay a duel with more than two seats loads, as it is when the journal is written. bundleVersion
        // above pins it at the start, but only as one hash, so this field says which folder to look for.
        multiScriptsHash: seatCountFor(session.format) > 2 ? activeMultiScriptsHash(options.dataDirectory) : null,
        seed: state.seed,
        settings: session.settings,
        setup: reportSetup(state.setup),
        startupScripts,
        wasmSha: worker.wasmSha,
        wasmFile: worker.wasmFile,
        wasmSha256: worker.wasmSha && worker.wasmFile ? { [worker.wasmFile]: worker.wasmSha } : {},
        seats: session.seats.map((seat) => ({ seat: seat.seat, playerId: seat.playerId, isBot: seat.isBot })),
        decks: state.decks,
        commands: [],
      },
    ];
    const markerAt = new Map<number, number>();
    for (const seat of state.setup?.surrenderedSeats ?? []) {
      if (state.commands.some((entry) => entry.seat === seat && eliminationAtTurnEnd(entry.command.promptId))) continue;
      const index = state.commands.findIndex((entry) => entry.seat === seat && (entry.command as { note?: string }).note === SURRENDER_AUTOPILOT_NOTE);
      markerAt.set(seat, index >= 0 ? index + 1 : state.commands.length + 1);
    }
    const marker = (seq: number) => {
      for (const [seat, at] of markerAt) if (at === seq) lines.push({ type: "surrender", seq, seat });
    };
    state.commands.forEach((entry, index) => {
      // Report seq is an ordered index, independent of the database's storedSeq.
      const seq = index + 1;
      marker(seq);
      const command = entry.command as DuelCommand & { note?: string };
      lines.push({
        type: chainModeOf(command.promptId) !== null ? "chain-mode" : eliminationReasonOf(command) === null ? "answer" : "eliminate",
        seq,
        seat: entry.seat,
        bot: session.seats.some((seat) => seat.seat === entry.seat && seat.isBot),
        ...(command.note ? { note: command.note } : {}),
        command,
      });
    });
    marker(state.commands.length + 1);
    return lines;
  }

  /**
   * Writes one report folder: note, journal (replayable), views, engine diagnostics and the debug trace.
   * Used by the manual report op and by the stall watchdog. It never waits in the duel queue.
   */
  async function writeReportFolder(
    slug: string,
    guildId: string,
    input: {
      kind: "manual" | "auto-stall";
      note: string;
      game?: DuelGameWorker;
      fallbackViews?: Map<number, DuelEngineView>;
      stall?: Record<string, unknown>;
      /** The core did not answer in time: write from what the host has. No core view reads. */
      partial?: { reason: string };
    },
  ): Promise<{ path: string }> {
    const game = input.game;
    const state = service.privateState(slug, guildId);
    const session = state.session;
    const root = process.env.DUEL_REPORT_DIR ?? resolve(options.dataDirectory, "..", "..", ".status", "manual");
    const stamp = new Date(now()).toISOString().replace(/[:.]/g, "-");
    const dir = join(root, `${slug}-${input.kind === "auto-stall" ? "auto-stall-" : ""}${stamp}`);
    mkdirSync(join(dir, "views"), { recursive: true });
    const worker = workerStateOf(game);
    writeFileSync(join(dir, "journal.jsonl"), reportJournalLines(state, worker).map((line) => JSON.stringify(line)).join("\n") + "\n");
    const seatCount = seatCountFor(session.format);
    for (let seat = 0; seat < seatCount; seat += 1) {
      let view: DuelEngineView | undefined;
      if (input.partial) view = lastViews.get(slug)?.get(seat) ?? input.fallbackViews?.get(seat);
      else if (game?.running) view = (await readDebugView(slug, game, seat)).view ?? input.fallbackViews?.get(seat);
      else view = input.fallbackViews?.get(seat);
      if (view) writeFileSync(join(dir, "views", `seat-${seat}.json`), JSON.stringify(view, null, 2));
    }
    if (input.partial) {
      const spectatorView = lastViews.get(slug)?.get(-1);
      if (spectatorView) writeFileSync(join(dir, "views", "spectator.json"), JSON.stringify(spectatorView, null, 2));
      writeFileSync(join(dir, "room-setup.json"), JSON.stringify({ session, setup: reportSetup(state.setup) }, null, 2));
      writeFileSync(join(dir, "partial.json"), JSON.stringify({ partial: true, reason: input.partial.reason, slug, at: new Date(now()).toISOString() }, null, 2));
    }
    // Triage only: the engine's ring buffer (response order, messages 200-202, wins, eliminations, core log lines). Not a player view.
    // The ring and the trace each have a time limit. They run together so a stuck core costs one limit, not two.
    const diagnosticsJob = async (): Promise<void> => {
      if (!(game?.running && typeof game.diagnostics === "function")) return;
      let entries: unknown;
      try {
        entries = await withTimeout(game.diagnostics(), debugReadTimeoutMs, "diagnostics");
      } catch (error) {
        entries = { error: error instanceof Error ? error.message : String(error) };
      }
      writeFileSync(join(dir, "engine-diagnostics.json"), JSON.stringify({ wasmSha: worker.wasmSha, wasmFile: worker.wasmFile, entries }, null, 2));
    };
    const traceJob = async (): Promise<void> => {
      try {
        writeFileSync(join(dir, "debug-trace.json"), JSON.stringify(await buildDebugTrace(slug, guildId), null, 2));
      } catch (error) {
        writeFileSync(join(dir, "debug-trace.json"), JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
      }
    };
    await Promise.all([diagnosticsJob(), traceJob()]);
    if (input.stall) {
      writeFileSync(join(dir, "stall.json"), JSON.stringify({ slug, ...(state.setup?.presetId ? { presetId: state.setup.presetId } : {}), wasmSha: worker.wasmSha, wasmFile: worker.wasmFile, worker, ...input.stall }, null, 2));
    }
    const preset = state.setup?.presetId ? getPreset(state.setup.presetId) : undefined;
    const text = [
      `# ${input.kind === "auto-stall" ? "Automatic stall report" : "Manual test note"}: ${slug}`,
      "",
      ...(input.partial ? [`PARTIAL REPORT: the core did not answer (${input.partial.reason}). Views are the last ones the host sent.`, ""] : []),
      `Scenario: ${preset ? `${preset.id} (${preset.title})` : "none"}`,
      `Status: ${session.status}`,
      `Core: ${worker.wasmFile ?? "unknown"} ${worker.wasmSha ?? ""}`.trim(),
      "",
      input.kind === "auto-stall" ? "## Stall" : "## Tester note",
      "",
      input.note.trim() || "(empty)",
      "",
      ...(preset ? ["## Checklist", "", ...preset.checklist.map((item, index) => `${index + 1}. ${item}`), ""] : []),
    ].join("\n");
    writeFileSync(join(dir, "note.md"), text);
    return { path: dir };
  }

  /** Hand scenarios: write the tester's note, the journal and every seat's view to `.status/manual/`. */
  async function writeReport(slug: string, guildId: string, actor: number, note: unknown, ctl?: { abandoned: boolean }): Promise<{ path: string }> {
    if (typeof note !== "string" || note.length > 4000) throw new RequestError("Note must be text of at most 4000 characters", 400);
    const room0 = service.room(slug, guildId, actor);
    if (room0.mySeat === null) throw new RequestError("Join this duel first", 403);
    let game = games.get(slug)?.game;
    if (room0.session.status === "active") game = await recover(slug, guildId);
    // A partial report was already written for this request: never write a second folder.
    if (ctl?.abandoned) return { path: "" };
    const fallbackViews = new Map<number, DuelEngineView>();
    if (room0.engine) fallbackViews.set(room0.mySeat, room0.engine);
    return writeReportFolder(slug, guildId, { kind: "manual", note, game, fallbackViews });
  }

  /** The core or the duel queue did not answer in time: write the report folder from what the host has. */
  async function writePartialReport(slug: string, guildId: string, actor: number, note: unknown): Promise<{ path: string; partial: true }> {
    if (typeof note !== "string" || note.length > 4000) throw new RequestError("Note must be text of at most 4000 characters", 400);
    const room0 = service.room(slug, guildId, actor);
    if (room0.mySeat === null) throw new RequestError("Join this duel first", 403);
    const fallbackViews = new Map<number, DuelEngineView>();
    if (room0.engine) fallbackViews.set(room0.mySeat, room0.engine);
    const written = await writeReportFolder(slug, guildId, {
      kind: "manual",
      note,
      game: games.get(slug)?.game,
      fallbackViews,
      partial: { reason: `the duel queue or the core did not answer within ${queueBlockedMs} ms` },
    });
    return { ...written, partial: true };
  }

  /** A room read while the duel queue is blocked: the last view built for this seat, marked stale. Null when there is none. */
  function staleRoom(slug: string, guildId: string, actor: number, control: { as?: unknown; reveal?: boolean } = {}): (DuelRoom & { stale: true }) | null {
    const room = stampRoomClock(service.room(slug, guildId, actor), now());
    if (room.session.status !== "active") return null;
    const cached = lastViews.get(slug);
    if (isReplayFork(room.session)) {
      const ownViews = room.session.seats.map(s => cached?.get(s.seat) ?? null);
      const first = ownViews.find(view => view !== null);
      let seat: number;
      try { seat = resolveReplayForkSeat(room.session, control.as, first ? initialForkSeat(first) : 0); }
      catch { throw new RequestError("Invalid replay fork acting seat", 400); }
      if (!ownViews[seat]) return null;
      const state = service.privateState(slug, guildId);
      return { ...replayForkRoom(room, state.setup!.replayFork!, ownViews, seat, control.reveal ?? true), stale: true };
    }
    const view = cached?.get(room.mySeat ?? -1);
    if (!view) return null;
    room.engine = view;
    const publicView = cached?.get(-1);
    if (room.mySeat !== null && [...cached!.values()].some((known) => known.seats.some((seat) => seat.seat === room.mySeat && seat.eliminated))) {
      // Keep the actor's player role until an explicit Watch request. A stale board
      // must still use public cards once another cached view proves elimination.
      room.engine = publicView ? { ...publicView, prompt: null } : null;
    }
    return { ...room, stale: true };
  }

  /** Hand scenarios: the debug trace of one duel (404 unless `DUEL_SCENARIOS=1`). Not queued, so it works on a stuck duel. */
  async function debugTrace(slug: string, guildId: string, actor: number): Promise<Record<string, unknown>> {
    const room0 = service.room(slug, guildId, actor);
    if (room0.mySeat === null) throw new RequestError("Join this duel first", 403);
    return buildDebugTrace(slug, guildId);
  }

  /**
   * The public facts of one duel for a bug report, read from the spectator view (audience "all" log lines only) so no
   * private line can reach a public GitHub issue. Never waits in the duel queue and never starts a core, so it answers
   * for a stuck duel too: when the core does not answer in time it uses the last spectator view, or gives no log.
   */
  async function bugContext(slug: string, guildId: string, actor: number): Promise<BugDuelContext> {
    const room = service.room(slug, guildId, actor, { includeStoredBoard: false });
    const { format, mode } = room.session;
    const out: BugDuelContext = { format, mode, seat: room.mySeat, turn: null, phase: null, turnSeat: null, livingPlayers: null, log: [], board: null, source: null };
    let view: DuelEngineView | null = null;
    const live = games.get(slug);
    const before = service.privateState(slug, guildId);
    const busy = queues.has(slug);
    if (room.session.status === "active" && live?.game.running) {
      try {
        view = await withTimeout(live.game.view(null, { fullLog: true }), debugReadTimeoutMs, "view spectator");
        rememberView(slug, null, view, live.game);
        out.source = "live";
      } catch (error) {
        view = lastViews.get(slug)?.get(-1) ?? null;
        if (view) out.source = "cached";
        else out.missingReason = error instanceof Error && error.message.startsWith("view spectator timed out")
          ? "the duel engine did not answer in time" : "the duel engine view failed";
      }
    }
    if (!view && room.session.status === "active") {
      view = lastViews.get(slug)?.get(-1) ?? null;
      if (view) out.source = "cached";
    }
    const readSaved = () => readStoredBoard(options.db.prepare<[string, string], StoredDuelBoards>(
      "select snapshot_public_json from duels where web_slug = ? and guild_id = ?",
    ).get(slug, guildId), null);
    if (!view && reportCaptures.has(slug)) {
      // A finished duel's saved view can be newer than a capture that was never refreshed.
      const saved = room.session.status === "active" ? null : readSaved();
      const newer = saved && saved.revision > reportCaptures.get(slug)!.board.revision;
      view = newer ? saved : reportCaptures.get(slug)!.board;
      out.source = newer ? "stored" : "cached";
    }
    if (!view) {
      view = readSaved();
      if (view) out.source = "stored";
    }
    if (!view) {
      out.missingReason ??= room.session.status === "lobby" ? "the duel has not started" : "the duel has no saved board";
      return out;
    }
    delete out.missingReason;
    const after = service.privateState(slug, guildId);
    if ((out.source === "stored" && room.session.status !== "active")
      || (out.source === "live" && !busy && !queues.has(slug) && before.commands.length === after.commands.length)) {
      rememberReportCapture(slug, guildId, view);
    }
    const capture = reportCaptures.get(slug);
    if (capture && !(out.source === "stored" && view.revision > capture.board.revision)) {
      // A cached view can have the same revision but only a log tail. Use the complete paired capture.
      if (capture.board.revision !== view.revision) out.source = "cached";
      view = capture.board;
      out.moment = capture.moment;
    }
    if (out.moment) {
      const count = out.moment.journalCount as number;
      out.moment = { ...out.moment, prefixHash: replayPrefixHash(journalSourceOf(after), count) };
    }
    if (room.session.status !== "active") reportCaptures.delete(slug);
    out.board = view;
    const gone = live?.surrendered ?? new Set<number>();
    out.turn = view.turn;
    out.phase = view.phase;
    out.turnSeat = view.turnSeat;
    out.livingPlayers = view.seats.filter((seat) => !seat.eliminated && !seat.pendingElimination && !gone.has(seat.seat)).length;
    out.log = view.log.slice(-BUG_CONTEXT_LOG_LINES).map((entry) => entry.text);
    return out;
  }

  // Stall watchdog: revision unchanged for `stallMs` while a bot seat or the core must act.
  const stallWatch = new Map<string, { revision: number | null; since: number; reported: boolean }>();
  let stallChecking = false;

  async function checkStall(slug: string, entry: LiveGame): Promise<void> {
    const t = now();
    const session = service.get(slug, entry.guildId);
    if (session.status !== "active") {
      stallWatch.delete(slug);
      return;
    }
    const seatCount = seatCountFor(session.format);
    const reads = await Promise.all(Array.from({ length: seatCount }, (_, seat) => readDebugView(slug, entry.game, seat)));
    const views = reads.map((read) => read.view);
    const known = views.find((view): view is DuelEngineView => view !== null) ?? null;
    const revision = known?.revision ?? null;
    let watch = stallWatch.get(slug);
    if (!watch || (revision !== null && revision !== watch.revision)) {
      watch = { revision, since: t, reported: false };
      stallWatch.set(slug, watch);
    }
    let waitingOn: string | null = null;
    if (!known) waitingOn = "core (the worker does not answer)";
    else if (known.result) waitingOn = null;
    else {
      const promptSeat = views.findIndex((view, seat) => view?.prompt?.seat === seat);
      if (promptSeat < 0) waitingOn = "core (no seat holds a prompt)";
      else if (autoSeatsOf(session, entry).includes(promptSeat)) waitingOn = `bot seat ${promptSeat}`;
    }
    // A human may take as long as the clock allows: the stall timer only runs while a bot or the core must act.
    if (waitingOn === null) {
      watch.since = t;
      return;
    }
    if (watch.reported || t - watch.since < stallMs) return;
    watch.reported = true;
    const stalledMs = t - watch.since;
    const note = `Revision ${revision ?? "unknown"} did not change for ${Math.round(stalledMs / 1000)} s. Waiting on: ${waitingOn}.`;
    const written = await writeReportFolder(slug, entry.guildId, {
      kind: "auto-stall",
      note,
      game: entry.game,
      stall: { revision, stalledMs, waitingOn, stallMs, at: new Date(t).toISOString() },
    });
    log("warn", "[duel] Table stalled; diagnostic report saved", { stalledMs, stallMs });
  }

  async function checkStalls(): Promise<void> {
    if (stopped || stallChecking) return;
    stallChecking = true;
    try {
      for (const slug of [...stallWatch.keys()]) if (!games.has(slug)) stallWatch.delete(slug);
      for (const [slug, entry] of [...games]) {
        if (stopped) return;
        if (!entry.game.running) continue;
        try {
          await checkStall(slug, entry);
        } catch (error) {
          report(error, { tags: { operation: "[duel] stall check failed" } });
        }
      }
    } finally {
      stallChecking = false;
    }
  }

  /**
   * `report` and `view` must not hang behind a duel queue that is stuck inside the core. After `queueBlockedMs`:
   * a report is written without the core, a room read answers the last view sent to that seat (when there is one).
   */
  async function answerOrFallback(body: Record<string, unknown>, queued: Promise<unknown>, ctl: { abandoned: boolean }): Promise<unknown> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = Symbol("queue-blocked");
    const limit = new Promise<typeof timedOut>((resolveLimit) => {
      timer = setTimeout(() => resolveLimit(timedOut), queueBlockedMs);
    });
    const first = await Promise.race([queued, limit]).finally(() => clearTimeout(timer));
    if (first !== timedOut) return first;
    const { op, guildId, playerId, slug } = body;
    if (typeof guildId !== "string" || !guildId || !Number.isSafeInteger(playerId) || (playerId as number) <= 0 || typeof slug !== "string" || !slug || slug.length > 128) {
      return queued;
    }
    const target = assertDuelForkAccess(options.db, slug, { guildId, playerId: playerId as number,
      ...(body.userId !== undefined ? { userId: body.userId as number } : {}) });
    if (body.as !== undefined && (!isReplayFork(target) || op !== "view")) throw new RequestError("Invalid acting-seat override", 400);
    if (body.reveal !== undefined && (!isReplayFork(target) || op !== "view" || typeof body.reveal !== "boolean")) {
      throw new RequestError("Invalid reveal override", 400);
    }
    if (op === "report") {
      requireScenarios();
      ctl.abandoned = true;
      return writePartialReport(slug, guildId, playerId as number, body.note);
    }
    // A spectator switch must never fall back to this player's private cached view.
    if (body.spectate === true) return queued;
    return staleRoom(slug, guildId, playerId as number, { as: body.as, reveal: body.reveal as boolean | undefined }) ?? queued;
  }

  /** The checks every start makes: a lobby duel, every seat ready, and legal decks for the format. */
  async function assertStartable(slug: string, guildId: string) {
    let session = service.get(slug, guildId);
    if (session.seriesId) {
      repairDeckCopies().series(session.seriesId);
      session = service.get(slug, guildId);
    }
    if (session.status !== "lobby") throw new RequestError("Duel already started", 409);
    const seatCount = seatCountFor(session.format);
    // The flag is read here, on every start, so a restart with another value switches it.
    const tablesBlock = multiplayerSeatsBlockReason(seatCount, multiplayerTablesEnabled());
    if (tablesBlock) throw new RequestError(tablesBlock, 403);
    const coreProblem = multiStartProblem(session.mode, session.format, options.dataDirectory);
    if (coreProblem) throw new RequestError(coreProblem, 409);
    if (!allSeatsReady(session)) {
      throw new RequestError(
        seatCount === 2
          ? "Two players must submit valid decks before starting"
          : `${seatCount} players must submit valid decks before starting`,
        409,
      );
    }
    const state = service.privateState(slug, guildId);
    const settings = state.session.settings;
    for (const [seat, deck] of state.decks.entries()) {
      const playerId = state.session.seats[seat].playerId!;
      try {
        await validateSessionDeck(state.session.mode, deck, settings, state.session.format,
          { session: state.session, playerId });
      } catch (error) {
        if (error instanceof DeckLegalityError) throw new SeatDeckLegalityError(slug, playerId, error, startDeckStateHash(state));
        throw error;
      }
    }
    return { session, state, settings, seatCount };
  }

  /** Starts a lobby game. `organizer` null is a system start, which the duel service only allows for a series game. */
  async function startGame(slug: string, guildId: string, organizer: number | null): Promise<DuelGameWorker> {
    startingGames.add(slug);
    try {
      await emitChange(slug, guildId);
      return await startGameNow(slug, guildId, organizer);
    } catch (error) {
      startingGames.delete(slug);
      await emitChange(slug, guildId);
      throw error;
    } finally {
      startingGames.delete(slug);
    }
  }

  async function startGameNow(slug: string, guildId: string, organizer: number | null): Promise<DuelGameWorker> {
    const checksAt = performance.now();
    const { state, settings, seatCount } = await assertStartable(slug, guildId);
    const bytes = randomBytes(32);
    const seed = [0, 8, 16, 24].map((offset) => bytes.readBigUInt64LE(offset).toString());
    const engine = engineForNewTable(state.session.format, state.session.mode);
    const firstTurnDraw = firstTurnDrawFor(state.session.mode, state.session.masterRule, state.session.format, settings);
    const scriptErrorMode = scriptErrorModeFromEnv();
    const resources = await engineResourceCache.get(options.dataDirectory, { mode: state.session.mode, format: state.session.format, engine });
    const resourceChecksMs = performance.now() - checksAt;
    const { game, firstView } = await createStartingWorker(slug, state.session, workerCreateOptions(
      state.session.mode, state.decks, seed, state.session.masterRule, settings, state.session.format,
      undefined, engine, firstTurnDraw, scriptErrorMode, resources,
    ), seatCount, resourceChecksMs);
    try {
      const clock = startDecisionClock(firstView, settings.turnSeconds, now(), seatCount);
      // The engine is saved with the duel, so a recover and a replay use it even after DUEL_1V1_ENGINE changes.
      service.activateRecorded(slug, guildId, organizer, seed, resources.bundleVersion, clock, {
        ...(state.setup ?? {}), firstTurnDraw, scriptErrorMode, ...(engine ? { engine } : {}),
      }, resources.identity);
      deckStartBlocks.delete(slug);
      startBackoff.delete(slug);
      games.set(slug, { game, lastRequestAt: now(), guildId, surrendered: new Set(), policies: new Map(), traces: new Map() });
      rememberReportCapture(slug, guildId, await game.view(null, { fullLog: true }));
      startingGames.delete(slug);
      await emitChange(slug, guildId);
      await driveBot(slug, guildId, game);
      return game;
    } catch (error) {
      games.delete(slug);
      await safeClose(game);
      throw error;
    }
  }

  /** One safe record for each engine start, shared by normal tables and scenarios. */
  async function createStartingWorker(slug: string, session: DuelSession, workerOptions: GameOptions, seatCount: number, resourceChecksMs: number) {
    const startedAt = performance.now();
    const steps: Record<string, number | null> = { resourceChecksMs, workerSpawnMs: null, cardDbLoadMs: null, engineCreateMs: null, firstViewMs: null };
    let game: DuelGameWorker | undefined;
    let outcome = "failed";
    try {
      const spawnAt = performance.now();
      game = await spawn(session);
      steps.workerSpawnMs = performance.now() - spawnAt;
      const createAt = performance.now();
      await game.create(workerOptions);
      const createMs = performance.now() - createAt;
      const workerTimes = game.startupTimings?.();
      steps.workerSpawnMs = workerTimes?.workerSpawnMs ?? steps.workerSpawnMs;
      steps.cardDbLoadMs = workerTimes?.cardDbLoadMs ?? null;
      steps.engineCreateMs = workerTimes?.engineCreateMs ?? createMs;
      const viewAt = performance.now();
      const firstView = await readClockView(game, seatCount);
      steps.firstViewMs = performance.now() - viewAt;
      outcome = "ready";
      return { game, firstView };
    } catch (error) {
      if (game) await safeClose(game);
      throw error;
    } finally {
      const round = (ms: number) => Math.round(ms * 10) / 10;
      console.info(JSON.stringify({ event: "duel_start", slug, outcome,
        totalMs: round(resourceChecksMs + performance.now() - startedAt),
        ...Object.fromEntries(Object.entries(steps).map(([step, ms]) => [step, ms === null ? null : round(ms)])),
      }));
    }
  }

  function clearOpeningTimer(slug: string): void {
    const timer = openingTimers.get(slug);
    if (timer === undefined) return;
    openingTimers.delete(slug);
    clearTimeout(timer);
  }

  /**
   * The practice bot gives the human one second to see the winning hands and result. The full reveal grace
   * and choice window still apply to human winners.
   */
  function botChoiceAt(winnerSeat: 0 | 1 | null, deadline: number, seats: ReadonlyArray<{ seat: number; isBot: boolean }>): number | null {
    if (winnerSeat === null || !seats.some((seat) => seat.isBot && seat.seat === winnerSeat)) return null;
    return deadline - DUEL_OPENING_PICK_MS - DUEL_OPENING_REVEAL_MS + BOT_OPENING_CHOICE_MS;
  }

  /** Fires `driveOpening` at the phase deadline, or when the bot's choice is due. A running timer for the slug is replaced. */
  function scheduleOpening(slug: string, guildId: string, state: DuelOpeningState): void {
    clearOpeningTimer(slug);
    if (stopped || state.phase === "start") return;
    let wakeAt = state.deadline;
    if (state.phase === "choose") {
      const botAt = botChoiceAt(state.winnerSeat, state.deadline, service.get(slug, guildId).seats);
      if (botAt !== null) wakeAt = Math.min(wakeAt, botAt);
    }
    const timer = setTimeout(() => {
      openingTimers.delete(slug);
      void enqueue(slug, () => driveOpening(slug, guildId)).catch((error) => {
        report(error, { tags: { operation: "[duel] opening step failed" } });
      });
    }, Math.min(MAX_TIMER_MS, Math.max(0, wakeAt - now())));
    timer.unref();
    openingTimers.set(slug, timer);
  }

  /**
   * Runs inside the duel queue: applies the timeouts, plays the practice bot's moves, and starts the duel once the
   * turn order is settled. Safe to call at any time; it does nothing when no opening runs.
   */
  async function driveOpening(slug: string, guildId: string): Promise<void> {
    if (stopped || isReplayFork(service.get(slug, guildId))) return;
    let state = service.openingState(slug, guildId);
    if (!state || service.get(slug, guildId).status !== "lobby") {
      clearOpeningTimer(slug);
      return;
    }
    // At most a few steps: settle, the bot's pick, a tie that opens the next round, the bot's choice.
    for (let step = 0; step < 6 && state && state.phase !== "start"; step += 1) {
      const settled = service.settleOpening(slug, guildId, now(), random);
      if (settled && settled !== state && JSON.stringify(settled) !== JSON.stringify(state)) {
        state = settled;
        continue;
      }
      const botSeats = service.get(slug, guildId).seats.filter((seat) => seat.isBot).map((seat) => seat.seat);
      let acted = false;
      for (const seat of botSeats) {
        if (!state || (seat !== 0 && seat !== 1)) continue;
        if (state.phase === "rps" && state.picks[seat] === null) {
          const move = DUEL_RPS_MOVES[Math.min(2, Math.floor(random() * 3))]!;
          state = service.submitOpeningPick(slug, guildId, seat, move, now());
          acted = true;
        } else if (state.phase === "choose" && state.winnerSeat === seat && now() >= (botChoiceAt(seat, state.deadline, [{ seat, isBot: true }]) ?? 0)) {
          // The bot always takes the first turn after its short result pause.
          state = service.submitOpeningChoice(slug, guildId, seat, "first", now());
          acted = true;
        }
      }
      if (!acted) break;
    }
    state = service.openingState(slug, guildId);
    if (!state) return;
    if (state.phase !== "start") {
      scheduleOpening(slug, guildId, state);
      await emitChange(slug, guildId);
      return;
    }
    // After a failed start, a room view or a poll must not start the duel again before the backoff ends.
    if ((startBackoff.get(slug)?.retryAt ?? 0) > now()) return;
    clearOpeningTimer(slug);
    try {
      // The seats are in their final order. A failed start of a series game is retried by the tick sweep.
      await startGame(slug, guildId, state.startedBy);
      startBackoff.delete(slug);
    } catch (error) {
      const session = service.get(slug, guildId);
      if (!session.seriesId && session.status === "lobby") {
        recordDeckStartBlock(slug, error);
        // Nobody retries a start for a table. Give the lobby back to its players, and show them the error.
        service.abortOpening(slug, guildId);
        log("warn", "[duel] duel did not start after the opening");
        await emitChange(slug, guildId);
        throw error;
      }
      noteStartFailure(slug, error);
      await emitChange(slug, guildId);
      if (error instanceof DeckLegalityError || error instanceof RequestError) throw error;
    }
  }

  /** A read during startup never asks the engine to work or changes the opening. */
  function startingRoom(body: Record<string, unknown>): DuelRoom | null {
    if (body.op !== "view") return null;
    const { guildId, playerId, slug } = body;
    if (typeof guildId !== "string" || !guildId || !Number.isSafeInteger(playerId) || (playerId as number) <= 0) {
      throw new RequestError("Authenticated guild and player are required", 400);
    }
    if (typeof slug !== "string" || !slug || slug.length > 128) throw new RequestError("Duel slug is required", 400);
    if (!startingGames.has(slug) || body.spectate === true) return null;
    // service.room applies guild scoping and returns only this actor's own deck and pick.
    const room = service.room(slug, guildId, playerId as number);
    // Replay forks never use this shortcut. Keep the normal play-table request
    // contract while the engine queue is busy, including rejected overrides.
    if (body.reveal !== undefined) throw new RequestError("Reveal is only available in replay fork views", 400);
    if (body.as !== undefined) throw new RequestError("Acting seats are only available in replay fork views and controls", 400);
    return room.session.status === "lobby" ? stampRoomClock({ ...room, starting: true }, now()) : null;
  }

  /**
   * Starts a lobby duel with every seat ready. Game 1 of a 1v1 duel or match goes through the rock-paper-scissors
   * opening first (when enabled). Every FFA3/FFA4 game rolls dice; Tag starts at once. Returns the live game, or null while the opening runs.
   */
  async function beginGame(slug: string, guildId: string, actor: number | null): Promise<DuelGameWorker | null> {
    try {
      const existing = service.openingState(slug, guildId);
      if (existing) {
        // A settled opening waits only for the duel to start; a running one waits for the players.
        await driveOpening(slug, guildId);
        return games.get(slug)?.game ?? null;
      }
      const { session } = await assertStartable(slug, guildId);
      if (isReplayFork(session)) throw new RequestError("Replay forks use their own start and restart path", 409);
      // Automatic series starts may have no earlier lobby read. Warm during the
      // opening without waiting for file I/O or changing the opening deadline.
      warmLobbyResources(session);
      const dice = session.format === "ffa3" || session.format === "ffa4";
      const rps = options.openingRps && session.format === "1v1" && (session.gameNumber ?? 1) === 1;
      if (!dice && !rps) return await startGame(slug, guildId, actor);
      service.startOpening(slug, guildId, actor ?? session.organizerPlayerId, now());
      await driveOpening(slug, guildId);
      return games.get(slug)?.game ?? null;
    } catch (error) {
      recordDeckStartBlock(slug, error);
      throw error;
    }
  }

  /** Runs inside the duel queue. Starts a series game that sits in lobby with both seats ready. */
  async function startReadyGame(slug: string, guildId: string): Promise<boolean> {
    if (stopped) return false;
    const session = service.get(slug, guildId);
    if (isReplayFork(session) || session.status !== "lobby" || !session.seriesId || !allSeatsReady(session)) return false;
    await beginGame(slug, guildId, null);
    return true;
  }

  /**
   * Runs inside the duel queue after a deck or ready change: a series game with two ready seats starts at once.
   * A deck problem goes back to the caller; an engine failure is retried by the tick sweep.
   */
  async function autoStart(slug: string, guildId: string, session: DuelSession): Promise<DuelSession> {
    if (isReplayFork(session) || !session.seriesId || session.status !== "lobby" || !allSeatsReady(session)) return session;
    try {
      await beginGame(slug, guildId, null);
    } catch (error) {
      if (error instanceof DeckLegalityError) throw error;
      report(error, { tags: { operation: "[duel] could not start the series game yet" } });
      return session;
    }
    return service.get(slug, guildId);
  }

  /** Hash seat identity, readiness and decks, including changes made outside host operations. */
  function startDeckStateHash(state: { session: DuelSession; decks: DuelDeck[] }): string {
    return createHash("sha256").update(JSON.stringify({
      seats: state.session.seats.map(seat => [seat.seat, seat.playerId, seat.isBot, seat.ready]),
      decks: state.decks,
    })).digest("hex");
  }

  function recordDeckStartBlock(slug: string, error: unknown): void {
    // Reinsert refreshed blocks so the oldest failed attempt is first in eviction order.
    deckStartBlocks.delete(slug);
    if (error instanceof SeatDeckLegalityError) {
      deckStartBlocks.set(slug, { playerId: error.playerId, stateHash: error.startStateHash, blockedAt: now() });
      if (deckStartBlocks.size > DECK_START_BLOCK_MAX) deckStartBlocks.delete(deckStartBlocks.keys().next().value!);
    }
  }

  /** Records a failed start of a series game and logs it once. The tick sweep skips the slug for a growing wait. */
  function noteStartFailure(slug: string, error: unknown): void {
    const failures = (startBackoff.get(slug)?.failures ?? 0) + 1;
    const waitMs = START_BACKOFF_MS[Math.min(failures, START_BACKOFF_MS.length) - 1]!;
    startBackoff.set(slug, { failures, retryAt: now() + waitMs });
    recordDeckStartBlock(slug, error);
    log("warn", "[duel] Series game start deferred", { attempts: failures, retryMs: waitMs });
  }

  /**
   * Makes the next game of a due between-games series and starts it. Returns the new game's slug, or null
   * when the series is not due. Two calls for one series never overlap (queue key `series:<id>`).
   */
  async function advanceSeries(seriesId: number, guildId: string, at = now()): Promise<string | null> {
    const step = await enqueue(`series:${seriesId}`, async () => {
      if (stopped) return null;
      const info = series.get(seriesId, guildId);
      if (!isSeriesDue(info, at)) return null;
      const next = series.createNextGame(seriesId, guildId);
      clearAdvanceTimer(seriesId);
      return { previous: info.currentDuelSlug, next: next.slug, tournamentSlug: info.tournamentSlug };
    });
    if (!step) return null;
    if (step.previous) await emitChange(step.previous, guildId);
    try {
      await enqueue(step.next, () => startReadyGame(step.next, guildId));
    } catch (error) {
      // The game waits in lobby with both seats ready; the tick sweep starts it (after a backoff).
      noteStartFailure(step.next, error);
      await emitChange(step.next, guildId);
      if (error instanceof DeckLegalityError) throw error;
    } finally {
      if (step.tournamentSlug) await emitTournament("match-updated", step.tournamentSlug);
    }
    return step.next;
  }

  async function liveCancelTurn(slug: string): Promise<number | undefined> {
    const game = games.get(slug)?.game;
    if (!game?.running) return undefined;
    try { return (await withTimeout(game.view(null), debugReadTimeoutMs, "view spectator")).turn; }
    catch { return undefined; }
  }

  async function operate(body: Record<string, unknown>, ctl?: { abandoned: boolean; signal?: AbortSignal }): Promise<unknown> {
    ctl?.signal?.throwIfAborted();
    const { op, guildId, playerId } = body;
    if (typeof guildId !== "string" || !guildId || !Number.isSafeInteger(playerId) || (playerId as number) <= 0) {
      throw new RequestError("Authenticated guild and player are required", 400);
    }
    const actor = playerId as number;
    try {
      return await operateForActor(body, guildId, actor, ctl);
    } catch (error) {
      if (!(error instanceof SeatDeckLegalityError)) throw error;
      recordDeckStartBlock(error.slug, error);
      // A room read must still show the lobby after an opening's start attempt fails.
      if (op === "view") return project(body.slug as string, guildId, actor, undefined, body.spectate === true);
      if (error.playerId === actor) throw error.legalityError;
      // Deck details stay with their owner; return the actor's already-saved state.
      const slug = body.slug as string;
      const startBlocked = "Start blocked: another player's deck needs attention.";
      const session = service.get(slug, guildId);
      if (op === "series-ready") {
        const latest = series.get(session.seriesId!, guildId);
        return { series: latest,
          nextSlug: latest.status === "active" && latest.currentDuelSlug !== slug ? latest.currentDuelSlug : null,
          startBlocked };
      }
      if (op === "deck" || op === "ready") return { session, startBlocked };
      const room = await project(slug, guildId, actor, undefined, body.spectate === true);
      return room.startBlocked ? room : { ...room, startBlocked };
    }
  }

  async function operateForActor(body: Record<string, unknown>, guildId: string, actor: number, ctl?: { abandoned: boolean; signal?: AbortSignal }): Promise<unknown> {
    const { op } = body;
    const accessActor = { guildId, playerId: actor, ...(body.userId !== undefined ? { userId: body.userId as number } : {}) };
    if (op === "fork-list") return { forks: listActiveReplayForks(options.db, accessActor), limit: REPLAY_FORK_ACTIVE_LIMIT };
    if (op === "replay-fork") {
      if (body.unchecked === true && !resolveOwnerPlayer(options.db, accessActor)) {
        throw new RequestError("Unchecked replay fork requires owner access.", 403, "ACCESS_DENIED");
      }
      if (typeof body.slug !== "string" || !body.slug) throw new RequestError("Duel slug is required", 400, "INVALID_CURSOR");
      if (body.as !== undefined || body.reveal !== undefined) throw new RequestError("Invalid replay fork request", 400, "INVALID_CURSOR");
      const result = await forkLauncher.launch(body.slug, accessActor, { cursor: body.cursor, sourceVersion: body.sourceVersion,
        requestId: body.requestId, ...(body.unchecked !== undefined ? { unchecked: body.unchecked } : {}) } as import("@yugidraft/shared/duels").ReplayForkRequest, ctl?.signal);
      await emitChange(result.slug, guildId);
      assertReplayForkAccess(options.db, result.slug, accessActor);
      return result;
    }
    const target = typeof body.slug === "string" && body.slug ? assertDuelForkAccess(options.db, body.slug, accessActor) : null;
    if (body.reveal !== undefined && (op !== "view" || !target || !isReplayFork(target) || typeof body.reveal !== "boolean")) {
      if (op !== "owner-replay") throw new RequestError("Reveal is only available in replay fork views", 400);
    }
    if (body.as !== undefined) {
      if (!target || !isReplayFork(target) || !["view", "respond", "chain-mode", "cards", "surrender"].includes(String(op))) {
        throw new RequestError("Acting seats are only available in replay fork views and controls", 400);
      }
      try { resolveReplayForkSeat(service.get(target.slug, guildId), body.as); }
      catch { throw new RequestError("Invalid replay fork acting seat", 400); }
    }
    if (op === "fork-restart" || op === "fork-cancel") {
      if (typeof body.slug !== "string" || !body.slug) throw new ReplayAccessError();
      assertReplayForkAccess(options.db, body.slug, accessActor);
      if (op === "fork-restart") {
        const room = await forkLauncher.restart(body.slug, accessActor, ctl?.signal);
        await emitChange(body.slug, guildId);
        assertReplayForkAccess(options.db, body.slug, accessActor);
        return room;
      }
      const session = service.cancel(body.slug, guildId, actor, await liveCancelTurn(body.slug));
      await disposeGame(body.slug); await emitChange(body.slug, guildId);
      return { session };
    }
    if (op === "engine-data-status") {
      try {
        const local = localCardDataStatus();
        const github = await githubCardDataStatus(local.engine);
        return { ...local, ...github, generatedAt: new Date().toISOString() };
      } catch (error) {
        report(error, { tags: { operation: "[duel] engine-data-status" } });
        throw new RequestError("Card data status is unavailable", 503);
      }
    }
    if (op === "capabilities") {
      return { multiplayerTables: multiplayerTablesEnabled(), multiCoreReady: multiCoreAvailable(options.dataDirectory), multiDomainCoreReady: multiDomainCoreAvailable(options.dataDirectory) };
    }
    if (op === "list-presets") {
      requireScenarios();
      return {
        presets: PRESETS.map((preset) => summarizePreset(preset, options.dataDirectory, options.presetIssues?.(preset.id) ?? [])),
        core: multiCoreInfo(options.dataDirectory),
      };
    }
    if (op === "start-preset") {
      requireScenarios();
      return startPreset(body, guildId, actor);
    }
    if (op === "report" || op === "debug-trace") requireScenarios();
    if (op === "card-artworks") {
      if (!Array.isArray(body.codes) || body.codes.length !== 1
        || !Number.isSafeInteger(body.codes[0]) || body.codes[0] <= 0 || body.codes[0] > 0xffffffff) {
        throw new RequestError("Provide one positive card passcode", 400);
      }
      const family = cardArtworkFamily(loadCardDatabase(options.dataDirectory), body.codes[0]);
      if (!family) throw new RequestError("Card not found in the duel engine", 404);
      return family;
    }
    if (op === "card-details") {
      if (!Array.isArray(body.codes) || body.codes.length > 1000
        || body.codes.some((code) => !Number.isSafeInteger(code) || code <= 0 || code > 0xffffffff)) {
        throw new RequestError("Provide at most 1000 positive card passcodes", 400);
      }
      const catalog = loadCardDatabase(options.dataDirectory);
      const entries = cardRequestEntries(body, guildId, actor);
      const points = await genesysAdmissionPoints();
      const cards = [];
      const missing: number[] = [];
      for (const code of new Set<number>(body.codes)) {
        const card = catalog.deckCard(code);
        if (card) {
          const unavailableReason = deckCardUnavailableReason(catalog, code, entries);
          cards.push({ ...card, genesysPoints: points?.get(card.canonicalPasscode ?? card.code) ?? null, ...(unavailableReason ? { unavailableReason } : {}), altArtCount: (cardArtworkFamily(catalog, code)?.artworks.length ?? 1) - 1 });
        }
        else missing.push(code);
      }
      return { cards, missing };
    }
    if (op === "normalize-codes") {
      if (!Array.isArray(body.codes) || body.codes.length > 1000
        || body.codes.some((code) => !Number.isSafeInteger(code) || code <= 0 || code > 0xffffffff)) {
        throw new RequestError("Provide at most 1000 positive card ids", 400);
      }
      if (body.lookupLimit !== undefined && (!Number.isSafeInteger(body.lookupLimit) || Number(body.lookupLimit) < 0 || Number(body.lookupLimit) > CARD_LOOKUP_LIMIT)) {
        throw new RequestError(`Lookup limit must be between 0 and ${CARD_LOOKUP_LIMIT}`, 400);
      }
      const lookupBudget = body.lookupLimit === undefined && body.cacheOnly !== true ? undefined : createCardLookupBudget();
      if (lookupBudget) lookupBudget.remaining = body.cacheOnly === true ? 0 : Number(body.lookupLimit);
      const lookupLimitedCodes = new Set<number>();
      const canonicalCodes = body.includeCanonical === true ? new Map<number, number | null>() : undefined;
      const codes = await normalizeCardCodes(body.codes as number[], options.dataDirectory, options.db, {
        preserveArtwork: body.preserveArtwork === true, cacheOnly: body.cacheOnly === true,
        lookupBudget, lookupLimitedCodes, canonicalCodes,
      });
      return { codes: Object.fromEntries(codes),
        ...(canonicalCodes ? { canonicalCodes: Object.fromEntries(canonicalCodes) } : {}),
        ...(lookupBudget ? { lookupRemaining: lookupBudget.remaining, lookupLimited: [...lookupLimitedCodes] } : {}),
      };
    }
    if (op === "deck-suggestions") {
      if (!deckSuggestionsEnabled()) throw new RequestError("Deck suggestions are disabled", 404);
      const player = options.db.prepare<[number, string], { user_id: number }>(`
        SELECT p.user_id FROM players p JOIN users u ON u.id=p.user_id WHERE p.id=? AND p.guild_id=?
      `).get(actor, guildId);
      if (!player || (body.userId !== undefined && (!Number.isSafeInteger(body.userId) || body.userId !== player.user_id))) {
        throw new RequestError("Authenticated guild player is required", 403);
      }
      const query = parseDeckSuggestionQuery(body.suggestionQuery);
      if (!query) throw new RequestError("Invalid deck suggestion query", 400);
      if (body.suggestionVersion !== undefined && (typeof body.suggestionVersion !== "string" || !/^[a-f0-9]{64}$/i.test(body.suggestionVersion))) {
        throw new RequestError("Suggestion version must be a SHA-256 digest", 400);
      }
      // Reject before normalizing cards or preparing a catalog-wide legality scope.
      if (suggestingPlayers.has(actor) || suggestingPlayers.size >= 2) {
        throw new RequestError("Deck suggestions are busy. Try again shortly.", 429);
      }
      suggestingPlayers.add(actor);
      try {
        const mode = query.format.endsWith("domain") ? "domain" : "normal";
        const settings = normalizeDuelSettings(mode, { ...(query.banlist === undefined ? {} : { banlist: query.banlist }),
          ...(query.format.startsWith("genesys") ? { genesys: {} } : {}) });
        const rawMaster = query.deckMaster ?? query.deck?.deckMaster;
        const master = rawMaster === undefined ? undefined
          : (await normalizeCardCodes([rawMaster], options.dataDirectory, options.db, { cacheOnly: true })).get(rawMaster) ?? rawMaster;
        const legality = deckSuggestionScope(mode, options.dataDirectory, settings, { deckMaster: master, cardBlocks: admissionEntries(mode, "1v1") });
        const revision = (options.db.prepare("SELECT revision FROM card_catalog_revision WHERE id=1").get() as { revision: number }).revision;
        const pointsRevision = (options.db.prepare("SELECT revision FROM genesys_points_meta WHERE id=1").get() as { revision: string } | undefined)?.revision;
        const contextVersion = createHash("sha256").update(JSON.stringify([
          "deck-suggestions-host-v3", suggestionQueryIdentity(query), legality.version, revision, pointsRevision ?? null, new Date().toISOString().slice(0, 7),
        ])).digest("hex");
        if (typeof body.suggestionVersion === "string" && body.suggestionVersion.toLowerCase() === contextVersion) {
          return { contextVersion, notModified: true };
        }
        const result = await suggestionWorkers.run({ query, legality, deckMaster: master });
        return { contextVersion, result };
      } finally { suggestingPlayers.delete(actor); }
    }
    if (op === "suggestion-scope") {
      if (typeof body.suggestionFormat !== "string" || !["normal", "domain", "genesys", "genesys-domain"].includes(body.suggestionFormat)) {
        throw new RequestError("Unknown suggestion format", 400);
      }
      if (body.banlist !== undefined && !DUEL_BANLIST_OPTIONS.some(option => option.id === body.banlist)) {
        throw new RequestError("banlist must be a known versioned id", 400);
      }
      if (body.deckMaster !== undefined && (!Number.isSafeInteger(body.deckMaster) || Number(body.deckMaster) <= 0 || Number(body.deckMaster) > 0xffffffff)) {
        throw new RequestError("Deck Master must be a positive card passcode", 400);
      }
      const mode = body.suggestionFormat === "domain" || body.suggestionFormat === "genesys-domain" ? "domain" : "normal";
      const genesys = body.suggestionFormat === "genesys" || body.suggestionFormat === "genesys-domain";
      const settings = normalizeDuelSettings(mode, { ...(body.banlist !== undefined ? { banlist: body.banlist } : {}), ...(genesys ? { genesys: {} } : {}) });
      const master = body.deckMaster === undefined ? undefined
        : (await normalizeCardCodes([body.deckMaster as number], options.dataDirectory, options.db, { cacheOnly: true })).get(body.deckMaster as number) ?? body.deckMaster as number;
      return deckSuggestionScope(mode, options.dataDirectory, settings, { deckMaster: master, cardBlocks: admissionEntries(mode, "1v1") });
    }
    if (op === "validate-deck-master") {
      if (body.mode !== "normal" && body.mode !== "domain") throw new RequestError("Duel mode must be normal or domain", 400);
      await validateDeckMasterWrite(body.mode, body.deck as DuelDeck);
      return { ok: true };
    }
    if (op === "check-deck") {
      const mode = body.mode;
      if (mode !== "normal" && mode !== "domain") throw new RequestError("Duel mode must be normal or domain", 400);
      if (body.masterRule !== undefined && ![1, 2, 3, 4, 5].includes(body.masterRule as number)) {
        throw new RequestError("Unknown master rule", 400);
      }
      const format = body.format === "tag" || body.format === "ffa3" || body.format === "ffa4" ? body.format : "1v1";
      let settings: DuelSettings;
      try { settings = normalizeDuelSettings(mode, body.settings, format); }
      catch (error) {
        if (error instanceof DuelSettingsError) throw new RequestError(error.message, 400);
        throw error;
      }
      const deck = await normalizeImportedDeck(body.deck as DuelDeck, options.dataDirectory, options.db, { keepUnresolved: true });
      let draftPool: InspectDeckOptions["draftPool"];
      if (body.draftId !== undefined && body.draftId !== null) {
        if (!Number.isSafeInteger(body.draftId) || (body.draftId as number) < 1 || mode !== "normal") throw new RequestError("Invalid draft deck context", 400);
        draftPool = await loadDraftDeckPool({ draftId: body.draftId as number, playerId: actor, guildId, dataDirectory: options.dataDirectory, db: options.db });
      }
      return { deck, report: inspectDeck(mode, deck, options.dataDirectory, settings, {
        table: format, draftPool, cardBlocks: admissionEntries(mode, format), genesysPoints: await genesysAdmissionPoints(settings),
      }) };
    }
    if (op === "card-query") {
      try {
        const catalog = loadCardDatabase(options.dataDirectory);
        const enabled = effectSearchEnabled();
        const query = parseCardQuery(body.cardQuery);
        const effects = enabled ? cardEffectIndex(catalog) ?? await initializeCardEffectIndex(options.db, catalog) : undefined;
        const releases = !enabled && (query.released || query.sort === "newest") ? cardReleaseIndex(options.db) : undefined;
        const entries = cardRequestEntries(body, guildId, actor), points = await genesysAdmissionPoints();
        const search = () => queryCards(catalog, query, entries, points, { effects, releases, effectSearchEnabled: enabled });
        let result = search();
        if (enabled && !query.exact && query.scope !== "name" && query.text.trim() && query.passcodes?.length !== 0 && !query.effectOmit?.length && !result.total) {
          const { lowConfidenceReading } = await import("@yugidraft/shared/cards/effects");
          if (!result.effectTotal || lowConfidenceReading(query.text, result.reading ?? null)) {
            const { fallbackEffectReading } = await import("@yugidraft/shared/cards/effects/reading-fallback");
            const user = options.db.prepare<[number], { user_id: number }>("SELECT user_id FROM players WHERE id=?").get(actor);
            if (user && await fallbackEffectReading(options.db, query.text, user.user_id)) result = search();
          }
        }
        // "How it plays" for an archetype reading; later pages do not repeat it.
        const profile = enabled && result.reading && query.offset === 0 && (query.effectOffset ?? 0) === 0 ? readArchetypeGuide(options.db, readingArchetypes(result.reading)) : null;
        return profile ? { ...result, profile } : result;
      } catch (error) {
        if (error instanceof CardQueryError) throw new RequestError(error.message, 400);
        throw error;
      }
    }
    if (op === "card-facets") return cardFacets(loadCardDatabase(options.dataDirectory));
    if (op === "cards") {
      if (typeof body.query !== "string" || body.query.length > 200) throw new RequestError("Invalid card search", 400);
      if (typeof body.slug === "string" && body.slug) {
        const room = service.room(body.slug, guildId, actor);
        if (room.mySeat === null) throw new RequestError("Join this duel before searching its choices", 403);
        if (room.session.status !== "active") throw new RequestError("This duel is not active", 409);
        const game = await recover(body.slug, guildId);
        await settleClock(body.slug, guildId, game);
        if (service.get(body.slug, guildId).status !== "active") throw new RequestError("This duel is not active", 409);
        const live = games.get(body.slug)?.game ?? game;
        let seat = room.mySeat;
        if (isReplayFork(room.session)) {
          try { seat = resolveReplayForkSeat(room.session, body.as); }
          catch { throw new RequestError("Invalid replay fork acting seat", 400); }
        }
        const view = await live.view(seat);
        if (isReplayFork(room.session) && (body.promptId !== view.prompt?.id || body.revision !== view.revision)) {
          throw new RequestError("That search is stale. Refresh the current duel state.", 409);
        }
        if (view.prompt?.kind !== "announce-card") throw new RequestError("No card announcement is waiting", 409);
        const cards = await live.search(body.query, seat);
        assertDuelForkAccess(options.db, body.slug, accessActor);
        return { cards: await withGenesysPoints(cards) };
      }
      return { cards: await withGenesysPoints(options.searchCards(body.query)) };
    }
    if (typeof body.slug !== "string" || !body.slug || body.slug.length > 128) throw new RequestError("Duel slug is required", 400);
    const slug = body.slug;
    if (op === "replay" || op === "owner-replay") return replayRequest(body, slug, guildId, actor, ctl?.signal);
    let room = service.room(slug, guildId, actor, { includeStoredBoard: false });
    if (competitive(room.session) && await settleRankedDeadline(slug, guildId)) {
      room = service.room(slug, guildId, actor, { includeStoredBoard: false });
    }
    if (isReplayFork(room.session) && ["start", "ready", "unready", "deck", "validate-deck", "add-bot", "opening-pick", "opening-choose",
      "series-first", "series-side", "series-ready", "series-unready"].includes(String(op))) {
      throw new RequestError("Replay forks cannot use normal lobby or series operations", 409);
    }
    if (room.session.seriesId && !isReplayFork(room.session)) {
      repairDeckCopies().series(room.session.seriesId);
      room = service.room(slug, guildId, actor, { includeStoredBoard: false });
    }
    if (op === "view") {
      // A timeout that no timer caught yet (a restart, a late timer) is applied here.
      if (room.session.status === "lobby" && room.opening) {
        const deadline = Date.parse(room.opening.deadlineAt);
        const botAt = room.opening.phase === "choose" ? botChoiceAt(room.opening.winnerSeat, deadline, room.session.seats) : null;
        if (deadline <= now() || (botAt !== null && botAt <= now())) await driveOpening(slug, guildId);
      }
      if (service.get(slug, guildId).status === "active") {
        const game = await recover(slug, guildId);
        await settleClock(slug, guildId, game);
        return project(slug, guildId, actor, games.get(slug)?.game, body.spectate === true, { as: body.as, reveal: body.reveal as boolean | undefined });
      }
      return project(slug, guildId, actor, games.get(slug)?.game, body.spectate === true, { as: body.as, reveal: body.reveal as boolean | undefined });
    }
    if (op === "add-bot") {
      if (actor !== room.session.organizerPlayerId) throw new RequestError("Only the organizer can add a practice bot", 403);
      if (room.session.status !== "lobby") throw new RequestError("A practice bot can only be added before the duel starts", 409);
      const blocked = multiplayerSeatsBlockReason(seatCountFor(room.session.format), multiplayerTablesEnabled());
      if (blocked) throw new RequestError(blocked, 403);
      const settings = room.session.settings;
      const deck = buildPracticeBotDeck(room.session.mode, options.dataDirectory);
      await validateSessionDeck(room.session.mode, deck, settings, room.session.format);
      let botSeat: number | undefined;
      if (body.seat !== undefined && body.seat !== null) {
        if (!Number.isSafeInteger(body.seat)) throw new RequestError("Bot seat must be a whole number", 400);
        botSeat = body.seat as number;
      }
      const session = service.addPracticeBot(slug, guildId, actor, deck, botSeat);
      await emitChange(slug, guildId);
      return { session };
    }
    if (op === "archive") {
      service.archive(slug, guildId, actor);
      clearOpeningTimer(slug);
      await disposeGame(slug);
      await emitChange(slug, guildId);
      return project(slug, guildId, actor);
    }
    if (op === "cancel") {
      service.cancel(slug, guildId, actor, await liveCancelTurn(slug));
      clearOpeningTimer(slug);
      await disposeGame(slug);
      await emitChange(slug, guildId);
      return project(slug, guildId, actor);
    }
    if (op === "report") return writeReport(slug, guildId, actor, body.note, ctl);
    if (op === "debug-trace") return debugTrace(slug, guildId, actor);
    if (op === "bug-context") return bugContext(slug, guildId, actor);
    if (op === "bug-replay-frame") {
      assertOwnerReplaySourceAccess(options.db, slug, { guildId, playerId: actor, userId: body.userId as number });
      if (!Number.isSafeInteger(body.reportId)) throw new RequestError("Invalid report", 400);
      const report = createBugReportService(options.db).get(body.reportId as number, guildId);
      const moment = (report.diagnostics as { moment?: Record<string, unknown> } | null)?.moment;
      const state = service.privateState(slug, guildId);
      if (report.duelSlug !== slug || !moment || moment.duelId !== state.session.id || moment.bundleVersion !== state.bundleVersion) throw new RequestError("Report moment is unavailable", 409);
      const source = journalSourceOf(state), count = moment.journalCount as number;
      if (!Number.isSafeInteger(count) || count < 0 || count > source.commands.length
        || replayPrefixHash(source, count) !== moment.prefixHash
        || (source.commands[count - 1]?.storedSeq ?? 0) !== moment.journalSeq) {
        throw new RequestError("The report journal changed", 409, "SOURCE_CHANGED");
      }
      const result = await replayRequest({ op: "owner-replay", userId: body.userId, version: 2, visibility: "public" }, slug, guildId, actor, ctl?.signal);
      const replay = result.replay as DuelReplayV2;
      const frames = replay.forkSteps ?? replay.frames;
      const savedBoard = (report.diagnostics as { board?: DuelEngineView } | null)?.board;
      const finalFrame = replay.frames.find(frame => frame.kind === "result" && frame.view.revision === moment.revision);
      const frame = (savedBoard?.result || moment.result) ? finalFrame : frames.find(frame => {
        if (!frame.cursor) return false;
        const checkpoint = replayCursorCodec.open(frame.cursor);
        return checkpoint.revision === moment.revision && checkpoint.prefixCount <= count
          && !source.commands.slice(checkpoint.prefixCount, count).some(entry => chainModeOf(entry.command.promptId) === null);
      });
      if (!frame) throw new RequestError("The report has no playable replay checkpoint", 409, "NOT_PLAYABLE");
      const rebuilt = replay.frames.find(entry => entry.frameId === frame.frameId);
      if (savedBoard && rebuilt && !sameReplayBoard(savedBoard, rebuilt.view)) {
        throw new RequestError("The replay does not match the saved report board", 409, "REPLAY_MISMATCH");
      }
      return { href: `/duels/${encodeURIComponent(slug)}/replay?frame=${encodeURIComponent(frame.frameId)}`, frameId: frame.frameId };
    }
    if (op === "series-side" || op === "series-ready" || op === "series-unready" || op === "series-first") {
      const seriesId = room.session.seriesId ?? null;
      if (seriesId === null) throw new RequestError("This duel is not part of a series", 409);
      const info = series.get(seriesId, guildId);
      if (!info.playerIds.includes(actor)) throw new RequestError("Only the players of this series can do that", 403);
      if (op === "series-side") {
        if (info.status !== "between_games") throw new RequestError("Side decking is only open between games", 409);
        await validateDeckMasterWrite(room.session.mode, body.deck as DuelDeck);
        // Like check-deck, unresolved ids stay as sent so validateSessionDeck can report them.
        const deck = await normalizeImportedDeck(body.deck as DuelDeck, options.dataDirectory, options.db, { keepUnresolved: true });
        await validateSessionDeck(room.session.mode, deck, room.session.settings, room.session.format, { session: room.session, playerId: actor });
        // `info` is read before the await above, so a Ready sent meanwhile (through another game slug)
        // is not in it: the transaction reports whether this save cleared Ready.
        const saved = series.saveSideDeck(seriesId, guildId, actor, deck,
          (code) => canonicalEngineCardCode(code, options.dataDirectory));
        // A changed deck clears this player's Ready: refresh both players' views so the room shows it.
        if (saved.readyCleared) await emitChange(saved.series.currentDuelSlug ?? slug, guildId);
        return { series: saved.series };
      }
      if (op === "series-first") {
        if (!isFirstChoice(body.choice)) throw new RequestError("Choose first or second", 400);
        if (info.status !== "between_games") throw new RequestError("The series is not between games", 409);
        const updated = series.setFirstChoice(seriesId, guildId, actor, body.choice);
        await emitChange(updated.currentDuelSlug ?? slug, guildId);
        // A turn choice only records the choice. Ready and the deadline own advancement.
        return { series: updated, nextSlug: null };
      }
      if (info.status !== "between_games") {
        // The next game may already exist (the timer or the other player was first): point the client at it.
        if (info.status === "active" && info.currentDuelSlug && info.currentDuelSlug !== slug) {
          return { series: info, nextSlug: info.currentDuelSlug };
        }
        throw new RequestError("The series is not between games", 409);
      }
      if (op === "series-unready") {
        // The player started editing their side deck: take Ready back at once, before anything is saved,
        // so the opponent's Ready cannot start the next game on a deck they are still changing.
        const cleared = series.clearSideReady(seriesId, guildId, actor);
        if (cleared.readyCleared) await emitChange(cleared.series.currentDuelSlug ?? slug, guildId);
        return { series: cleared.series, nextSlug: null };
      }
      const sideDeck = series.sideState(seriesId, guildId, actor).currentDeck;
      validateExtraDeckTypes(sideDeck, options.dataDirectory, findDeckType);
      if (room.session.mode === "domain") {
        await validateDeckMasterWrite(room.session.mode, sideDeck);
      }
      const updated = series.setSideReady(seriesId, guildId, actor);
      await emitChange(updated.currentDuelSlug ?? slug, guildId);
      const advanced = isSeriesDue(updated, now()) ? await advanceSeries(seriesId, guildId) : null;
      const latest = series.get(seriesId, guildId);
      const nextSlug = advanced
        ?? (latest.status === "active" && latest.currentDuelSlug !== slug ? latest.currentDuelSlug : null);
      return { series: latest, nextSlug };
    }
    if (room.mySeat === null) throw new RequestError("Join this duel first", 403);
    let seat = room.mySeat;
    if (isReplayFork(room.session)) {
      try { seat = resolveReplayForkSeat(room.session, body.as); }
      catch { throw new RequestError("Invalid replay fork acting seat", 400); }
    }
    if (op === "ready") {
      if (room.session.status !== "lobby") throw new RequestError("Decks are locked after the duel starts", 409);
      if (room.myDeck) {
        validateExtraDeckTypes(room.myDeck, options.dataDirectory, findDeckType);
        await validateDeckMasterWrite(room.session.mode, room.myDeck);
      }
      const session = service.markReady(slug, guildId, actor);
      await emitChange(slug, guildId);
      return { session: await autoStart(slug, guildId, session) };
    }
    if (op === "unready") {
      const session = service.markUnready(slug, guildId, actor);
      await emitChange(slug, guildId);
      return { session };
    }
    if (op === "deck" || op === "validate-deck") {
      if (room.session.status !== "lobby") throw new RequestError("Decks are locked after the duel starts", 409);
      if (op === "deck" && room.session.seriesId) {
        const info = room.series ?? series.get(room.session.seriesId, guildId);
        if (info.tournamentId !== null) throw new RequestError("Tournament games use your registered deck", 409);
        if ((room.session.gameNumber ?? 1) > 1) {
          throw new RequestError("Later games of a match use your deck from the last game. Change it in the side deck window.", 409);
        }
      }
      const settings = room.session.settings;
      if (op === "deck") {
        await validateDeckMasterWrite(room.session.mode, body.deck as DuelDeck);
      }
      const deck = await normalizeImportedDeck(body.deck as DuelDeck, options.dataDirectory, options.db, {
        // Unresolved codes remain visible to validation, including the stable Extra error.
        keepUnresolved: true,
      });
      if (op === "validate-deck") {
        return inspectDeck(room.session.mode, deck, options.dataDirectory, settings, await sessionDeckOptions(room.session, actor, deck));
      }
      await validateSessionDeck(room.session.mode, deck, settings, room.session.format, { session: room.session, playerId: actor });
      const session = service.setDeck(slug, guildId, actor, deck);
      await emitChange(slug, guildId);
      return { session: await autoStart(slug, guildId, session) };
    }
    if (op === "start") {
      // A series game has no single organizer: any seated player may start it once both seats are ready.
      if (!room.session.seriesId && actor !== room.session.organizerPlayerId) {
        throw new RequestError("Only the organizer can start", 403);
      }
      const game = await beginGame(slug, guildId, actor);
      return await project(slug, guildId, actor, game ?? undefined);
    }
    if (op === "opening-pick" || op === "opening-choose") {
      if (room.session.status !== "lobby") throw new RequestError("The duel is not in its opening", 409);
      if (op === "opening-pick") {
        if (!isRpsMove(body.move)) throw new RequestError("Pick rock, paper or scissors", 400);
        service.submitOpeningPick(slug, guildId, seat, body.move, now());
      } else {
        if (!isFirstChoice(body.choice)) throw new RequestError("Choose to go first or second", 400);
        service.submitOpeningChoice(slug, guildId, seat, body.choice, now());
      }
      await driveOpening(slug, guildId);
      const game = games.get(slug)?.game;
      return await project(slug, guildId, actor, game);
    }
    if (room.session.status !== "active") throw new RequestError("This duel is not active", 409);
    if (op === "chain-mode") return setChainMode(slug, guildId, actor, seat, body.mode, { revision: body.revision, promptId: body.promptId });
    if (op === "surrender") {
      const game = await recover(slug, guildId);
      await settleClock(slug, guildId, game);
      const current = await project(slug, guildId, actor, games.get(slug)?.game);
      if (current.session.status !== "active") return current;
      await forfeitSeat(slug, guildId, games.get(slug)?.game ?? game, seat, "Surrender");
      return project(slug, guildId, actor, games.get(slug)?.game, false, isReplayFork(room.session) ? { as: seat } : {});
    }
    if (op !== "respond") throw new RequestError("Unknown duel operation", 400);
    const command = body.command as DuelCommand | undefined;
    if (!command || typeof command.promptId !== "string" || !Number.isSafeInteger(command.revision)) {
      throw new RequestError("Invalid engine command", 400);
    }
    const game = await recover(slug, guildId);
    if (service.get(slug, guildId).status !== "active") return project(slug, guildId, actor);
    const live = games.get(slug)?.game ?? game;
    if (!isReplayFork(service.get(slug, guildId)) && games.get(slug)?.surrendered.has(seat)) throw new RequestError("You surrendered this duel", 409);
    const before: DuelEngineView = await live.view(seat);
    if (before.revision !== command.revision || before.prompt?.id !== command.promptId) {
      await settleClock(slug, guildId, live);
      if (service.get(slug, guildId).status !== "active") return project(slug, guildId, actor);
      throw new RequestError("That choice is stale. Refresh the current duel state.", 409);
    }
    validateAnswer(before.prompt!, command.answer);
    const decidedAt = now();
    await settleClock(slug, guildId, live, decidedAt);
    if (service.get(slug, guildId).status !== "active") {
      return project(slug, guildId, actor);
    }
    try {
      await live.answer(seat, command.promptId, command.answer);
    } catch (error) {
      if (await interruptEngineLoop(slug, guildId, error)) return project(slug, guildId, actor);
      // A fatal error may have advanced the core before any command could be journaled.
      if (!(error instanceof EngineAnswerError)) await disposeGame(slug);
      if (error instanceof EngineAnswerError) throw new RequestError(error.message, 400, error.code);
      throw error;
    }
    try {
      await persistAcceptedCommand(slug, guildId, seat, command, live, decidedAt, newestEventId(before));
      await emitChange(slug, guildId);
      await driveBot(slug, guildId, live);
      return await project(slug, guildId, actor, live, false, isReplayFork(service.get(slug, guildId)) ? { as: seat } : {});
    } catch (error) {
      await disposeGame(slug);
      throw error;
    }
  }

  /**
   * A seat's chain response switch (Auto, Always, Off). Private and live: it changes only what the core asks THIS seat.
   * Every change that alters the mode is journaled (`chain-mode:<mode>`, the revision before) so that a recover and a
   * replay re-apply it at the same point. A change that passes no window leaves the duel as it was: no revision bump, no
   * clock change, no push to the other viewers. One that passes the open window moves the duel on like an answer.
   * The journal takes `CHAIN_MODE_JOURNAL_LIMIT` changes per duel; after that every change is refused, because a change
   * that was applied but not journaled would break the replay.
   */
  async function setChainMode(slug: string, guildId: string, actor: number, seat: number, requested: unknown, binding: { revision?: unknown; promptId?: unknown } = {}): Promise<unknown> {
    if (!isDuelChainMode(requested)) throw new RequestError("Choose Auto, Always or Off", 400);
    const mode = requested;
    const game = await recover(slug, guildId);
    await settleClock(slug, guildId, game);
    if (service.get(slug, guildId).status !== "active") return project(slug, guildId, actor);
    const entry = games.get(slug);
    const live = entry?.game ?? game;
    if (!isReplayFork(service.get(slug, guildId)) && entry?.surrendered.has(seat)) throw new RequestError("You surrendered this duel", 409);
    if (entry?.presetId) throw new RequestError("Scenario tables have no response switch", 409);
    if (typeof live.setChainMode !== "function") throw new RequestError("This duel engine has no chain response switch", 409);
    // Settle the clock again at the moment the switch is decided (like respond does), before the view that decides
    // anything: a switch must never pass a window of a seat whose time has run out, and a forfeit that settling causes
    // may put the seat out, so eligibility is read after it.
    const decidedAt = now();
    await settleClock(slug, guildId, live, decidedAt);
    if (service.get(slug, guildId).status !== "active") return project(slug, guildId, actor);
    if (!isReplayFork(service.get(slug, guildId)) && games.get(slug)?.surrendered.has(seat)) throw new RequestError("You surrendered this duel", 409);
    const before: DuelEngineView = await live.view(seat);
    if (isReplayFork(service.get(slug, guildId))) {
      if (!Number.isSafeInteger(binding.revision) || (binding.revision as number) < 0) throw new RequestError("Fork response changes require a revision", 400);
      if (binding.revision !== before.revision || (binding.promptId !== undefined && binding.promptId !== before.prompt?.id)) {
        throw new RequestError("That response change is stale. Refresh the current duel state.", 409);
      }
    }
    if (before.result) return project(slug, guildId, actor, live, false, isReplayFork(service.get(slug, guildId)) ? { as: seat } : {});
    if (before.seats?.some((state) => state.seat === seat && (state.eliminated || (!isReplayFork(service.get(slug, guildId)) && state.pendingElimination)))) {
      throw new RequestError("You are out of this duel", 409);
    }
    // The same mode again changes nothing and is not worth a journal line.
    if (before.chainMode === mode) return project(slug, guildId, actor, live, false, isReplayFork(service.get(slug, guildId)) ? { as: seat } : {});
    const state = service.privateState(slug, guildId);
    const used = state.commands.slice(isReplayFork(state.session) ? state.setup!.replayFork!.origin.prefixCount : 0).reduce((count, input) => count + (chainModeOf(input.command.promptId) === null ? 0 : 1), 0);
    if (used >= CHAIN_MODE_JOURNAL_LIMIT) {
      throw new RequestError(`This duel has reached its limit of ${CHAIN_MODE_JOURNAL_LIMIT} response switch changes. The switch stays where it is.`, 409);
    }
    let passed: boolean;
    try {
      passed = await live.setChainMode(seat, mode);
    } catch (error) {
      if (await interruptEngineLoop(slug, guildId, error)) return project(slug, guildId, actor);
      // The engine sets the mode before it passes the window, so a throw can leave the mode (or the core) changed with
      // nothing journaled. Drop the worker whatever the cause; the next request rebuilds the duel from the journal.
      const stillRunning = live.running;
      await disposeGame(slug);
      if (error instanceof EngineAnswerError) throw new RequestError(error.message, stillRunning ? 409 : 503, error.code);
      throw error;
    }
    const command: DuelCommand = { promptId: `${CHAIN_MODE_PROMPT_PREFIX}${mode}`, revision: before.revision, answer: {} };
    try {
      if (passed) {
        await persistAcceptedCommand(slug, guildId, seat, command, live, decidedAt, newestEventId(before));
      } else {
        // The clock is not touched: the stored clock goes back in as it is.
        // A player's explicit switch change renews idle time even when it passes no response window.
        service.recordCommand(slug, guildId, seat, command, state.clock);
      }
    } catch (error) {
      // Applied but not journaled: drop the worker so the next request rebuilds the duel from the journal.
      await disposeGame(slug);
      throw error;
    }
    if (!passed) return project(slug, guildId, actor, live, false, isReplayFork(service.get(slug, guildId)) ? { as: seat } : {});
    try {
      await emitChange(slug, guildId);
      await driveBot(slug, guildId, live);
      return await project(slug, guildId, actor, live, false, isReplayFork(service.get(slug, guildId)) ? { as: seat } : {});
    } catch (error) {
      await disposeGame(slug);
      throw error;
    }
  }

  function enqueue<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = queues.get(key) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(work);
    queues.set(key, run);
    return run.finally(() => {
      if (queues.get(key) === run) queues.delete(key);
    });
  }

  async function tick(): Promise<void> {
    if (stopped) return;
    const t = now();
    try {
      service.recordHostHeartbeat(t);
    } catch (error) {
      report(error, { tags: { operation: "[duel] heartbeat failed" } });
    }
    // Every table has an idle backstop. Proven competitive timeouts settle first, without engine recovery.
    try {
      for (const item of service.dueIdleDuels(t, ARCHIVE_SWEEP_LIMIT)) {
        if (stopped) return;
        try {
          await enqueue(item.slug, async () => {
            if (stopped) return;
            try {
              if (await settleRankedDeadline(item.slug, item.guildId)) return;
            } catch (error) {
              report(error, { tags: { operation: "[duel] idle deadline settlement failed" } });
            }
            let snapshots: DuelFinalSnapshots | undefined;
            const entry = games.get(item.slug);
            if (entry?.game.running) {
              try {
                snapshots = await captureSnapshots(entry.game, service.get(item.slug, item.guildId).format, null, DUEL_LIVE_IDLE_REASON);
              } catch (error) {
                // A failed final view must not keep an abandoned table active. Its journal is retained.
                report(error, { tags: { operation: "[duel] idle final snapshot failed" } });
              }
            }
            const session = service.interruptIdle(item.slug, item.guildId, now(), snapshots);
            if (!session) return;
            await disposeGame(item.slug);
            await emitChange(item.slug, item.guildId);
            await afterGameEnded(item.slug, item.guildId);
          });
        } catch (error) {
          report(error, { tags: { operation: "[duel] live idle sweep failed" } });
        }
      }
    } catch (error) {
      report(error, { tags: { operation: "[duel] live idle sweep failed" } });
    }
    try {
      // Casual lobbies have no backoff entry and may never be read again after a blocked start.
      for (const [slug, entry] of deckStartBlocks) {
        if (t - entry.blockedAt >= DECK_START_BLOCK_TTL_MS || deckBlockSession.get(slug)?.status !== "lobby") {
          deckStartBlocks.delete(slug);
        }
      }
    } catch (error) {
      report(error, { tags: { operation: "[duel] deck start block sweep" } });
    }
    try {
      const due = service.dueClocks(t, CLOCK_SWEEP_LIMIT);
      for (const item of due) {
        if (stopped) return;
        try {
          await enqueue(item.slug, async () => {
            if (stopped) return;
            await settleClock(item.slug, item.guildId);
          });
        } catch (error) {
          report(error, { tags: { operation: "[duel] clock sweep failed" } });
        }
      }
    } catch (error) {
      report(error, { tags: { operation: "[duel] clock sweep failed" } });
    }
    if (stopped) return;
    try {
      // Timed-out openings, settled openings whose duel has not started yet, and a timer for those still running.
      // A bot choice is due before the human deadline, including just after a restart.
      const openingHorizon = Math.max(pollIntervalMs, DUEL_OPENING_PICK_MS + DUEL_OPENING_REVEAL_MS);
      for (const due of service.dueOpenings(t + openingHorizon, SERIES_SWEEP_LIMIT)) {
        if (stopped) return;
        const state = service.openingState(due.slug, due.guildId);
        if (!state) continue;
        if (state.deadline > t) {
          if (!openingTimers.has(due.slug)) scheduleOpening(due.slug, due.guildId, state);
          continue;
        }
        if ((startBackoff.get(due.slug)?.retryAt ?? 0) > t) continue;
        try {
          await enqueue(due.slug, () => driveOpening(due.slug, due.guildId));
        } catch (error) {
          report(error, { tags: { operation: "[duel] opening sweep failed" } });
        }
      }
    } catch (error) {
      report(error, { tags: { operation: "[duel] opening sweep failed" } });
    }
    if (stopped) return;
    try {
      // Windows that end before the next sweep get a timer too: after a restart nothing else has one, and the
      // series would start up to a full sweep interval late.
      for (const due of series.dueNextGames(t + pollIntervalMs, SERIES_SWEEP_LIMIT)) {
        if (stopped) return;
        try {
          const info = series.get(due.seriesId, due.guildId);
          if (!isSeriesDue(info, t)) {
            if (!advanceTimers.has(due.seriesId)) scheduleAdvance(info, due.guildId);
            continue;
          }
          await advanceSeries(due.seriesId, due.guildId, t);
        } catch (error) {
          report(error, { tags: { operation: "[duel] series advance sweep failed" } });
        }
      }
      // An entry no sweep touched for a full backoff cap belongs to a game that is gone.
      const cap = START_BACKOFF_MS[START_BACKOFF_MS.length - 1]!;
      for (const [slug, entry] of startBackoff) {
        if (t - entry.retryAt > cap) {
          startBackoff.delete(slug);
          deckStartBlocks.delete(slug);
        }
      }
      // Ask for extra rows so games that wait out a backoff do not crowd out others.
      let attempts = 0;
      for (const due of series.dueStarts(SERIES_SWEEP_LIMIT + startBackoff.size)) {
        if (stopped) return;
        if ((startBackoff.get(due.slug)?.retryAt ?? 0) > t) continue;
        if (attempts++ >= SERIES_SWEEP_LIMIT) break;
        try {
          await enqueue(due.slug, () => startReadyGame(due.slug, due.guildId));
          startBackoff.delete(due.slug);
        } catch (error) {
          noteStartFailure(due.slug, error);
          // Players watching the room refetch it; the duel is still in lobby.
          await emitChange(due.slug, due.guildId);
        }
      }
    } catch (error) {
      report(error, { tags: { operation: "[duel] series sweep failed" } });
    }
    if (stopped) return;
    for (const [slug, entry] of [...games]) {
      if (stopped) return;
      if (queues.has(slug)) continue;
      if (t - entry.lastRequestAt < idleWorkerMs) continue;
      games.delete(slug);
      reportCaptures.delete(slug);
      cancelBotLoop(slug);
      await safeClose(entry.game);
    }
    if (stopped) return;
    try {
      const expired = service.expireWaitingTables(t, ARCHIVE_SWEEP_LIMIT);
      for (const session of expired) await emitChange(session.slug, session.guildId);
      const archived = service.archiveDue(ARCHIVE_SWEEP_LIMIT, archiveAfterMs);
      for (const session of archived) {
        await emitChange(session.slug, session.guildId);
      }
    } catch (error) {
      report(error, { tags: { operation: "[duel] archive sweep failed" } });
    }
  }

  service.resumeCompetitiveClocks(now());
  const timer = setInterval(() => {
    void tick();
  }, pollIntervalMs);
  timer.unref();
  void tick();
  const stallTimer = stallMs > 0 ? setInterval(() => void checkStalls(), Math.max(10, Math.min(5000, Math.floor(stallMs / 4)))) : null;
  stallTimer?.unref();

  let retentionSweep: Promise<unknown> | null = null;
  let retentionBacklogDone = false;
  let turnBackfillCursor = 0;
  let turnBackfillResumeAt = 0;
  const sweepRetention = () => {
    if (stopped || retentionSweep) return;
    retentionSweep = runDuelSnapshotRetention(options.db, { now, stopped: () => stopped, turnCursor: turnBackfillCursor, turnBackfillResumeAt,
      isForkBusy: (slug, guildId, creatorPlayerId) => queues.has(slug) || queues.has(`fork-owner:${guildId}:${creatorPlayerId}`),
      onError: (phase, error) => log("warn", "[duel] storage maintenance error", { phase,
        code: (error as { code?: string })?.code ?? "unknown", name: error instanceof Error ? error.name : "Unknown" }),
    }).then(stats => {
      turnBackfillCursor = stats.turnCursor;
      turnBackfillResumeAt = stats.turnBackfillResumeAt;
      if (stats.backfilled || stats.compacted || stats.deletedForks || stats.busy || (stats.backlogDone && !retentionBacklogDone)) {
        console.info("[duel] snapshot retention pass", stats);
      }
      retentionBacklogDone = stats.backlogDone;
    })
      .catch(error => log("warn", "[duel] snapshot retention sweep failed", {
        name: error instanceof Error ? error.name : "Unknown", code: (error as { code?: string })?.code ?? "unknown" }))
      .finally(() => { retentionSweep = null; });
  };
  const retentionInterval = duelSnapshotRetentionConfig().intervalMs;
  const retentionTimer = setInterval(sweepRetention, retentionInterval);
  retentionTimer.unref();
  // Allow startup migrations and live recovery to settle before the first bounded pass.
  const retentionStartup = setTimeout(sweepRetention, Math.min(60_000, retentionInterval));
  retentionStartup.unref();

  return {
    async handle(request: Request): Promise<Response> {
      if (request.method !== "POST" || new URL(request.url).pathname !== "/internal/duel") return new Response("Not found", { status: 404 });
      const result = await readSignedRequest(request, { secret: options.secret, purpose: "duel-host" });
      if (!result.ok) return Response.json({ error: result.status === 401 ? "Unauthorized" : result.status === 413 ? "Request too large" : "Invalid JSON" }, { status: result.status });
      let requestOp: string | undefined;
      let replayDeadline: ReturnType<typeof setTimeout> | undefined;
      try {
        const body = result.body as Record<string, unknown>;
        if (!body || typeof body !== "object" || Array.isArray(body)) throw new RequestError("Invalid request", 400);
        if (typeof body.op === "string" && DUEL_OPS.has(body.op)) requestOp = body.op;
        const fork = typeof body.slug === "string" && typeof body.guildId === "string"
          && options.db.prepare<[string, string], { kind: string }>("select kind from duels where web_slug = ? and guild_id = ?")
            .get(body.slug, body.guildId)?.kind === "replay-fork";
        // Fork reads stay queued and pass both access checks, even if a saved opening exists.
        const startupRoom = fork ? null : startingRoom(body);
        if (startupRoom) return Response.json(startupRoom, { headers: { "cache-control": "no-store" } });
        const key = body.op === "replay-fork" ? `fork-owner:${body.guildId}:${body.playerId}` : typeof body.slug === "string" ? body.slug : "catalog";
        // Diagnostics and independently bounded suggestion scans skip the catalog queue.
        const bounded = ["bug-replay-frame", "replay", "owner-replay", "replay-fork", "fork-restart", "fork-cancel", "fork-list"].includes(String(body.op));
        const deadline = new AbortController();
        const ctl = { abandoned: false, ...(bounded ? { signal: deadline.signal } : {}) };
        const expiry = bounded ? new Promise<never>((_, reject) => {
          replayDeadline = setTimeout(() => {
            const error = new RequestError("Replay or fork request timed out. Try again shortly.", 503, "ENGINE_BUSY");
            deadline.abort(error); reject(error);
          }, Math.min(28_000, options.replayRequestTimeoutMs ?? 28_000));
        }) : undefined;
        const queued = (body.op === "deck-suggestions" || body.op === "debug-trace" || body.op === "bug-context" || body.op === "bug-replay-frame" || body.op === "engine-data-status" || body.op === "replay" || body.op === "owner-replay" || body.op === "fork-list" ? operate(body, ctl) : enqueue(key, () => operate(body, ctl)));
        const rendered = (async () => {
          const answer = (body.op === "report" || body.op === "view") && queueBlockedMs > 0 ? await answerOrFallback(body, queued, ctl) : await queued;
          if (fork) assertReplayForkAccess(options.db, body.slug as string, { guildId: body.guildId as string,
            playerId: body.playerId as number, ...(body.userId !== undefined ? { userId: body.userId as number } : {}) });
          if (body.op === "replay" || body.op === "owner-replay") {
            const response = replayJsonResponse(answer as ReplayHttpResult, ctl.signal);
            // Assemble the size-capped body under the deadline before the server copies it to the socket.
            return new Response(await response.arrayBuffer(), { headers: response.headers });
          }
          return Response.json(answer, { headers: { "cache-control": "no-store" } });
        })();
        return await (expiry ? Promise.race([rendered, expiry]) : rendered);
      } catch (error) {
        if (isCardFetchError(error)) {
          return Response.json({ error: "Card database is unavailable. Try again shortly." }, {
            status: 503, headers: { "Retry-After": String(error.retryAfter ?? 1) },
          });
        }
        const intentional = error instanceof ExpectedError || error instanceof DeckLegalityError ||
          error instanceof ReplayAccessError || error instanceof ReplayForkLaunchError || error instanceof ReplayCursorError ||
          error instanceof DuelServiceError || error instanceof TournamentDuelError;
        if (!intentional) {
          const { body, status } = errorResponseBody(error, { tags: { operation: "[duel] Unexpected request error", ...(requestOp ? { op: requestOp } : {}) } });
          return Response.json(body, { status });
        }
        const status = error instanceof DeckLegalityError ? 400 : error.status;
        return Response.json({ error: error.message,
          ...(status === 500 ? { expected: true } : {}),
          ...((error instanceof RequestError || error instanceof ExtraDeckCardError || error instanceof ReplayAccessError || error instanceof ReplayForkLaunchError || error instanceof ReplayCursorError || error instanceof ReplayForkStorageError) && error.code ? { code: error.code } : {}),
          ...(error instanceof ReplayForkLaunchError ? error.recovery : {}),
          ...(error instanceof RequestError && error.finalBoard ? { finalBoard: error.finalBoard } : {}),
          ...(error instanceof RequestError ? error.unverified : {}) }, { status });
      } finally { clearTimeout(replayDeadline); }
    },
    async close(): Promise<void> {
      stopped = true;
      pool.close();
      clearInterval(timer);
      clearInterval(retentionTimer);
      clearTimeout(retentionStartup);
      await retentionSweep;
      if (stallTimer) clearInterval(stallTimer);
      for (const seriesId of [...advanceTimers.keys()]) clearAdvanceTimer(seriesId);
      for (const slug of [...openingTimers.keys()]) clearOpeningTimer(slug);
      const loops = [...botLoops.values()];
      for (const slug of [...botLoops.keys()]) cancelBotLoop(slug);
      await Promise.all([localCardDataStatus.close(), githubCardDataStatus.close()]);
      await Promise.all([...reservations.keys()].map((game) => safeClose(game)));
      await Promise.allSettled([...queues.values(), ...loops.map((loop) => loop.done)]);
      games.clear();
      await replayCache.settle();
      replayCache.clear();
      await replayJsonEncoder.close();
      await suggestionWorkers.close();
      await engineResourceCache.close();
    },
  };
}
