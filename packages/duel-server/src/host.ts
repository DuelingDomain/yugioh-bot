import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { createDuelSeriesService, createDuelService, type DuelFinalSnapshots } from "@yugidraft/shared/services";
import type {
  DuelAnswer,
  DuelCommand,
  DuelDeck,
  DuelEngineView,
  DuelMode,
  DuelOpeningState,
  DuelPrompt,
  DuelReplay,
  DuelReplayFrame,
  DuelRoom,
  DuelSeriesSummary,
  DuelSession,
  DuelSettings,
} from "@yugidraft/shared/duels";
import {
  CardQueryError, isFirstChoice, isRpsMove, normalizeDuelSettings, parseCardQuery, DUEL_OPENING_PICK_MS, DUEL_RPS_MOVES,
} from "@yugidraft/shared/duels";
import { GameWorker, type DuelGameWorker, type GameOptions } from "./worker-client.js";
import { DeckLegalityError, inspectDeck, validateDeck } from "./deck-legality.js";
import { normalizeCardCodes, normalizeImportedDeck } from "./deck-import.js";
import { loadCardDatabase } from "./cards.js";
import { cardFacets, queryCards } from "./card-search.js";
import { buildPracticeBotDeck, choosePracticeBotAnswer, PracticeBotError } from "./practice-bot.js";
import {
  freezeContinueClock,
  isClockDue,
  isSeatIndex,
  persistedClockState,
  startDecisionClock,
  syncDecisionClock,
  withServerNow,
  type DecisionClockView,
} from "./clock.js";

const BOT_ADVANCE_LIMIT = 128;
const DEFAULT_ARCHIVE_AFTER_MS = 10 * 60 * 1000;
const DEFAULT_IDLE_WORKER_MS = 5 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 30 * 1000;
const ARCHIVE_SWEEP_LIMIT = 32;
const CLOCK_SWEEP_LIMIT = 32;
const SERIES_SWEEP_LIMIT = 16;
/** Wait after the 1st, 2nd and later failed starts of one series game; the last value is the cap. */
const START_BACKOFF_MS = [60 * 1000, 5 * 60 * 1000, 15 * 60 * 1000];
const MAX_TIMER_MS = 2 ** 31 - 1;
const TIME_LIMIT_REASON = "Time limit";
const REPLAY_CACHE_MAX = 16;

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

type LiveGame = { game: DuelGameWorker; lastRequestAt: number; guildId: string };

/** One background loop plays the practice bot's turns at a human pace; at most one per duel. */
interface BotLoop {
  cancelled: boolean;
  /** Wakes the loop's current pause so it can notice cancellation. */
  wake: (() => void) | null;
  done: Promise<void>;
}

interface BotPlan {
  promptId: string;
  revision: number;
  answer: DuelAnswer;
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

function freezeView(view: DuelEngineView, result: { winnerSeat: number | null; reason: string }): DuelEngineView {
  return { ...view, prompt: null, prioritySeat: null, result };
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

export function createDuelHost(options: {
  db: Database.Database;
  dataDirectory: string;
  secret: string;
  searchCards: (query: string) => unknown;
  onChange?: (slug: string, guildId: string) => void | Promise<void>;
  /** A finished game moved a tournament bracket slot (`match-updated`) or finished the tournament (`completed`). */
  notifyTournament?: (notice: TournamentNotice) => void | Promise<void>;
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
   * Rock-paper-scissors before game 1 of every duel and match. Off by default so a Start duel starts at once
   * (tests, tools); the duel server turns it on.
   */
  openingRps?: boolean;
  /** Random source for the practice bot's moves and for timed-out picks. */
  random?: () => number;
}): DuelHost {
  if (!options.secret) throw new Error("DUEL_INTERNAL_SECRET is required");
  const service = createDuelService(options.db);
  const series = createDuelSeriesService(options.db);
  const manifest = JSON.parse(readFileSync(join(options.dataDirectory, "manifest.json"), "utf8")) as { bundleVersion: string };
  if (!manifest.bundleVersion) throw new Error("Engine resource manifest has no bundle version");
  const games = new Map<string, LiveGame>();
  const replayCache = new Map<string, DuelReplay>();
  const queues = new Map<string, Promise<unknown>>();
  const spawn = options.createWorker ?? (() => new GameWorker());
  const archiveAfterMs = options.archiveAfterMs ?? DEFAULT_ARCHIVE_AFTER_MS;
  const idleWorkerMs = options.idleWorkerMs ?? DEFAULT_IDLE_WORKER_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const now = options.now ?? Date.now;
  const botLoops = new Map<string, BotLoop>();
  const advanceTimers = new Map<number, ReturnType<typeof setTimeout>>();
  /** One timer per duel with a running rock-paper-scissors opening: it fires at the phase deadline. */
  const openingTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const random = options.random ?? Math.random;
  /** Series games whose last start failed: the tick sweep skips a slug until `retryAt`. */
  const startBackoff = new Map<string, { failures: number; retryAt: number }>();
  const pacedBot = typeof options.botStepDelayMs === "function" || (options.botStepDelayMs ?? 0) > 0;
  let stopped = false;

  function validateSessionDeck(mode: DuelMode, deck: DuelDeck, settings: DuelSettings): void {
    validateDeck(mode, deck, options.dataDirectory, settings);
  }

  function workerCreateOptions(
    mode: DuelMode,
    decks: DuelDeck[],
    seed: string[],
    masterRule: DuelSession["masterRule"],
    settings: DuelSettings,
  ): GameOptions {
    return {
      mode,
      decks,
      seed,
      dataDirectory: options.dataDirectory,
      masterRule,
      settings,
    };
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

  async function emitTournament(kind: TournamentNotice["kind"], slug: string): Promise<void> {
    try {
      await options.notifyTournament?.({ kind, slug });
    } catch (error) {
      console.warn("[duel] tournament notify failed", error);
    }
  }

  function bothSeatsReady(session: DuelSession): boolean {
    return session.seats.length === 2 && session.seats.every((entry) => entry.ready);
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
        console.warn("[duel] series advance failed", error);
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
      if (!session.seriesId) return;
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
      console.warn("[duel] series follow-up failed", error);
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
    winnerSeat: number | null,
    reason: string,
  ): Promise<DuelFinalSnapshots> {
    const result = { winnerSeat, reason };
    return {
      public: freezeView(await game.view(null), result),
      seat0: freezeView(await game.view(0), result),
      seat1: freezeView(await game.view(1), result),
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
      snapshots = await captureSnapshots(game, winnerSeat, reason);
    } catch (error) {
      await disposeGame(slug);
      throw new RequestError(error instanceof Error ? error.message : "Duel engine is temporarily unavailable", 503);
    }
    service.complete(slug, guildId, winnerSeat, reason, snapshots);
    await disposeGame(slug);
    await emitChange(slug, guildId);
    await afterGameEnded(slug, guildId);
  }

  async function readClockView(game: DuelGameWorker): Promise<DecisionClockView> {
    const first = await game.view(0);
    if (first.result) return { turn: first.turn, promptSeat: null };
    if (first.prompt && isSeatIndex(first.prompt.seat)) {
      return { turn: first.turn, promptSeat: first.prompt.seat };
    }
    const second = await game.view(1);
    if (second.prompt && isSeatIndex(second.prompt.seat)) {
      return { turn: second.turn, promptSeat: second.prompt.seat };
    }
    return { turn: first.turn, promptSeat: null };
  }

  async function persistAcceptedCommand(
    slug: string,
    guildId: string,
    seat: number,
    command: DuelCommand,
    game: DuelGameWorker,
    decidedAt: number,
  ): Promise<void> {
    const view = await readClockView(game);
    const state = service.privateState(slug, guildId);
    const clock = syncDecisionClock(
      state.clock,
      view,
      state.session.settings.turnSeconds,
      decidedAt,
      now(),
      state.session.settings.timeout,
      isSeatIndex(seat) ? seat : undefined,
    );
    service.recordCommand(slug, guildId, seat, command, clock);
  }

  async function advancePracticeBot(slug: string, guildId: string, game: DuelGameWorker): Promise<void> {
    for (let step = 0; step < BOT_ADVANCE_LIMIT; step++) {
      const session = service.get(slug, guildId);
      if (session.status !== "active") return;
      const bot = session.seats.find((seat) => seat.isBot);
      if (!bot) return;
      const view = await game.view(bot.seat);
      if (view.result) return;
      const prompt = view.prompt;
      if (!prompt || prompt.seat !== bot.seat) return;

      let permittedCards;
      if (prompt.kind === "announce-card") {
        permittedCards = await game.search("");
      }
      let answer;
      try {
        answer = choosePracticeBotAnswer(prompt, { permittedCards });
      } catch (error) {
        const message = error instanceof PracticeBotError ? error.message : "Practice bot failed to choose";
        throw new RequestError(message, 500);
      }
      const command: DuelCommand = { promptId: prompt.id, revision: view.revision, answer };
      const decidedAt = now();
      try {
        await game.answer(bot.seat, prompt.id, answer);
      } catch (error) {
        throw new RequestError(error instanceof Error ? error.message : "Practice bot made an illegal choice", 500);
      }
      try {
        await persistAcceptedCommand(slug, guildId, bot.seat, command, game, decidedAt);
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
    await afterGameEnded(slug, guildId);
  }

  function startBotLoop(slug: string, guildId: string): void {
    if (stopped || botLoops.has(slug)) return;
    const loop: BotLoop = { cancelled: false, wake: null, done: Promise.resolve() };
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
        await botPause(loop, plan.delayMs);
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
    const bot = session.seats.find((seat) => seat.isBot);
    const entry = games.get(slug);
    if (session.status !== "active" || !bot || !entry?.game.running) {
      finish();
      return null;
    }
    const game = entry.game;
    let view: DuelEngineView;
    try {
      view = await game.view(bot.seat);
    } catch (error) {
      console.warn("[duel] practice bot could not read the duel", error);
      finish();
      await disposeGame(slug);
      return null;
    }
    if (view.result) {
      finish();
      try {
        await persistComplete(slug, guildId, game, view.result.winnerSeat, view.result.reason);
      } catch (error) {
        console.warn("[duel] could not record the finished duel", error);
      }
      return null;
    }
    const prompt = view.prompt;
    if (!prompt || prompt.seat !== bot.seat) {
      finish();
      return null;
    }
    let answer: DuelAnswer;
    try {
      const permittedCards = prompt.kind === "announce-card" ? await game.search("") : undefined;
      answer = choosePracticeBotAnswer(prompt, { permittedCards });
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
      promptId: prompt.id,
      revision: view.revision,
      answer,
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
    const bot = session.seats.find((seat) => seat.isBot);
    const entry = games.get(slug);
    if (session.status !== "active" || !bot || !entry?.game.running) {
      finish();
      return { kind: "stop" };
    }
    const game = entry.game;
    let before: DuelEngineView;
    try {
      before = await game.view(bot.seat);
    } catch (error) {
      console.warn("[duel] practice bot could not read the duel", error);
      finish();
      await disposeGame(slug);
      return { kind: "stop" };
    }
    if (before.result || before.prompt?.seat !== bot.seat) return { kind: "replan" };
    if (before.prompt.id !== plan.promptId || before.revision !== plan.revision) return { kind: "replan" };

    const command: DuelCommand = { promptId: plan.promptId, revision: plan.revision, answer: plan.answer };
    const decidedAt = now();
    try {
      await game.answer(bot.seat, plan.promptId, plan.answer);
    } catch (error) {
      finish();
      console.warn("[duel] practice bot answer was rejected", error);
      if (!game.running) await disposeGame(slug);
      else await interruptBrokenBot(slug, guildId, "The practice bot could not continue.");
      return { kind: "stop" };
    }
    try {
      await persistAcceptedCommand(slug, guildId, bot.seat, command, game, decidedAt);
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
      visible = newestEventId(await game.view(bot.seat)) > newestEventId(before);
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
      await afterGameEnded(slug, guildId);
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
        if (view.revision !== input.command.revision || view.prompt?.id !== input.command.promptId) {
          throw new ReplayMismatchError("Duel recovery did not reproduce the saved prompt");
        }
        try {
          await game.answer(input.seat, input.command.promptId, input.command.answer);
        } catch (error) {
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
        await afterGameEnded(slug, guildId);
        throw new RequestError(error.message, 409);
      }
      throw error;
    }
    games.set(slug, { game, lastRequestAt: now(), guildId });
    await driveBot(slug, guildId, game);
    return game;
  }

  async function settleClock(slug: string, guildId: string, game?: DuelGameWorker, at = now()): Promise<void> {
    const state = service.privateState(slug, guildId);
    if (state.session.status !== "active" || !state.clock) return;
    const clock = state.clock;
    if (!isClockDue(clock, at)) return;

    const expired = clock.activeSeat;
    if (expired !== null && state.session.seats.some((seat) => seat.seat === expired && seat.isBot)) {
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

    const winnerSeat = expired === 0 ? 1 : expired === 1 ? 0 : null;
    const live = game?.running ? game : await recover(slug, guildId);
    await persistComplete(slug, guildId, live, winnerSeat, TIME_LIMIT_REASON);
  }

  async function project(slug: string, guildId: string, playerId: number, game?: DuelGameWorker): Promise<DuelRoom> {
    const room = stampRoomClock(service.room(slug, guildId, playerId), now());
    if (game && game.running && room.session.status === "active") {
      room.engine = await game.view(room.mySeat);
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
    return { ...view, prompt: null, prioritySeat: null, log, events };
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
        await game.create(workerCreateOptions(session.mode, state.decks, state.seed, session.masterRule, session.settings));
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
          if (before.revision !== input.command.revision || before.prompt?.id !== input.command.promptId) throw mismatch();
          try {
            await game.answer(input.seat, input.command.promptId, input.command.answer);
          } catch (error) {
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
            prioritySeat: null,
            log: [],
            events: [],
            result: { winnerSeat: session.winnerSeat, reason: session.resultReason ?? "Duel ended" },
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

  /** Starts a lobby game. `organizer` null is a system start, which the duel service only allows for a series game. */
  /** The checks every start makes: a lobby duel, two ready seats, two legal decks. */
  function assertStartable(slug: string, guildId: string) {
    const session = service.get(slug, guildId);
    if (session.status !== "lobby") throw new RequestError("Duel already started", 409);
    if (!bothSeatsReady(session)) {
      throw new RequestError("Two players must submit valid decks before starting", 409);
    }
    const state = service.privateState(slug, guildId);
    const settings = state.session.settings;
    for (const deck of state.decks) validateSessionDeck(state.session.mode, deck, settings);
    return { session, state, settings };
  }

  async function startGame(slug: string, guildId: string, organizer: number | null): Promise<DuelGameWorker> {
    const { state, settings } = assertStartable(slug, guildId);
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
      ));
      const clock = startDecisionClock(await readClockView(game), settings.turnSeconds, now());
      service.activate(slug, guildId, organizer, seed, manifest.bundleVersion, clock);
      games.set(slug, { game, lastRequestAt: now(), guildId });
      await emitChange(slug, guildId);
      await driveBot(slug, guildId, game);
      return game;
    } catch (error) {
      games.delete(slug);
      await safeClose(game);
      throw error;
    }
  }

  function clearOpeningTimer(slug: string): void {
    const timer = openingTimers.get(slug);
    if (timer === undefined) return;
    openingTimers.delete(slug);
    clearTimeout(timer);
  }

  /**
   * The practice bot chooses first or second only after the reveal of the round it won, so the human sees both
   * hands and the result before the duel starts.
   */
  function botChoiceAt(winnerSeat: 0 | 1 | null, deadline: number, seats: ReadonlyArray<{ seat: number; isBot: boolean }>): number | null {
    if (winnerSeat === null || !seats.some((seat) => seat.isBot && seat.seat === winnerSeat)) return null;
    return deadline - DUEL_OPENING_PICK_MS;
  }

  /** Fires `driveOpening` at the phase deadline, or when the bot's choice is due. A running timer for the slug is replaced. */
  function scheduleOpening(slug: string, guildId: string, state: DuelOpeningState): void {
    clearOpeningTimer(slug);
    if (stopped || state.phase === "start") return;
    let wakeAt = state.deadline;
    if (state.phase === "choose") {
      const botAt = botChoiceAt(state.winnerSeat, state.deadline, service.get(slug, guildId).seats);
      if (botAt !== null && botAt > now()) wakeAt = botAt;
    }
    const timer = setTimeout(() => {
      openingTimers.delete(slug);
      void enqueue(slug, () => driveOpening(slug, guildId)).catch((error) => {
        console.warn("[duel] opening step failed", error);
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
    if (stopped) return;
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
          // The bot always takes the first turn, once the reveal of its win is over.
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
    await emitChange(slug, guildId);
    // The seats are in their final order. A failed start of a series game is retried by the tick sweep.
    try {
      await startGame(slug, guildId, state.startedBy);
      startBackoff.delete(slug);
    } catch (error) {
      const session = service.get(slug, guildId);
      if (!session.seriesId && session.status === "lobby") {
        // Nobody retries a start for a table. Give the lobby back to its players, and show them the error.
        service.abortOpening(slug, guildId);
        const reason = error instanceof Error ? error.message : String(error);
        console.warn(`[duel] duel ${slug} did not start after the opening: ${reason}`);
        await emitChange(slug, guildId);
        throw error;
      }
      noteStartFailure(slug, error);
      await emitChange(slug, guildId);
      if (error instanceof DeckLegalityError || error instanceof RequestError) throw error;
    }
  }

  /**
   * Starts a lobby duel with two ready seats. Game 1 of a duel or match goes through the rock-paper-scissors opening
   * first (when enabled); every other game starts at once. Returns the live game, or null while the opening runs.
   */
  async function beginGame(slug: string, guildId: string, actor: number | null): Promise<DuelGameWorker | null> {
    const existing = service.openingState(slug, guildId);
    if (existing) {
      // A settled opening waits only for the duel to start; a running one waits for the players.
      await driveOpening(slug, guildId);
      return games.get(slug)?.game ?? null;
    }
    const { session } = assertStartable(slug, guildId);
    if (!options.openingRps || (session.gameNumber ?? 1) > 1) return startGame(slug, guildId, actor);
    service.startOpening(slug, guildId, actor ?? session.organizerPlayerId, now());
    await driveOpening(slug, guildId);
    return games.get(slug)?.game ?? null;
  }

  /** Runs inside the duel queue. Starts a series game that sits in lobby with both seats ready. */
  async function startReadyGame(slug: string, guildId: string): Promise<boolean> {
    if (stopped) return false;
    const session = service.get(slug, guildId);
    if (session.status !== "lobby" || !session.seriesId || !bothSeatsReady(session)) return false;
    await beginGame(slug, guildId, null);
    return true;
  }

  /**
   * Runs inside the duel queue after a deck or ready change: a series game with two ready seats starts at once.
   * A deck problem goes back to the caller; an engine failure is retried by the tick sweep.
   */
  async function autoStart(slug: string, guildId: string, session: DuelSession): Promise<DuelSession> {
    if (!session.seriesId || session.status !== "lobby" || !bothSeatsReady(session)) return session;
    try {
      await beginGame(slug, guildId, null);
    } catch (error) {
      if (error instanceof DeckLegalityError) throw error;
      console.warn("[duel] could not start the series game yet", error);
      return session;
    }
    return service.get(slug, guildId);
  }

  /** Records a failed start of a series game and logs it once. The tick sweep skips the slug for a growing wait. */
  function noteStartFailure(slug: string, error: unknown): void {
    const failures = (startBackoff.get(slug)?.failures ?? 0) + 1;
    const waitMs = START_BACKOFF_MS[Math.min(failures, START_BACKOFF_MS.length) - 1]!;
    startBackoff.set(slug, { failures, retryAt: now() + waitMs });
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`[duel] series game ${slug} did not start (attempt ${failures}, next retry in ${waitMs / 1000}s): ${reason}`);
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
    }
    if (step.tournamentSlug) await emitTournament("match-updated", step.tournamentSlug);
    return step.next;
  }

  async function operate(body: Record<string, unknown>): Promise<unknown> {
    const { op, guildId, playerId } = body;
    if (typeof guildId !== "string" || !guildId || !Number.isSafeInteger(playerId) || (playerId as number) <= 0) {
      throw new RequestError("Authenticated guild and player are required", 400);
    }
    const actor = playerId as number;
    if (op === "card-details") {
      if (!Array.isArray(body.codes) || body.codes.length > 1000
        || body.codes.some((code) => !Number.isSafeInteger(code) || code <= 0 || code > 0xffffffff)) {
        throw new RequestError("Provide at most 1000 positive card passcodes", 400);
      }
      const catalog = loadCardDatabase(options.dataDirectory);
      const cards = [];
      const missing: number[] = [];
      for (const code of new Set<number>(body.codes)) {
        const card = catalog.deckCard(code);
        if (card) cards.push(card);
        else missing.push(code);
      }
      return { cards, missing };
    }
    if (op === "normalize-codes") {
      if (!Array.isArray(body.codes) || body.codes.length > 1000
        || body.codes.some((code) => !Number.isSafeInteger(code) || code <= 0 || code > 0xffffffff)) {
        throw new RequestError("Provide at most 1000 positive card ids", 400);
      }
      const codes = await normalizeCardCodes(body.codes as number[], options.dataDirectory, options.db);
      return { codes: Object.fromEntries(codes) };
    }
    if (op === "check-deck") {
      const mode = body.mode;
      if (mode !== "normal" && mode !== "domain") throw new RequestError("Duel mode must be normal or domain", 400);
      if (body.masterRule !== undefined && ![1, 2, 3, 4, 5].includes(body.masterRule as number)) {
        throw new RequestError("Unknown master rule", 400);
      }
      const settings = normalizeDuelSettings(mode, body.settings);
      const deck = await normalizeImportedDeck(body.deck as DuelDeck, options.dataDirectory, options.db, { keepUnresolved: true });
      return { deck, report: inspectDeck(mode, deck, options.dataDirectory, settings) };
    }
    if (op === "card-query") {
      try {
        return queryCards(loadCardDatabase(options.dataDirectory), parseCardQuery(body.cardQuery));
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
      // A timeout that no timer caught yet (a restart, a late timer) is applied here.
      if (room.session.status === "lobby" && room.opening) {
        const deadline = Date.parse(room.opening.deadlineAt);
        const botAt = room.opening.phase === "choose" ? botChoiceAt(room.opening.winnerSeat, deadline, room.session.seats) : null;
        if (deadline <= now() || (botAt !== null && botAt <= now())) await driveOpening(slug, guildId);
      }
      if (service.get(slug, guildId).status === "active") {
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
      validateSessionDeck(room.session.mode, deck, settings);
      const session = service.addPracticeBot(slug, guildId, actor, deck);
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
      service.cancel(slug, guildId, actor);
      clearOpeningTimer(slug);
      await emitChange(slug, guildId);
      return project(slug, guildId, actor);
    }
    if (op === "replay") return replay(slug, guildId, room);
    if (op === "series-side" || op === "series-ready" || op === "series-unready" || op === "series-first") {
      const seriesId = room.session.seriesId ?? null;
      if (seriesId === null) throw new RequestError("This duel is not part of a series", 409);
      const info = series.get(seriesId, guildId);
      if (!info.playerIds.includes(actor)) throw new RequestError("Only the players of this series can do that", 403);
      if (op === "series-side") {
        if (info.status !== "between_games") throw new RequestError("Side decking is only open between games", 409);
        // Same setting as check-deck: a code the card data cannot resolve stays as it is, so the
        // "same cards" check in setSideDeck compares like with like. validateSessionDeck still rejects it.
        const deck = await normalizeImportedDeck(body.deck as DuelDeck, options.dataDirectory, options.db, { keepUnresolved: true });
        validateSessionDeck(room.session.mode, deck, room.session.settings);
        // `info` is read before the await above, so a Ready sent meanwhile (through another game slug)
        // is not in it: the transaction reports whether this save cleared Ready.
        const saved = series.saveSideDeck(seriesId, guildId, actor, deck);
        // A changed deck clears this player's Ready: refresh both players' views so the room shows it.
        if (saved.readyCleared) await emitChange(saved.series.currentDuelSlug ?? slug, guildId);
        return { series: saved.series };
      }
      if (op === "series-first") {
        if (!isFirstChoice(body.choice)) throw new RequestError("Choose first or second", 400);
        if (info.status !== "between_games") throw new RequestError("The series is not between games", 409);
        const updated = series.setFirstChoice(seriesId, guildId, actor, body.choice);
        await emitChange(updated.currentDuelSlug ?? slug, guildId);
        const advanced = isSeriesDue(updated, now()) ? await advanceSeries(seriesId, guildId) : null;
        const latest = series.get(seriesId, guildId);
        const nextSlug = advanced
          ?? (latest.status === "active" && latest.currentDuelSlug !== slug ? latest.currentDuelSlug : null);
        return { series: latest, nextSlug };
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
      const updated = series.setSideReady(seriesId, guildId, actor);
      await emitChange(updated.currentDuelSlug ?? slug, guildId);
      const advanced = isSeriesDue(updated, now()) ? await advanceSeries(seriesId, guildId) : null;
      const latest = series.get(seriesId, guildId);
      const nextSlug = advanced
        ?? (latest.status === "active" && latest.currentDuelSlug !== slug ? latest.currentDuelSlug : null);
      return { series: latest, nextSlug };
    }
    if (room.mySeat === null) throw new RequestError("Join this duel first", 403);
    const seat = room.mySeat;
    if (op === "ready") {
      if (room.session.status !== "lobby") throw new RequestError("Decks are locked after the duel starts", 409);
      const session = service.markReady(slug, guildId, actor);
      await emitChange(slug, guildId);
      return { session: await autoStart(slug, guildId, session) };
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
      const deck = await normalizeImportedDeck(body.deck as DuelDeck, options.dataDirectory, options.db, {
        keepUnresolved: op === "validate-deck",
      });
      if (op === "validate-deck") {
        return inspectDeck(room.session.mode, deck, options.dataDirectory, settings);
      }
      validateSessionDeck(room.session.mode, deck, settings);
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
    if (op === "surrender") {
      const game = await recover(slug, guildId);
      await settleClock(slug, guildId, game);
      const current = await project(slug, guildId, actor, games.get(slug)?.game);
      if (current.session.status !== "active") return current;
      const opponent = room.session.seats.find((entry) => entry.seat !== seat);
      if (!opponent) throw new RequestError("Opponent is missing", 409);
      await persistComplete(slug, guildId, games.get(slug)?.game ?? game, opponent.seat, "Surrender");
      return project(slug, guildId, actor);
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
    try {
      // Timed-out openings, settled openings whose duel has not started yet, and a timer for those still running.
      for (const due of service.dueOpenings(t + pollIntervalMs, SERIES_SWEEP_LIMIT)) {
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
          console.warn("[duel] opening sweep failed", error);
        }
      }
    } catch (error) {
      console.warn("[duel] opening sweep failed", error);
    }
    if (stopped) return;
    try {
      for (const due of series.dueNextGames(t, SERIES_SWEEP_LIMIT)) {
        if (stopped) return;
        try {
          await advanceSeries(due.seriesId, due.guildId, t);
        } catch (error) {
          console.warn("[duel] series advance sweep failed", error);
        }
      }
      // An entry no sweep touched for a full backoff cap belongs to a game that is gone.
      const cap = START_BACKOFF_MS[START_BACKOFF_MS.length - 1]!;
      for (const [slug, entry] of startBackoff) {
        if (t - entry.retryAt > cap) startBackoff.delete(slug);
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
      console.warn("[duel] series sweep failed", error);
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
        return Response.json(await enqueue(key, () => operate(body)), { headers: { "cache-control": "no-store" } });
      } catch (error) {
        const status = error instanceof Error && "status" in error && typeof error.status === "number" ? error.status : 400;
        return Response.json({ error: error instanceof Error ? error.message : "Duel request failed" }, { status });
      }
    },
    async close(): Promise<void> {
      stopped = true;
      clearInterval(timer);
      for (const seriesId of [...advanceTimers.keys()]) clearAdvanceTimer(seriesId);
      for (const slug of [...openingTimers.keys()]) clearOpeningTimer(slug);
      const loops = [...botLoops.values()];
      for (const slug of [...botLoops.keys()]) cancelBotLoop(slug);
      await Promise.allSettled([...queues.values(), ...loops.map((loop) => loop.done)]);
      await Promise.all([...games.values()].map((entry) => safeClose(entry.game)));
      games.clear();
      replayCache.clear();
    },
  };
}
