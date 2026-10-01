import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type Database from "better-sqlite3";
import { createDuelService, type DuelFinalSnapshots } from "@yugidraft/shared/services";
import type {
  DuelAnswer,
  DuelCommand,
  DuelDeck,
  DuelEngineView,
  DuelFormat,
  DuelMode,
  DuelPrompt,
  DuelReplay,
  DuelReplayFrame,
  DuelRoom,
  DuelSession,
  DuelSettings,
} from "@yugidraft/shared/duels";
import { opponentSeatsOf, seatCountFor, teamOfSeat } from "@yugidraft/shared/duels";
import { ELIMINATE_PROMPT_PREFIX as ELIMINATE_PREFIX, eliminationCodeOf } from "./engine.js";
import { GameWorker, type DuelGameWorker, type GameOptions, type WorkerDebugState } from "./worker-client.js";
import { inspectDeck, validateDeck } from "./deck-legality.js";
import { normalizeImportedDeck } from "./deck-import.js";
import { loadCardDatabase } from "./cards.js";
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
import { getPreset, multiCoreAvailable, multiCoreInfo, PRESETS, SCRIPTED_POLICY, summarizePreset, type PresetIssue } from "./presets/index.js";

const BOT_ADVANCE_LIMIT = 128;
const DEFAULT_ARCHIVE_AFTER_MS = 10 * 60 * 1000;
const DEFAULT_IDLE_WORKER_MS = 5 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 30 * 1000;
const ARCHIVE_SWEEP_LIMIT = 32;
const CLOCK_SWEEP_LIMIT = 32;
const TIME_LIMIT_REASON = "Time limit";
/** MSG_WIN reason codes from the core (strings.conf victory reasons): 0 Surrendered, 3 Time limit up. */
const WIN_REASON_SURRENDER = 0;
const WIN_REASON_TIME_LIMIT = 3;
const ELIMINATE_PROMPT_PREFIX = ELIMINATE_PREFIX;

/** The win reason code of a journaled elimination, or null when the command is an ordinary answer. */
export function eliminationReasonOf(command: DuelCommand): number | null {
  return eliminationCodeOf(command.promptId);
}
const REPLAY_CACHE_MAX = 16;
/** Journal note of an answer that the host gave for a surrendered seat. The report uses it to place the surrender line. */
const SURRENDER_AUTOPILOT_NOTE = "autopilot: surrendered";
const DEFAULT_STALL_MS = 30 * 1000;
/** A debug read of a stuck worker gives up after this long. */
const DEFAULT_DEBUG_READ_TIMEOUT_MS = 2000;
/** A report or a room read waits this long in a blocked duel queue before it answers without the core. */
const DEFAULT_QUEUE_BLOCKED_MS = 3000;
const TRACE_LIMIT = 40;

function withTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms);
  });
  return Promise.race([work, limit]).finally(() => clearTimeout(timer));
}

class RequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

class ReplayMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReplayMismatchError";
  }
}

type BotOutcome = { kind: "stop" } | { kind: "replan" } | { kind: "acted"; visible: boolean };

type LiveGame = {
  game: DuelGameWorker;
  lastRequestAt: number;
  guildId: string;
  /**
   * Seats that surrendered or ran out of time in a table with more than two seats. The core has no
   * "leave the duel" call yet, so the host keeps them in the game and passes for them (autopilot).
   * Saved in the duel setup so a recover restores it.
   */
  surrendered: Set<number>;
  /** Scripted bot rules by seat (hand scenarios). Seats not in the map play like the random practice bot. */
  policies: Map<number, Rule[]>;
  /** The rules tried for each auto seat's latest prompt (debug-trace). Kept in memory only. */
  traces: Map<number, RuleTraceEntry[]>;
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

function freezeView(
  view: DuelEngineView,
  result: { winnerSeat: number | null; winnerTeam?: number | null; reason: string },
): DuelEngineView {
  return { ...view, prompt: null, result };
}

export interface DuelHost {
  handle(request: Request): Promise<Response>;
  close(): Promise<void>;
}

export function createDuelHost(options: {
  db: Database.Database;
  dataDirectory: string;
  secret: string;
  searchCards: (query: string) => unknown;
  onChange?: (slug: string, guildId: string) => void | Promise<void>;
  archiveAfterMs?: number;
  idleWorkerMs?: number;
  pollIntervalMs?: number;
  now?: () => number;
  createWorker?: () => DuelGameWorker;
  /**
   * Practice bot pacing. 0 or undefined keeps the synchronous behaviour: the bot answers every prompt inside the
   * human's request. A positive number is the base pause in ms (scaled by action: about 0.6x for phase moves,
   * 1x for summons, sets and activations, 1.5x for attacks); a function returns the pause in ms for a prompt.
   * When positive, the bot plays in a background loop and calls `onChange` after each step.
   */
  botStepDelayMs?: number | ((prompt: DuelPrompt) => number);
  /**
   * Stall watchdog: when the revision of an active duel stays the same for this many ms while a bot seat or the
   * core must act, the host writes one `auto-stall` report folder. Default: env `DUEL_STALL_MS`, else 30000. 0 turns it off.
   */
  stallMs?: number;
  /** How long a debug read (views, diagnostics) waits for a stuck worker. Default 2000. Tests make it shorter. */
  debugReadTimeoutMs?: number;
  /**
   * How long a `report` or a room read (`view`) waits in a blocked duel queue. After that, a report is written
   * without the core (`partial: true`) and a room read answers the last view sent to that seat (`stale: true`). Default 3000.
   */
  queueBlockedMs?: number;
  /** Known problems per preset id, for the dev presets page (`list-presets` answers them as `issues`). Default: none. */
  presetIssues?: (presetId: string) => PresetIssue[];
}): DuelHost {
  if (!options.secret) throw new Error("DUEL_INTERNAL_SECRET is required");
  const service = createDuelService(options.db);
  const manifest = JSON.parse(readFileSync(join(options.dataDirectory, "manifest.json"), "utf8")) as { bundleVersion: string };
  if (!manifest.bundleVersion) throw new Error("Engine resource manifest has no bundle version");
  setCatalogDirectory(options.dataDirectory);
  const games = new Map<string, LiveGame>();
  const replayCache = new Map<string, DuelReplay>();
  const queues = new Map<string, Promise<unknown>>();
  const spawn = options.createWorker ?? (() => new GameWorker());
  const archiveAfterMs = options.archiveAfterMs ?? DEFAULT_ARCHIVE_AFTER_MS;
  const idleWorkerMs = options.idleWorkerMs ?? DEFAULT_IDLE_WORKER_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const now = options.now ?? Date.now;
  const botLoops = new Map<string, BotLoop>();
  const pacedBot = typeof options.botStepDelayMs === "function" || (options.botStepDelayMs ?? 0) > 0;
  const envStall = Number(process.env.DUEL_STALL_MS);
  const stallMs = options.stallMs ?? (process.env.DUEL_STALL_MS !== undefined && Number.isFinite(envStall) && envStall >= 0 ? envStall : DEFAULT_STALL_MS);
  const debugReadTimeoutMs = options.debugReadTimeoutMs ?? DEFAULT_DEBUG_READ_TIMEOUT_MS;
  const queueBlockedMs = options.queueBlockedMs ?? DEFAULT_QUEUE_BLOCKED_MS;
  /** The last view built for each seat of each duel (key -1: the spectator). Only views that were built for that seat are kept. */
  const lastViews = new Map<string, Map<number, DuelEngineView>>();
  function rememberView(slug: string, seat: number | null, view: DuelEngineView | null | undefined): void {
    if (!view) return;
    let perSeat = lastViews.get(slug);
    if (!perSeat) lastViews.set(slug, (perSeat = new Map()));
    perSeat.set(seat ?? -1, view);
  }
  let stopped = false;

  /** Check one deck against the real table format, so a Tag or FFA table also refuses the cards that do not work there. */
  function validateSessionDeck(mode: DuelMode, deck: DuelDeck, settings: DuelSettings, format: DuelFormat): void {
    validateDeck(mode, deck, options.dataDirectory, settings, { table: format });
  }

  function workerCreateOptions(
    mode: DuelMode,
    decks: DuelDeck[],
    seed: string[],
    masterRule: DuelSession["masterRule"],
    settings: DuelSettings,
    format: DuelFormat = "1v1",
    startupScripts?: string[],
  ): GameOptions {
    const created: GameOptions = {
      mode,
      decks,
      seed,
      dataDirectory: options.dataDirectory,
      masterRule,
      settings,
    };
    // 1v1 keeps the exact old options. Other formats name the format; `decks` is one deck per seat in seat order.
    if (format !== "1v1") created.format = format;
    // Hand scenarios: the engine runs these Lua chunks before the duel starts. The worker passes options on unchanged.
    if (startupScripts?.length) {
      created.startupScripts = startupScripts.map((content, index) => ({ name: `startup-${index}.lua`, content }));
    }
    return created;
  }

  /** Seats the host answers for: practice bots, plus seats that surrendered (they only pass). */
  function autoSeatsOf(session: DuelSession, entry: LiveGame | undefined): number[] {
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
      await options.onChange?.(slug, guildId);
    } catch (error) {
      console.warn("[duel] onChange failed", error);
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
    const entry = games.get(slug);
    games.delete(slug);
    lastViews.delete(slug);
    cancelBotLoop(slug);
    if (entry) await safeClose(entry.game);
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
    const result: { winnerSeat: number | null; winnerTeam?: number | null; reason: string } = { winnerSeat, reason };
    // Tag: a team wins. `winnerSeat` is the lowest seat of the team; `winnerTeam` names it.
    if (format === "tag") result.winnerTeam = winnerSeat === null ? null : teamOfSeat(format, winnerSeat);
    const seats: DuelEngineView[] = [];
    for (let seat = 0; seat < seatCountFor(format); seat += 1) {
      seats.push(freezeView(await game.view(seat), result));
    }
    return {
      public: freezeView(await game.view(null), result),
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
    let snapshots: DuelFinalSnapshots;
    try {
      snapshots = await captureSnapshots(game, service.get(slug, guildId).format, winnerSeat, reason);
    } catch (error) {
      await disposeGame(slug);
      throw new RequestError(error instanceof Error ? error.message : "Duel engine is temporarily unavailable", 503);
    }
    service.complete(slug, guildId, winnerSeat, reason, snapshots);
    await disposeGame(slug);
    await emitChange(slug, guildId);
  }

  /** Who holds the open prompt, read from every seat's view. `stopped` seats do not get a running clock. */
  async function readClockView(
    game: DuelGameWorker,
    seatCount: number,
    surrendered?: Iterable<number>,
  ): Promise<DecisionClockView> {
    const stopped = new Set<number>(surrendered ?? []);
    const finish = (turn: number, promptSeat: number | null): DecisionClockView =>
      stopped.size > 0 ? { turn, promptSeat, stoppedSeats: [...stopped].sort((a, b) => a - b) } : { turn, promptSeat };
    let firstTurn = 0;
    for (let seat = 0; seat < seatCount; seat += 1) {
      const view = await game.view(seat);
      if (seat === 0) firstTurn = view.turn;
      if (view.result) return finish(firstTurn, null);
      for (const entry of view.seats ?? []) if (entry.eliminated) stopped.add(entry.seat);
      if (view.prompt && isSeatIndex(view.prompt.seat)) return finish(view.turn, view.prompt.seat);
    }
    return finish(firstTurn, null);
  }

  async function persistAcceptedCommand(
    slug: string,
    guildId: string,
    seat: number,
    command: DuelCommand,
    game: DuelGameWorker,
    decidedAt: number,
    note?: string,
  ): Promise<void> {
    const state = service.privateState(slug, guildId);
    const view = await readClockView(game, seatCountFor(state.session.format), games.get(slug)?.surrendered);
    const clock = syncDecisionClock(
      state.clock,
      view,
      state.session.settings.turnSeconds,
      decidedAt,
      now(),
      state.session.settings.timeout,
      isSeatIndex(seat) ? seat : undefined,
    );
    // The journal keeps the reason of a scripted bot in `note`. Replay reads only promptId, revision and answer.
    service.recordCommand(slug, guildId, seat, note ? ({ ...command, note } as DuelCommand) : command, clock);
  }

  async function advancePracticeBot(slug: string, guildId: string, game: DuelGameWorker): Promise<void> {
    for (let step = 0; step < BOT_ADVANCE_LIMIT; step++) {
      const session = service.get(slug, guildId);
      if (session.status !== "active") return;
      const entry = games.get(slug);
      const autoSeats = autoSeatsOf(session, entry);
      if (autoSeats.length === 0) return;
      const found = await findAutoPrompt(game, autoSeats);
      if (!found || found.kind === "result") return;
      const { seat, view } = found;
      const prompt = view.prompt!;

      let answer: DuelAnswer;
      let note: string | undefined;
      try {
        ({ answer, note } = await chooseAutoAnswer(game, entry, seat, prompt, view));
      } catch (error) {
        const message = error instanceof PracticeBotError ? error.message : "Practice bot failed to choose";
        throw new RequestError(message, 500);
      }
      if ((answer as { surrender?: boolean }).surrender) {
        await forfeitSeat(slug, guildId, game, seat, "Surrender", false);
        continue;
      }
      const command: DuelCommand = { promptId: prompt.id, revision: view.revision, answer };
      const decidedAt = now();
      try {
        await game.answer(seat, prompt.id, answer);
      } catch (error) {
        throw new RequestError(error instanceof Error ? error.message : "Practice bot made an illegal choice", 500);
      }
      try {
        await persistAcceptedCommand(slug, guildId, seat, command, game, decidedAt, note);
      } catch (error) {
        await disposeGame(slug);
        throw error;
      }
    }
    throw new RequestError("Practice bot failed to make progress", 500);
  }

  /** Answer bot prompts now (unpaced) or hand them to the background loop (paced). */
  async function driveBot(slug: string, guildId: string, game: DuelGameWorker): Promise<void> {
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
      console.warn("[duel] could not interrupt a stuck practice bot table", error);
    }
    await disposeGame(slug);
    await emitChange(slug, guildId);
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
      let settle = 0;
      for (;;) {
        if (loop.cancelled || stopped) return finish();
        let plan: BotPlan | null;
        try {
          plan = await enqueue(slug, () => planBotStep(slug, guildId, loop, finish, settle));
        } catch (error) {
          console.warn("[duel] practice bot planning failed", error);
          return finish();
        }
        if (!plan) return;
        const startedAt = now();
        loop.timer = { seat: plan.seat, delayMs: plan.delayMs, startedAt, dueAt: startedAt + plan.delayMs };
        await botPause(loop, plan.delayMs);
        loop.timer = null;
        if (loop.cancelled || stopped) return finish();
        let outcome: BotOutcome;
        try {
          outcome = await enqueue(slug, () => actBotStep(slug, guildId, loop, finish, plan));
        } catch (error) {
          console.warn("[duel] practice bot step failed", error);
          return finish();
        }
        if (outcome.kind === "stop") return;
        if (outcome.kind === "replan") continue;
        steps += 1;
        settle = outcome.visible ? plan.cost : 0;
        if (steps >= BOT_ADVANCE_LIMIT) {
          await enqueue(slug, async () => {
            if (loop.cancelled || stopped) return;
            finish();
            await interruptBrokenBot(slug, guildId, "The practice bot failed to make progress.");
          }).catch((error) => console.warn("[duel] practice bot interrupt failed", error));
          return;
        }
      }
    })().catch((error) => {
      console.warn("[duel] practice bot loop crashed", error);
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
      console.warn("[duel] practice bot could not read the duel", error);
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
        console.warn("[duel] could not record the finished duel", error);
      }
      return null;
    }
    if (!found) {
      finish();
      return null;
    }
    const { view, seat } = found;
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
      console.warn(`[duel] ${message}`);
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
      console.warn("[duel] practice bot could not read the duel", error);
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
        console.warn("[duel] scripted bot could not surrender", error);
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
      console.warn("[duel] practice bot answer was rejected", error);
      const rejectedTrace = entry.traces.get(plan.seat) ?? [];
      rejectedTrace.push({ rule: plan.note ?? "practice bot", matched: true, answer: plan.answer, rejected: true, reason: error instanceof Error ? error.message : String(error) });
      entry.traces.set(plan.seat, rejectedTrace);
      if (!game.running) await disposeGame(slug);
      else await interruptBrokenBot(slug, guildId, "The practice bot could not continue.");
      return { kind: "stop" };
    }
    try {
      await persistAcceptedCommand(slug, guildId, plan.seat, command, game, decidedAt, plan.note);
    } catch (error) {
      // The answer was applied but not journaled. Dropping the worker makes the next request rebuild the
      // duel from the journal, which never contains an unrecorded command.
      finish();
      console.warn("[duel] could not record the practice bot's move", error);
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
    const existing = games.get(slug);
    if (existing?.game.running) {
      existing.lastRequestAt = now();
      await driveBot(slug, guildId, existing.game);
      return existing.game;
    }
    games.delete(slug);
    const state = service.privateState(slug, guildId);
    if (state.session.status !== "active") throw new RequestError("This duel is not active", 409);
    if (!state.seed || !state.bundleVersion) throw new RequestError("Duel has not started", 409);
    if (state.bundleVersion !== manifest.bundleVersion) {
      service.interrupt(slug, guildId, "The pinned engine resources changed; this duel cannot be replayed safely.");
      await emitChange(slug, guildId);
      throw new RequestError("Duel interrupted: engine resource version changed", 409);
    }
    const game = spawn();
    try {
      await game.create(workerCreateOptions(
        state.session.mode,
        state.decks,
        state.seed,
        state.session.masterRule,
        state.session.settings,
        state.session.format,
        state.setup?.startupScripts,
      ));
    } catch (error) {
      await safeClose(game);
      throw new RequestError(error instanceof Error ? error.message : "Duel engine is temporarily unavailable", 503);
    }
    try {
      for (const input of state.commands) {
        let view: DuelEngineView;
        try {
          view = await game.view(input.seat);
        } catch (error) {
          await safeClose(game);
          throw new RequestError(error instanceof Error ? error.message : "Duel engine is temporarily unavailable", 503);
        }
        const elimination = eliminationReasonOf(input.command);
        if (view.revision !== input.command.revision || (elimination === null && view.prompt?.id !== input.command.promptId)) {
          throw new ReplayMismatchError("Duel recovery did not reproduce the saved prompt");
        }
        try {
          if (elimination === null) await game.answer(input.seat, input.command.promptId, input.command.answer);
          else if (game.eliminate) await game.eliminate(input.seat, elimination);
          else throw new ReplayMismatchError("Duel recovery needs an engine that can eliminate a duelist");
        } catch (error) {
          if (error instanceof ReplayMismatchError) throw error;
          if (!game.running) {
            await safeClose(game);
            throw new RequestError(error instanceof Error ? error.message : "Duel engine is temporarily unavailable", 503);
          }
          throw new ReplayMismatchError(error instanceof Error ? error.message : "Duel recovery could not replay a saved choice");
        }
      }
    } catch (error) {
      await safeClose(game);
      if (error instanceof ReplayMismatchError) {
        service.interrupt(slug, guildId, "The saved engine state could not be recovered.");
        await emitChange(slug, guildId);
        throw new RequestError(error.message, 409);
      }
      throw error;
    }
    games.set(slug, {
      game,
      lastRequestAt: now(),
      guildId,
      surrendered: new Set(state.setup?.surrenderedSeats ?? []),
      policies: policiesOf(state.setup),
      traces: new Map(),
    });
    await driveBot(slug, guildId, game);
    return game;
  }

  /**
   * Remove a seat from a duel with more than two seats through the core (`Debug.EliminateDuelist`).
   * Returns false when the core cannot do it: the caller then keeps the seat on autopilot.
   */
  async function eliminateInCore(slug: string, guildId: string, game: DuelGameWorker, seat: number, code: number): Promise<boolean> {
    if (typeof game.eliminate !== "function") return false;
    const before = await game.view(seat);
    try {
      await game.eliminate(seat, code);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Engine rejected the elimination";
      if (/no Debug\.EliminateDuelist/.test(message)) return false;
      if (/already eliminated/.test(message)) return true;
      if (!game.running) throw new RequestError(message, 503);
      throw new RequestError(message, 409);
    }
    const command: DuelCommand = { promptId: `${ELIMINATE_PROMPT_PREFIX}${code}`, revision: before.revision, answer: {} };
    try {
      await persistAcceptedCommand(slug, guildId, seat, command, game, now());
    } catch (error) {
      // Applied but not journaled: drop the worker so the next request rebuilds the duel from the journal.
      await disposeGame(slug);
      throw error;
    }
    return true;
  }

  /**
   * A seat gives up (surrender or time limit).
   * - 1v1: the other seat wins. Tag: the team is the unit, the other team wins (winner seat = its lowest seat).
   * - FFA (3 or 4 seats): only this seat is out. The host records it and plays its prompts with passes
   *   (only when the core has no `Debug.EliminateDuelist`; otherwise the core removes it). The last living seat wins.
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
    if (format === "1v1" || format === "tag") {
      const winner = opponentSeatsOf(format, seat)[0];
      if (winner === undefined) throw new RequestError("Opponent is missing", 409);
      await persistComplete(slug, guildId, game, winner, reason);
      return;
    }
    const entry = games.get(slug);
    if (!entry) throw new RequestError("Duel is not running", 409);
    if (!entry.surrendered.has(seat) && (await eliminateInCore(slug, guildId, game, seat, reason === TIME_LIMIT_REASON ? WIN_REASON_TIME_LIMIT : WIN_REASON_SURRENDER))) {
      // The core removed the seat (journaled like an answer). The last duelist standing ends the duel.
      const after = await game.view(0);
      if (after.result) {
        await persistComplete(slug, guildId, game, after.result.winnerSeat, reason);
        return;
      }
      await emitChange(slug, guildId);
      if (drive) await driveBot(slug, guildId, game);
      return;
    }
    if (!entry.surrendered.has(seat)) {
      entry.surrendered.add(seat);
      service.setSetup(slug, guildId, { ...(state.setup ?? {}), surrenderedSeats: [...entry.surrendered].sort((a, b) => a - b) });
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

  async function settleClock(slug: string, guildId: string, game?: DuelGameWorker, at = now()): Promise<void> {
    const state = service.privateState(slug, guildId);
    if (state.session.status !== "active" || !state.clock) return;
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

    const live = game?.running ? game : await recover(slug, guildId);
    await forfeitSeat(slug, guildId, live, expired, TIME_LIMIT_REASON);
  }

  async function project(slug: string, guildId: string, playerId: number, game?: DuelGameWorker): Promise<DuelRoom> {
    const room = stampRoomClock(service.room(slug, guildId, playerId), now());
    if (game && game.running && room.session.status === "active") {
      room.engine = await game.view(room.mySeat);
      rememberView(slug, room.mySeat, room.engine);
      // Surrendered seats stay in the core on autopilot. Show them as out of the game.
      for (const gone of games.get(slug)?.surrendered ?? []) {
        const seatView = room.engine.seats?.find((entry) => entry.seat === gone);
        if (seatView) seatView.eliminated = true;
      }
      if (room.engine.result) {
        await persistComplete(slug, guildId, game, room.engine.result.winnerSeat, room.engine.result.reason);
        return stampRoomClock(service.room(slug, guildId, playerId), now());
      }
    }
    return room;
  }

  /** Keep only log/event entries newer than those already emitted; ids grow monotonically per board. */
  function deltaView(view: DuelEngineView, seen: { log: number; events: number }): DuelEngineView {
    const log = view.log.filter((entry) => entry.id > seen.log);
    const events = view.events.filter((entry) => entry.id > seen.events);
    for (const entry of log) seen.log = Math.max(seen.log, entry.id);
    for (const entry of events) seen.events = Math.max(seen.events, entry.id);
    return { ...view, prompt: null, log, events };
  }

  async function buildReplay(slug: string, guildId: string, room: DuelRoom): Promise<DuelReplay> {
    const session = room.session;
    if (session.status !== "completed" && session.status !== "interrupted") {
      throw new RequestError("Replays are available after the duel ends", 409);
    }
    const state = service.privateState(slug, guildId);
    if (!state.seed || !state.bundleVersion) {
      throw new RequestError("This duel has no recorded moves to replay.", 409);
    }
    if (state.bundleVersion !== manifest.bundleVersion) {
      throw new RequestError(
        "Replay unavailable: the duel engine changed after this game was played. The final board is still available.",
        409,
      );
    }
    const viewer = room.mySeat;
    const mismatch = () =>
      new RequestError("Replay could not reproduce this duel. The final board is still available.", 409);
    const transport = (error: unknown) =>
      new RequestError(error instanceof Error ? error.message : "Duel engine is temporarily unavailable", 503);
    const frames: DuelReplayFrame[] = [];
    const seen = { log: 0, events: 0 };
    const game = spawn();
    let lastView: DuelEngineView;
    try {
      try {
        await game.create(workerCreateOptions(session.mode, state.decks, state.seed, session.masterRule, session.settings, session.format, state.setup?.startupScripts));
      } catch (error) {
        throw transport(error);
      }
      try {
        lastView = await game.view(viewer);
      } catch (error) {
        throw transport(error);
      }
      frames.push({ step: 0, actorSeat: null, view: deltaView(lastView, seen) });
      for (let i = 0; i < state.commands.length; i++) {
        const input = state.commands[i]!;
        try {
          const before = await game.view(input.seat);
          const elimination = eliminationReasonOf(input.command);
          if (before.revision !== input.command.revision || (elimination === null && before.prompt?.id !== input.command.promptId)) throw mismatch();
          try {
            if (elimination === null) await game.answer(input.seat, input.command.promptId, input.command.answer);
            else if (game.eliminate) await game.eliminate(input.seat, elimination);
            else throw mismatch();
          } catch (error) {
            if (error instanceof RequestError) throw error;
            if (!game.running) throw transport(error);
            throw mismatch();
          }
          lastView = await game.view(viewer);
        } catch (error) {
          if (error instanceof RequestError) throw error;
          throw transport(error);
        }
        frames.push({ step: i + 1, actorSeat: input.seat, view: deltaView(lastView, seen) });
      }
    } finally {
      await safeClose(game);
    }
    if (!lastView.result) {
      const step = frames.length;
      if (room.engine) {
        frames.push({ step, actorSeat: null, view: deltaView(room.engine, seen) });
      } else {
        frames.push({
          step,
          actorSeat: null,
          view: {
            ...lastView,
            prompt: null,
            log: [],
            events: [],
            result: {
              winnerSeat: session.winnerSeat,
              ...(session.format === "tag"
                ? { winnerTeam: session.winnerSeat === null ? null : teamOfSeat(session.format, session.winnerSeat) }
                : {}),
              reason: session.resultReason ?? "Duel ended",
            },
          },
        });
      }
    }
    return { session, role: room.role, mySeat: room.mySeat, frames };
  }

  async function replay(slug: string, guildId: string, room: DuelRoom): Promise<DuelReplay> {
    const key = `${guildId}:${slug}:${room.mySeat ?? "public"}`;
    const cached = replayCache.get(key);
    if (cached) {
      replayCache.delete(key);
      replayCache.set(key, cached);
      return cached;
    }
    const built = await buildReplay(slug, guildId, room);
    replayCache.set(key, built);
    while (replayCache.size > REPLAY_CACHE_MAX) {
      const oldest = replayCache.keys().next().value;
      if (oldest === undefined) break;
      replayCache.delete(oldest);
    }
    return built;
  }

  function requireScenarios(): void {
    if (process.env.DUEL_SCENARIOS !== "1") throw new RequestError("Not found", 404);
  }

  /** Hand scenarios: make a table from a preset, fill the bot seats and start the duel. */
  async function startPreset(body: Record<string, unknown>, guildId: string, actor: number): Promise<unknown> {
    const preset = typeof body.presetId === "string" ? getPreset(body.presetId) : undefined;
    if (!preset) throw new RequestError("Unknown preset", 404);
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
    let compiled: ReturnType<typeof compileBoard>;
    try {
      compiled = compileBoard(preset.board, options.dataDirectory);
    } catch (error) {
      throw new RequestError(error instanceof Error ? error.message : "Preset board is invalid", 500);
    }
    const copts = compiled.options;
    const seatCount = seatCountFor(preset.format);
    const created = service.create({
      guildId,
      organizerPlayerId: actor,
      name: preset.title,
      mode: copts.mode ?? "normal",
      masterRule: copts.masterRule,
      settings: copts.settings,
      format: preset.format,
    });
    const slug = created.slug;
    let game: DuelGameWorker | undefined;
    try {
      service.setDeck(slug, guildId, actor, copts.decks[0]!);
      for (let seat = 1; seat < seatCount; seat += 1) service.addPracticeBot(slug, guildId, actor, copts.decks[seat]!, seat);
      const state = service.privateState(slug, guildId);
      const settings = state.session.settings;
      const scripts = (copts.startupScripts ?? []).map((script) => script.content);
      const botPolicies: Record<string, string> = {};
      for (let seat = 1; seat < seatCount; seat += 1) botPolicies[String(seat)] = SCRIPTED_POLICY;
      game = spawn();
      try {
        await game.create(workerCreateOptions(state.session.mode, state.decks, seed, state.session.masterRule, settings, preset.format, scripts));
      } catch (error) {
        throw new RequestError(error instanceof Error ? error.message : "Duel engine is temporarily unavailable", 503);
      }
      const clock = startDecisionClock(await readClockView(game, seatCount), settings.turnSeconds, now(), seatCount);
      service.activate(slug, guildId, actor, seed, manifest.bundleVersion, clock, {
        scenarioId: preset.id,
        presetId: preset.id,
        startupScripts: scripts,
        botPolicies,
      });
      games.set(slug, {
        game,
        lastRequestAt: now(),
        guildId,
        surrendered: new Set(),
        policies: policiesOf({ presetId: preset.id, botPolicies }),
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
    await emitChange(slug, guildId);
    await driveBot(slug, guildId, game);
    const room = await project(slug, guildId, actor, game);
    return { slug, session: room.session, room };
  }

  /** One debug read of a view. A stuck worker never answers, so every read has a time limit. */
  async function readDebugView(slug: string, game: DuelGameWorker, seat: number | null): Promise<{ view: DuelEngineView | null; error?: string }> {
    try {
      const view = await withTimeout(game.view(seat), debugReadTimeoutMs, `view ${seat === null ? "spectator" : `seat ${seat}`}`);
      rememberView(slug, seat, view);
      return { view };
    } catch (error) {
      return { view: null, error: error instanceof Error ? error.message : String(error) };
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
   * startup scripts, core sha and more). Then one line per accepted command at its seq (`answer` or `eliminate`). A surrender
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
        seed: state.seed,
        settings: session.settings,
        setup: state.setup ?? null,
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
      const index = state.commands.findIndex((entry) => entry.seat === seat && (entry.command as { note?: string }).note === SURRENDER_AUTOPILOT_NOTE);
      markerAt.set(seat, index >= 0 ? index + 1 : state.commands.length + 1);
    }
    const marker = (seq: number) => {
      for (const [seat, at] of markerAt) if (at === seq) lines.push({ type: "surrender", seq, seat });
    };
    state.commands.forEach((entry, index) => {
      const seq = index + 1;
      marker(seq);
      const command = entry.command as DuelCommand & { note?: string };
      lines.push({
        type: eliminationReasonOf(command) === null ? "answer" : "eliminate",
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
      writeFileSync(join(dir, "room-setup.json"), JSON.stringify({ session, setup: state.setup ?? null }, null, 2));
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
  function staleRoom(slug: string, guildId: string, actor: number): (DuelRoom & { stale: true }) | null {
    const room = stampRoomClock(service.room(slug, guildId, actor), now());
    if (room.session.status !== "active") return null;
    const view = lastViews.get(slug)?.get(room.mySeat ?? -1);
    if (!view) return null;
    room.engine = view;
    return { ...room, stale: true };
  }

  /** Hand scenarios: the debug trace of one duel (404 unless `DUEL_SCENARIOS=1`). Not queued, so it works on a stuck duel. */
  async function debugTrace(slug: string, guildId: string, actor: number): Promise<Record<string, unknown>> {
    const room0 = service.room(slug, guildId, actor);
    if (room0.mySeat === null) throw new RequestError("Join this duel first", 403);
    return buildDebugTrace(slug, guildId);
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
    console.warn(`[duel] stall in ${slug}: ${note} Report: ${written.path}`);
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
          console.warn("[duel] stall check failed", error);
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
    if (op === "report") {
      requireScenarios();
      ctl.abandoned = true;
      return writePartialReport(slug, guildId, playerId as number, body.note);
    }
    return staleRoom(slug, guildId, playerId as number) ?? queued;
  }

  async function operate(body: Record<string, unknown>, ctl?: { abandoned: boolean }): Promise<unknown> {
    const { op, guildId, playerId } = body;
    if (typeof guildId !== "string" || !guildId || !Number.isSafeInteger(playerId) || (playerId as number) <= 0) {
      throw new RequestError("Authenticated guild and player are required", 400);
    }
    const actor = playerId as number;
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
    if (op === "card-details") {
      if (!Array.isArray(body.codes) || body.codes.length > 1000
        || body.codes.some((code) => !Number.isSafeInteger(code) || code <= 0 || code > 0xffffffff)) {
        throw new RequestError("Provide at most 1000 positive card passcodes", 400);
      }
      const catalog = loadCardDatabase(options.dataDirectory);
      const cards = [];
      const missing: number[] = [];
      for (const code of new Set<number>(body.codes)) {
        const card = catalog.get(code);
        if (card) cards.push(card);
        else missing.push(code);
      }
      return { cards, missing };
    }
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
        const view = await live.view(room.mySeat);
        if (view.prompt?.kind !== "announce-card") throw new RequestError("No card announcement is waiting", 409);
        return { cards: await live.search(body.query) };
      }
      return { cards: options.searchCards(body.query) };
    }
    if (typeof body.slug !== "string" || !body.slug || body.slug.length > 128) throw new RequestError("Duel slug is required", 400);
    const slug = body.slug;
    const room = service.room(slug, guildId, actor);
    if (op === "view") {
      if (room.session.status === "active") {
        const game = await recover(slug, guildId);
        await settleClock(slug, guildId, game);
        return project(slug, guildId, actor, games.get(slug)?.game);
      }
      return project(slug, guildId, actor, games.get(slug)?.game);
    }
    if (op === "add-bot") {
      if (actor !== room.session.organizerPlayerId) throw new RequestError("Only the organizer can add a practice bot", 403);
      if (room.session.status !== "lobby") throw new RequestError("A practice bot can only be added before the duel starts", 409);
      const settings = room.session.settings;
      const deck = buildPracticeBotDeck(room.session.mode, options.dataDirectory);
      validateSessionDeck(room.session.mode, deck, settings, room.session.format);
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
      await disposeGame(slug);
      await emitChange(slug, guildId);
      return project(slug, guildId, actor);
    }
    if (op === "cancel") {
      service.cancel(slug, guildId, actor);
      await emitChange(slug, guildId);
      return project(slug, guildId, actor);
    }
    if (op === "report") return writeReport(slug, guildId, actor, body.note, ctl);
    if (op === "debug-trace") return debugTrace(slug, guildId, actor);
    if (op === "replay") return replay(slug, guildId, room);
    if (room.mySeat === null) throw new RequestError("Join this duel first", 403);
    const seat = room.mySeat;
    if (op === "deck" || op === "validate-deck") {
      if (room.session.status !== "lobby") throw new RequestError("Decks are locked after the duel starts", 409);
      const settings = room.session.settings;
      const deck = await normalizeImportedDeck(body.deck as DuelDeck, options.dataDirectory, options.db, {
        keepUnresolved: op === "validate-deck",
      });
      if (op === "validate-deck") {
        return inspectDeck(room.session.mode, deck, options.dataDirectory, settings, { table: room.session.format });
      }
      validateSessionDeck(room.session.mode, deck, settings, room.session.format);
      const session = service.setDeck(slug, guildId, actor, deck);
      await emitChange(slug, guildId);
      return { session };
    }
    if (op === "start") {
      if (actor !== room.session.organizerPlayerId) throw new RequestError("Only the organizer can start", 403);
      if (room.session.status !== "lobby") throw new RequestError("Duel already started", 409);
      const seatCount = seatCountFor(room.session.format);
      if (room.session.seats.length !== seatCount || room.session.seats.some((entry) => !entry.ready)) {
        throw new RequestError(
          seatCount === 2
            ? "Two players must submit valid decks before starting"
            : `${seatCount} players must submit valid decks before starting`,
          409,
        );
      }
      const state = service.privateState(slug, guildId);
      const settings = state.session.settings;
      for (const deck of state.decks) validateSessionDeck(state.session.mode, deck, settings, state.session.format);
      const bytes = randomBytes(32);
      const seed = [0, 8, 16, 24].map((offset) => bytes.readBigUInt64LE(offset).toString());
      const game = spawn();
      try {
        await game.create(workerCreateOptions(
          state.session.mode,
          state.decks,
          seed,
          state.session.masterRule,
          settings,
          state.session.format,
        ));
        const clock = startDecisionClock(await readClockView(game, seatCount), settings.turnSeconds, now(), seatCount);
        service.activate(slug, guildId, actor, seed, manifest.bundleVersion, clock);
        games.set(slug, { game, lastRequestAt: now(), guildId, surrendered: new Set(), policies: new Map(), traces: new Map() });
        await emitChange(slug, guildId);
        await driveBot(slug, guildId, game);
        return await project(slug, guildId, actor, game);
      } catch (error) {
        games.delete(slug);
        await safeClose(game);
        throw error;
      }
    }
    if (room.session.status !== "active") throw new RequestError("This duel is not active", 409);
    if (op === "surrender") {
      const game = await recover(slug, guildId);
      await settleClock(slug, guildId, game);
      const current = await project(slug, guildId, actor, games.get(slug)?.game);
      if (current.session.status !== "active") return current;
      await forfeitSeat(slug, guildId, games.get(slug)?.game ?? game, seat, "Surrender");
      return project(slug, guildId, actor, games.get(slug)?.game);
    }
    if (op !== "respond") throw new RequestError("Unknown duel operation", 400);
    const command = body.command as DuelCommand | undefined;
    if (!command || typeof command.promptId !== "string" || !Number.isSafeInteger(command.revision) || !command.answer || typeof command.answer !== "object") {
      throw new RequestError("Invalid engine command", 400);
    }
    const game = await recover(slug, guildId);
    await settleClock(slug, guildId, game);
    if (service.get(slug, guildId).status !== "active") {
      return project(slug, guildId, actor);
    }
    const live = games.get(slug)?.game ?? game;
    if (games.get(slug)?.surrendered.has(seat)) throw new RequestError("You surrendered this duel", 409);
    const before: DuelEngineView = await live.view(seat);
    if (before.revision !== command.revision || before.prompt?.id !== command.promptId) {
      throw new RequestError("That choice is stale. Refresh the current duel state.", 409);
    }
    const decidedAt = now();
    await settleClock(slug, guildId, live, decidedAt);
    if (service.get(slug, guildId).status !== "active") {
      return project(slug, guildId, actor);
    }
    try {
      await live.answer(seat, command.promptId, command.answer);
    } catch (error) {
      throw new RequestError(error instanceof Error ? error.message : "Invalid engine choice", 400);
    }
    try {
      await persistAcceptedCommand(slug, guildId, seat, command, live, decidedAt);
      await emitChange(slug, guildId);
      await driveBot(slug, guildId, live);
      return await project(slug, guildId, actor, live);
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
      const due = service.dueClocks(t, CLOCK_SWEEP_LIMIT);
      for (const item of due) {
        if (stopped) return;
        try {
          await enqueue(item.slug, async () => {
            if (stopped) return;
            await settleClock(item.slug, item.guildId);
          });
        } catch (error) {
          console.warn("[duel] clock sweep failed", error);
        }
      }
    } catch (error) {
      console.warn("[duel] clock sweep failed", error);
    }
    if (stopped) return;
    for (const [slug, entry] of [...games]) {
      if (stopped) return;
      if (queues.has(slug)) continue;
      if (t - entry.lastRequestAt < idleWorkerMs) continue;
      games.delete(slug);
      cancelBotLoop(slug);
      await safeClose(entry.game);
    }
    if (stopped) return;
    try {
      const archived = service.archiveDue(ARCHIVE_SWEEP_LIMIT, archiveAfterMs);
      for (const session of archived) {
        await emitChange(session.slug, session.guildId);
      }
    } catch (error) {
      console.warn("[duel] archive sweep failed", error);
    }
  }

  const timer = setInterval(() => {
    void tick();
  }, pollIntervalMs);
  timer.unref();
  void tick();
  const stallTimer = stallMs > 0 ? setInterval(() => void checkStalls(), Math.max(10, Math.min(5000, Math.floor(stallMs / 4)))) : null;
  stallTimer?.unref();

  return {
    async handle(request: Request): Promise<Response> {
      if (request.method !== "POST" || new URL(request.url).pathname !== "/internal/duel") return new Response("Not found", { status: 404 });
      const raw = await request.text();
      if (Buffer.byteLength(raw) > 64 * 1024) return Response.json({ error: "Request too large" }, { status: 413 });
      const signature = request.headers.get("x-announce-signature") ?? "";
      const expected = "sha256=" + createHmac("sha256", options.secret).update(raw).digest("hex");
      if (Buffer.byteLength(signature) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }
      try {
        let body: Record<string, unknown>;
        try { body = JSON.parse(raw); } catch { throw new RequestError("Invalid JSON", 400); }
        if (!body || typeof body !== "object" || Array.isArray(body)) throw new RequestError("Invalid request", 400);
        const key = typeof body.slug === "string" ? body.slug : "catalog";
        // debug-trace must answer while the duel queue is stuck inside the core, so it skips the queue.
        const ctl = { abandoned: false };
        const queued = (body.op === "debug-trace" ? operate(body) : enqueue(key, () => operate(body, ctl)));
        const answer = body.op === "report" || body.op === "view" ? await answerOrFallback(body, queued, ctl) : await queued;
        return Response.json(answer, { headers: { "cache-control": "no-store" } });
      } catch (error) {
        const status = error instanceof Error && "status" in error && typeof error.status === "number" ? error.status : 400;
        return Response.json({ error: error instanceof Error ? error.message : "Duel request failed" }, { status });
      }
    },
    async close(): Promise<void> {
      stopped = true;
      clearInterval(timer);
      if (stallTimer) clearInterval(stallTimer);
      const loops = [...botLoops.values()];
      for (const slug of [...botLoops.keys()]) cancelBotLoop(slug);
      await Promise.allSettled([...queues.values(), ...loops.map((loop) => loop.done)]);
      await Promise.all([...games.values()].map((entry) => safeClose(entry.game)));
      games.clear();
      replayCache.clear();
    },
  };
}
