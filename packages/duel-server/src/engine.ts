import type { DuelAnswer, DuelBattleStep, DuelCardInfo, DuelDeck, DuelEngineView, DuelFormat, DuelMasterRule, DuelMode, DuelSettings } from "@yugidraft/shared/duels";
import { partnerSeatOf, seatCountFor, seatsOfTeam, startingLpFor, teamOfSeat } from "@yugidraft/shared/duels";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import createCore, {
  OcgDuelMode,
  OcgHintType,
  OcgLocation,
  OcgLogType,
  OcgMessageType,
  OcgPosition,
  OcgProcessResult,
  OcgType,
  cardMatchesOpcode,
  type OcgCardData,
  type OcgCoreSync,
  type OcgDuelHandle,
  type OcgMessage,
  type OcgOpCode,
} from "ocgcore-wasm";
import { isOptionalCardScript, loadCardDatabase, type CardDatabase } from "./cards.js";
import { EngineAnswerError, HINT_PLACE_SEAT, autoResponse, isWaitingMessage, mapPrompt, nextLivingOpponentSeat, placeSeatHint, recallPromptContext, resolveAnswer, type PendingPrompt } from "./prompts.js";
import {
  DOMAIN_RECALL_DESC,
  LOCATION_DECKMASTER,
  clearRevealsAt,
  createEventContext,
  createRevealMap,
  DESTROY_NOTE_SCRIPT,
  drainDeferredDestroys,
  isNoDuelist,
  moveReveals,
  nextBattleStep,
  noteDestroyLog,
  noteReveal,
  observeDuelEvent,
  observeMoveEvents,
  phaseName,
  playerLabel,
  projectView,
  resetEventBatch,
  type DomainSeatState,
  type LogEntry,
  type StoredChainLink,
  type StoredDuelEvent,
} from "./views.js";
import { createDomainCore } from "./domain-core.js";
import { chooseSurrenderedAnswer } from "./practice-bot.js";
import { MSG_ATTACK_DUELIST, MSG_DUELIST_ELIMINATED, MSG_FIELD_DISABLED_N, parseDuelistMessages, rawMessageCapture, withoutDuelistParseWarnings, type RawDuelistMessage } from "./raw-messages.js";
import { MP_UTILITY_FILE, loadMultiScriptsFor } from "./multi-scripts.js";
import { fillPlaceholders } from "./text.js";
import { firstTurnDrawFor } from "./first-turn-draw.js";

/** A wasm the engine loaded: the bytes, the file name and the sha256 of the bytes (core identity for reports). */
export interface LoadedWasm {
  binary: ArrayBuffer;
  file: string;
  sha: string;
}

export interface EngineCoreInfo {
  /** sha256 of the wasm this game loaded. */
  wasmSha: string;
  /** File name of that wasm (`(provided binary)` for a test hook). */
  wasmFile: string;
  /** `duelProcess` calls since the last prompt was shown. */
  callsSinceLastPrompt: number;
  /** Messages the core emitted since the last prompt was shown. */
  messagesSinceLastPrompt: number;
}

const PROVIDED_WASM = "(provided binary)";

function describeWasm(binary: ArrayBuffer, file: string): LoadedWasm {
  return { binary, file, sha: createHash("sha256").update(new Uint8Array(binary)).digest("hex") };
}

function loadWasmFile(path: string): LoadedWasm {
  const bytes = readFileSync(path);
  return describeWasm(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, basename(path));
}

/**
 * Standard duels run the pinned ygopro-core with only the shared bug fixes in
 * domain-core/src/apply-core-fixes.mjs (stock rules, no Domain patch). The npm
 * ocgcore-wasm core is older than the pinned card scripts, so it is never used.
 */
function readStandardWasm(dataDirectory: string): LoadedWasm {
  const path = join(dataDirectory, "ocgcore.standard.wasm");
  if (!existsSync(path)) {
    throw new Error(
      `Standard wasm is missing at ${path}. Build it with docker.io/emscripten/emsdk:4.0.9 and packages/duel-server/scripts/build-standard-core.sh (or: npx tsx packages/duel-server/scripts/build-domain-core.ts standard)`,
    );
  }
  return loadWasmFile(path);
}

/**
 * Duels with more than two seats run the multi-duelist core (`ocgcore.multi.wasm`, or
 * `ocgcore.multi-domain.wasm` for Domain) from the data directory.
 */
function readMultiWasm(dataDirectory: string, mode: DuelMode): LoadedWasm {
  const name = mode === "domain" ? "ocgcore.multi-domain.wasm" : "ocgcore.multi.wasm";
  const path = join(dataDirectory, name);
  if (!existsSync(path)) {
    const build =
      mode === "domain"
        ? "APPLY_DOMAIN=1 DOMAIN_MULTI=1 OUT_NAME=ocgcore.multi-domain.sync.wasm bash packages/duel-server/scripts/build-multi-core.sh (in docker.io/emscripten/emsdk:4.0.9)"
        : "packages/duel-server/scripts/build-multi-core.sh";
    throw new Error(
      `Multi-duelist wasm is missing at ${path}. Build it with ${build} and install it in the engine data directory (Tag and free-for-all duels need it).`,
    );
  }
  return loadWasmFile(path);
}

export interface EngineGameOptions {
  mode: DuelMode;
  decks: DuelDeck[];
  seed: string[];
  dataDirectory: string;
  masterRule?: DuelMasterRule;
  settings?: DuelSettings;
  /** Seat and team layout. Default `1v1`. `decks` has one entry per seat (`seatCountFor(format)`). */
  format?: DuelFormat;
  /** Saved FIRST_TURN_DRAW flag for recovery/replay. Omit only when starting a new duel. */
  firstTurnDraw?: boolean;
  /**
   * Lua chunks run after the Decks (and Domain Deck Masters) exist and before the Duel starts.
   * Tests use them to place an exact board with `Debug.AddCard` without playing turns.
   * Production callers leave this unset.
   */
  startupScripts?: EngineStartupScript[];
  /**
   * Test hook: run Standard duels on this wasm instead of `ocgcore.standard.wasm` from the data
   * directory. The differential tests use it to compare cores. Production callers leave this unset.
   */
  standardWasmBinary?: ArrayBuffer;
  /**
   * Test hook for formats with more than two seats: run on this multi-duelist wasm (the Domain variant
   * when `mode` is "domain") instead of the file in the data directory.
   */
  multiWasmBinary?: ArrayBuffer;
  /**
   * Test hook for formats with more than two seats: read the Lua overlay (mp-utility.lua, card suffixes) from this
   * folder instead of the lookup in src/multi-scripts.ts. A 1v1 duel never reads an overlay. Production callers leave this unset.
   */
  multiScriptsDirectory?: string;
}

export interface EngineStartupScript {
  name: string;
  content: string;
}

/** One line of the triage ring buffer. Never shown to a player: only the host report reads it. */
export interface EngineDiagnostic {
  turn: number;
  phase: string;
  /** `response` (a MSG_SELECT_CHAIN prompt), `msg200`, `msg201`, `msg202`, `win`, `win-ignored`, `eliminate`, `stderr` (a core log line). */
  kind: string;
  /** The seat the entry is about, or null. */
  seat: number | null;
  detail: string;
}

/** The core may repeat MSG_WIN after the win: only the first one counts. True while no result is held. */
export function acceptsResult(current: DuelEngineView["result"]): boolean {
  return current == null;
}

/**
 * A host loss uses `eliminate:<reason>` for the current Adjust rule, or `eliminate-eot:<reason>`
 * for a surrender at the end of the turn. Old commands keep their timing. Returns the code, or null for an ordinary answer. Every journal replayer uses this.
 */
export const ELIMINATE_PROMPT_PREFIX = "eliminate:";
export const ELIMINATE_EOT_PROMPT_PREFIX = "eliminate-eot:";
/** True only for a saved surrender that takes effect at the end of the turn. */
export function eliminationAtTurnEnd(promptId: string): boolean {
  return promptId.startsWith(ELIMINATE_EOT_PROMPT_PREFIX);
}
export function eliminationCodeOf(promptId: string): number | null {
  const prefix = eliminationAtTurnEnd(promptId) ? ELIMINATE_EOT_PROMPT_PREFIX : ELIMINATE_PROMPT_PREFIX;
  if (!promptId.startsWith(prefix)) return null;
  const code = Number(promptId.slice(prefix.length));
  return Number.isInteger(code) && code >= 0 ? code : null;
}

/** Entries the ring buffer keeps. */
export const DIAGNOSTICS_LIMIT = 200;

export interface EngineGame {
  view(seat: number | null): DuelEngineView;
  answer(seat: number, promptId: string, answer: DuelAnswer): void;
  searchCards(query: string): DuelCardInfo[];
  /**
   * Eliminate a duelist (FFA surrender). Runs `Debug.EliminateDuelist(seat, reason)` between process calls.
   * The core applies the loss at its next Adjust, so the loss is not instant:
   * - The open prompt belongs to the leaving seat (or its Tag team): the engine answers for it (a pass, or the
   *   first legal choice) until the core reports the loss. Those answers are not journaled; replay repeats them.
   * - The open prompt belongs to another seat: that prompt stays open, the view marks the seat with
   *   `pendingElimination`, and the loss lands after that seat answers.
   * With `atTurnEnd`, queue the loss until EVENT_TURN_END. Keep the current prompt and seat alive.
   * The host saves its pass answers as journal commands. Do not flag a core loss before the event.
   * Throws when the core has no such function (or the duel has fewer than three seats).
   */
  eliminate(seat: number, reason: number, atTurnEnd?: boolean): void;
  /** The last entries (oldest first) of the triage ring buffer. For the host report only, never for a view. */
  diagnostics(): EngineDiagnostic[];
  /** Core identity (wasm sha and file) and the counters since the last prompt. For reports and triage only. */
  coreInfo(): EngineCoreInfo;
  close(): void;
}

export type DomainCoreFactory = (ctx: {
  createStockCore: typeof createCore;
  dataDirectory: string;
  seed: [bigint, bigint, bigint, bigint];
  decks: DuelDeck[];
  flags: bigint;
  team1: { startingLP: number; startingDrawCount: number; drawCountPerTurn: number };
  team2: { startingLP: number; startingDrawCount: number; drawCountPerTurn: number };
  cardReader: (code: number) => OcgCardData | null;
  scriptReader: (name: string) => string | null;
  errorHandler: (type: number, text: string) => void;
  wasmBinary?: Uint8Array;
}) => Promise<{
  lib: OcgCoreSync;
  handle: OcgDuelHandle;
  getDomainState: () => DomainSeatState[];
}>;

let domainCoreFactory: DomainCoreFactory | null = null;

export function registerDomainCoreFactory(factory: DomainCoreFactory): void {
  domainCoreFactory = factory;
}
registerDomainCoreFactory(createDomainCore);

export function parseSeed(seed: string[]): [bigint, bigint, bigint, bigint] {
  if (seed.length !== 4) throw new Error("Seed must be exactly 4 nonzero decimal uint64 strings");
  const values = seed.map((part) => {
    if (!/^[0-9]+$/.test(part)) throw new Error("Seed must be exactly 4 nonzero decimal uint64 strings");
    const value = BigInt(part);
    if (value === 0n || value > 0xffffffffffffffffn) throw new Error("Seed must be exactly 4 nonzero decimal uint64 strings");
    return value;
  });
  return values as [bigint, bigint, bigint, bigint];
}

const MASTER_RULE_FLAGS: Record<DuelMasterRule, bigint> = {
  1: OcgDuelMode.MODE_MR1,
  2: OcgDuelMode.MODE_MR2,
  3: OcgDuelMode.MODE_MR3,
  4: OcgDuelMode.MODE_MR4,
  5: OcgDuelMode.MODE_MR5,
};

function duelFlagsFor(masterRule?: DuelMasterRule): bigint {
  const rule = masterRule ?? 5;
  if (rule !== 1 && rule !== 2 && rule !== 3 && rule !== 4 && rule !== 5) {
    throw new Error(`Unknown master rule ${String(rule)}`);
  }
  return MASTER_RULE_FLAGS[rule];
}

function engineStartConfig(settings?: DuelSettings): {
  startingLP: number;
  startingDrawCount: number;
  drawCountPerTurn: number;
  shuffle: boolean;
} {
  return {
    startingLP: settings?.startingLP ?? 8000,
    startingDrawCount: settings?.startingHand ?? 5,
    drawCountPerTurn: settings?.drawPerTurn ?? 1,
    shuffle: settings?.shuffleDeck ?? true,
  };
}

function addDeck(lib: OcgCoreSync, handle: OcgDuelHandle, seat: number, deck: DuelDeck, importedOrder: boolean) {
  const team = seat as 0 | 1;
  // sequence 0 push_back: last added card is deck top (drawn first). Reverse so imported[0] is top.
  const main = importedOrder ? [...deck.main].reverse() : deck.main;
  for (const code of main) {
    lib.duelNewCard(handle, {
      team,
      duelist: 0,
      code,
      controller: team,
      location: OcgLocation.DECK,
      sequence: 0,
      position: OcgPosition.FACEDOWN_DEFENSE,
    });
  }
  for (const code of deck.extra) {
    lib.duelNewCard(handle, {
      team,
      duelist: 0,
      code,
      controller: team,
      location: OcgLocation.EXTRA,
      sequence: 0,
      position: OcgPosition.FACEDOWN_DEFENSE,
    });
  }
}

// Pendulum Zones are Spell & Trap sequences 0 and 4 under Master Rule 4/5, and 6 and 7 under Master Rule 3.
const PENDULUM_ZONE_SEQUENCES = new Set([0, 4, 6, 7]);

/**
 * A Pendulum Summon is offered as the Special Summon action of a Pendulum card in a Pendulum Zone
 * (a Pendulum Zone sequence of the Spell & Trap Zone, or the LOCATION_PZONE flag). The summons it produces are then "pendulum".
 */
export function isPendulumSummonAnswer(pending: PendingPrompt, answer: DuelAnswer): boolean {
  if (pending.message.type !== OcgMessageType.SELECT_IDLECMD || !answer.choice?.startsWith("spsummon:")) return false;
  const option = pending.prompt.options.find((entry) => entry.id === answer.choice);
  if (!option || option.location == null) return false;
  if ((option.location & OcgLocation.PZONE) !== 0) return true;
  if (option.location !== OcgLocation.SZONE || !PENDULUM_ZONE_SEQUENCES.has(option.sequence ?? -1)) return false;
  return ((option.card?.type ?? 0) & OcgType.PENDULUM) !== 0;
}

function loadScriptOrThrow(lib: OcgCoreSync, handle: OcgDuelHandle, cards: CardDatabase, name: string) {
  const content = cards.readScript(name);
  if (!content) throw new Error(`Required script missing: ${name}`);
  if (!lib.loadScript(handle, name, content)) throw new Error(`Failed to load script ${name}`);
}

export async function createEngineGame(options: EngineGameOptions): Promise<EngineGame> {
  const format: DuelFormat = options.format ?? "1v1";
  const seatCount = seatCountFor(format);
  const multi = seatCount > 2;
  if (options.decks.length !== seatCount) {
    throw new Error(multi ? `Exactly ${seatCount} decks are required for a ${format} duel` : "Exactly two decks are required");
  }
  const start = engineStartConfig(options.settings);
  const firstTurnDraw = options.firstTurnDraw ?? firstTurnDrawFor(options.mode, options.masterRule);
  const flags = (duelFlagsFor(options.masterRule) & ~OcgDuelMode.FIRST_TURN_DRAW)
    | (firstTurnDraw ? OcgDuelMode.FIRST_TURN_DRAW : 0n);
  const seed = parseSeed(options.seed);
  const cards = loadCardDatabase(options.dataDirectory);
  // Duels with more than two seats read the Lua overlay. 1v1 gets none, so its script text stays the original.
  const overlay = multi ? loadMultiScriptsFor(options.dataDirectory, options.multiScriptsDirectory) : undefined;
  const errors: string[] = [];
  const eventContext = createEventContext(format);
  const cardReader = (code: number) => {
    if (!code) return null;
    return cards.cardData(code);
  };
  const scriptReader = (name: string) => {
    const content = cards.readScript(name, overlay);
    if (!content && !isOptionalCardScript(name, cards.cardData)) errors.push(`Missing script ${name}`);
    return content;
  };
  const errorHandler = (type: number, text: string) => {
    if (noteDestroyLog(eventContext, text)) return;
    if (type === OcgLogType.ERROR || type === OcgLogType.UNDEFINED) errors.push(text);
  };
  const team = {
    // Tag: one LP total per team, so the core gets the team starting LP.
    startingLP: startingLpFor(format, { startingLP: start.startingLP }),
    startingDrawCount: start.startingDrawCount,
    drawCountPerTurn: start.drawCountPerTurn,
  };

  let lib: OcgCoreSync;
  let handle: OcgDuelHandle;
  let getDomainState: (() => DomainSeatState[]) | undefined;
  // Raw message tap: the wrapper drops the multi-duelist messages (ids 200 and 201), so the engine reads them itself.
  let tap: ReturnType<typeof rawMessageCapture> | null = null;
  let multiWasm: ArrayBuffer | null = null;
  let loaded: LoadedWasm;
  if (multi) {
    const multiLoaded = options.multiWasmBinary ? describeWasm(options.multiWasmBinary, PROVIDED_WASM) : readMultiWasm(options.dataDirectory, options.mode);
    loaded = multiLoaded;
    multiWasm = multiLoaded.binary;
    tap = rawMessageCapture(multiWasm);
  } else if (options.mode === "domain") {
    const domainPath = join(options.dataDirectory, "ocgcore.domain.wasm");
    loaded = existsSync(domainPath) ? loadWasmFile(domainPath) : describeWasm(new ArrayBuffer(0), "ocgcore.domain.wasm (missing)");
  } else {
    loaded = options.standardWasmBinary ? describeWasm(options.standardWasmBinary, PROVIDED_WASM) : readStandardWasm(options.dataDirectory);
  }
  // Core log lines (stderr of the wasm, e.g. YGO_N_TRAP_LOG census lines) go into the diagnostics ring.
  const earlyStderr: string[] = [];
  let stderrSink: ((text: string) => void) | null = null;
  const printErr = (text: string) => {
    if (stderrSink) stderrSink(text);
    else earlyStderr.push(text);
  };
  const tapOptions = { printErr, ...(tap ? { instantiateWasm: tap.instantiateWasm } : {}) };

  if (options.mode === "domain") {
    if (!domainCoreFactory) throw new Error("Domain core is not registered");
    const created = await domainCoreFactory({
      createStockCore: ((coreOptions: object) => createCore({ ...coreOptions, ...tapOptions } as never)) as unknown as typeof createCore,
      dataDirectory: options.dataDirectory,
      seed,
      decks: options.decks,
      flags,
      team1: team,
      team2: team,
      cardReader,
      scriptReader,
      errorHandler,
      ...(multiWasm ? { wasmBinary: new Uint8Array(multiWasm) } : {}),
    });
    lib = created.lib;
    handle = created.handle;
    if (!created.getDomainState) throw new Error("Domain core did not provide getDomainState");
    getDomainState = created.getDomainState;
  } else {
    lib = await createCore({
      sync: true,
      wasmBinary: multiWasm ?? loaded.binary,
      ...tapOptions,
    } as Parameters<typeof createCore>[0]) as OcgCoreSync;
    const created = lib.createDuel({
      flags,
      seed,
      team1: team,
      team2: team,
      cardReader,
      scriptReader,
      errorHandler,
    });
    if (!created) throw new Error("Failed to create duel");
    handle = created;
  }

  try {
    if (multi) {
      // Before any card exists: the core changes its duelist count and teams here (PLAN.md, ABI decision).
      const teams = Array.from({ length: seatCount }, (_, seat) => teamOfSeat(format, seat));
      if (!lib.loadScript(handle, "duel-setup-duelists.lua", `Debug.SetupDuelists(${seatCount},${teams.join(",")})`)) {
        throw new Error(`Failed to set up ${seatCount} duelists (does the core have Debug.SetupDuelists?)${errors.length > 0 ? `: ${errors.join("; ")}` : ""}`);
      }
    }
    loadScriptOrThrow(lib, handle, cards, "constant.lua");
    loadScriptOrThrow(lib, handle, cards, "utility.lua");
    if (!lib.loadScript(handle, "duel-events.lua", DESTROY_NOTE_SCRIPT)) throw new Error("Failed to register destruction reporter");
    if (options.mode === "domain") loadScriptOrThrow(lib, handle, cards, "domain.lua");
    // After utility.lua and domain.lua, before any card exists. The overlay is never loaded at 1v1.
    if (overlay && !lib.loadScript(handle, MP_UTILITY_FILE, overlay.utility)) {
      throw new Error(`Failed to load ${MP_UTILITY_FILE}${errors.length > 0 ? `: ${errors.join("; ")}` : ""}`);
    }
    if (options.mode === "domain") {
      // Card creation runs initial_effect; procedure libraries must be loaded first.
      for (let teamSeat = 0; teamSeat < seatCount; teamSeat += 1) {
        const code = options.decks[teamSeat]!.deckMaster;
        if (!code) throw new Error(`Seat ${teamSeat} is missing a Deck Master`);
        lib.duelNewCard(handle, {
          team: teamSeat as 0 | 1,
          duelist: 0,
          code,
          controller: teamSeat as 0 | 1,
          location: LOCATION_DECKMASTER as OcgLocation,
          sequence: 0,
          position: OcgPosition.FACEUP_ATTACK,
        });
      }
    }
    for (let seat = 0; seat < seatCount; seat += 1) addDeck(lib, handle, seat, options.decks[seat]!, !start.shuffle);
    for (const script of options.startupScripts ?? []) {
      if (!lib.loadScript(handle, script.name, script.content)) {
        throw new Error(`Failed to run startup script ${script.name}${errors.length > 0 ? `: ${errors.join("; ")}` : ""}`);
      }
    }
    // Opening shuffle is only this EVENT_STARTUP ShuffleDeck. DUEL_PSEUDO_SHUFFLE is not used:
    // field.cpp applies it to every later deck/extra shuffle. EnableGlobalFlag is a noop here;
    // Debug.ReloadFieldBegin writes flags but also clears the duel.
    if (start.shuffle) {
      if (!lib.loadScript(handle, "duel-startup.lua", `
      local e=Effect.GlobalEffect()
      e:SetType(EFFECT_TYPE_FIELD|EFFECT_TYPE_CONTINUOUS)
      e:SetCode(EVENT_STARTUP)
      e:SetOperation(function(effect)
${Array.from({ length: seatCount }, (_, seat) => `        Duel.ShuffleDeck(${seat})`).join("\n")}
        effect:Reset()
      end)
      Duel.RegisterEffect(e,0)
    `)) throw new Error("Failed to register opening deck shuffle");
    }
    lib.startDuel(handle);
  } catch (error) {
    lib.destroyDuel(handle);
    throw error;
  }

  let revision = 0;
  let promptSeq = 0;
  let turn = 0;
  let turnSeat = 0;
  let phase = "draw";
  let battleStep: DuelBattleStep | null = null;
  // LP per team (Tag: both partners share one value; 1v1 and FFA: one per seat).
  const lp: number[] = Array.from({ length: seatCount }, () => team.startingLP);
  const lpOf = (seat: number) => lp[teamOfSeat(format, seat)] ?? 0;
  const eliminated = new Set<number>();
  const eliminationOrder: number[][] = [];
  let eliminationGroup: number[] | null = null;
  /** Seats (a whole team in Tag) after `eliminate()` whose loss the core has not reported yet. */
  const leaving = new Set<number>();
  /** Queued surrenders stay alive until EVENT_TURN_END. */
  const queuedSurrenders = new Set<number>();
  const isLeaving = (seat: number) => leaving.has(seat) && !eliminated.has(seat);
  /** The next living opponent of a seat in turn order (the core fold's fallback opponent). Never a Tag partner. */
  const nextLivingOpponent = (seat: number): number => nextLivingOpponentSeat(format, seatCount, seat, eliminated);
  /** Zones that the core disabled, per seat (bit layout of the low half of MSG_FIELD_DISABLED). */
  const disabledZones = new Map<number, number>();
  const diagnostics: EngineDiagnostic[] = [];
  const diagnose = (kind: string, seat: number | null, detail: string) => {
    diagnostics.push({ turn, phase, kind, seat, detail });
    if (diagnostics.length > DIAGNOSTICS_LIMIT) diagnostics.splice(0, diagnostics.length - DIAGNOSTICS_LIMIT);
  };
  const logCoreLine = (text: string) => diagnose("stderr", null, text.length > 500 ? `${text.slice(0, 500)}...` : text);
  earlyStderr.splice(0).forEach(logCoreLine);
  stderrSink = logCoreLine;
  let callsSinceLastPrompt = 0;
  let messagesSinceLastPrompt = 0;
  /** Links of the chain that are still on it: the wrapper cannot read the chain when there are more than two seats. */
  let liveChainSize = 0;
  let pending: PendingPrompt | null = null;
  let result: DuelEngineView["result"] = null;
  let closed = false;
  const log: LogEntry[] = [];
  const events: StoredDuelEvent[] = [];
  const chainMemory: StoredChainLink[] = [];
  const reveals = createRevealMap(seatCount);
  let nextLogId = 1;
  let nextEventId = 1;
  let lastSelectHint: string | undefined;
  /** Card named by the core's last HINT_CARD: the card whose effect the following prompts belong to. */
  let lastHintCard: number | undefined;
  /** Seat of the core's last HINT_PLACE_SEAT: the owner of the high half of the next place mask. One prompt only. */
  let lastPlaceSeat: number | undefined;
  let sawRetry = false;
  const hintCardName = () => (lastHintCard ? cards.get(lastHintCard)?.name : undefined);

  const appendLog = (text: string, audience: "all" | number = "all") => {
    log.push({ id: nextLogId++, text, audience });
    if (log.length > 400) log.splice(0, log.length - 400);
  };

  const recordEvent = (message: OcgMessage) => {
    // Moves first: a card's move precedes the summon/set/activate/destroy event it belongs to.
    for (const move of observeMoveEvents(message, cards, eventContext, nextEventId)) pushEvent(move);
    const stored = observeDuelEvent(message, cards, chainMemory, nextEventId, eventContext);
    if (stored) pushEvent(stored);
  };

  const pushEvent = (stored: StoredDuelEvent) => {
    stored.id = nextEventId;
    nextEventId += 1;
    events.push(stored);
    if (events.length > 400) events.splice(0, events.length - 400);
  };

  const flushDeferredDestroys = () => {
    for (const stored of drainDeferredDestroys(eventContext, cards, nextEventId)) pushEvent(stored);
  };

  const applyMessage = (message: OcgMessage) => {
    eliminationGroup = null;
    battleStep = nextBattleStep(battleStep, message);
    switch (message.type) {
      case OcgMessageType.RETRY:
        sawRetry = true;
        return;
      case OcgMessageType.HINT:
        if (Number(message.hint_type) === HINT_PLACE_SEAT) {
          lastPlaceSeat = placeSeatHint(message) ?? undefined;
        } else if (message.hint_type === OcgHintType.SELECTMSG) {
          // Placeholders are filled when the prompt is built, against the card the prompt names.
          lastSelectHint = cards.resolveLabel(message.hint) || cards.system(Number(message.hint));
        } else if (message.hint_type === OcgHintType.EVENT || message.hint_type === OcgHintType.MESSAGE) {
          const text = fillPlaceholders(cards.resolveLabel(message.hint) || cards.system(Number(message.hint)) || "", [hintCardName()]);
          if (text) appendLog(text);
        } else if (message.hint_type === OcgHintType.CARD) {
          lastHintCard = Number(message.hint) || undefined;
        }
        return;
      case OcgMessageType.CHAIN_SOLVED:
      case OcgMessageType.CHAIN_END:
        lastHintCard = undefined;
        liveChainSize = message.type === OcgMessageType.CHAIN_SOLVED ? Math.max(0, message.chain_size - 1) : 0;
        return;
      case OcgMessageType.CHAINING:
        liveChainSize = message.chain_size;
        appendLog(`${cards.get(message.code)?.name ?? `Card ${message.code}`} is activating`);
        return;
      case OcgMessageType.WIN: {
        // The core repeats MSG_WIN after the win. The first result stands.
        if (!acceptsResult(result)) {
          diagnose("win-ignored", null, `player ${message.player} reason ${message.reason}`);
          return;
        }
        diagnose("win", message.player < seatCount ? message.player : null, `player ${message.player} reason ${message.reason}`);
        const winnerSeat = message.player >= 0 && message.player < seatCount ? message.player : null;
        const reason = message.reason === 0 ? "Surrender" : cards.victory(message.reason) ?? `Win reason ${message.reason}`;
        if (multi) {
          // Tag: `player` is the winning team (its lowest seat).
          const winnerTeam = winnerSeat == null ? null : teamOfSeat(format, winnerSeat);
          // A Tag duel ends with MSG_WIN only (no message 200 for the losing team): every seat of another team is out.
          if (winnerSeat === null) {
            // The last loss group records the draw. Those seats stay as players on the result screen.
            for (const seat of eliminationOrder.at(-1) ?? []) eliminated.delete(seat);
          } else {
            for (let seat = 0; seat < seatCount; seat++) {
              if (teamOfSeat(format, seat) !== winnerTeam) eliminated.add(seat);
            }
          }
          result = { winnerSeat, winnerTeam, reason };
          appendLog(winnerSeat == null ? `Draw (${reason})` : format === "tag" ? `Team ${winnerTeam! + 1} wins (${reason})` : `Player ${winnerSeat + 1} wins (${reason})`);
          return;
        }
        result = { winnerSeat, reason };
        appendLog(winnerSeat == null ? `Draw (${reason})` : `Player ${winnerSeat + 1} wins (${reason})`);
        return;
      }
      case OcgMessageType.FIELD_DISABLED:
        // Two duelists: one u32, duelist 0 in the low half and duelist 1 in the high half.
        if (!multi) {
          disabledZones.set(0, message.field_mask & 0xffff);
          disabledZones.set(1, (message.field_mask >>> 16) & 0xffff);
        }
        return;
      case OcgMessageType.NEW_TURN:
        queuedSurrenders.clear();
        turn += 1;
        turnSeat = message.player;
        appendLog(`Turn ${turn} — Player ${message.player + 1}`);
        return;
      case OcgMessageType.NEW_PHASE:
        phase = phaseName(message.phase);
        appendLog(phase);
        return;
      case OcgMessageType.DAMAGE:
        lp[teamOfSeat(format, message.player)] = Math.max(0, lpOf(message.player) - message.amount);
        appendLog(`Player ${message.player + 1} takes ${message.amount} damage`);
        return;
      case OcgMessageType.RECOVER:
        lp[teamOfSeat(format, message.player)] = lpOf(message.player) + message.amount;
        appendLog(`Player ${message.player + 1} gains ${message.amount} LP`);
        return;
      case OcgMessageType.PAY_LPCOST:
        lp[teamOfSeat(format, message.player)] = Math.max(0, lpOf(message.player) - message.amount);
        appendLog(`Player ${message.player + 1} pays ${message.amount} LP`);
        return;
      case OcgMessageType.LPUPDATE:
        lp[teamOfSeat(format, message.player)] = message.lp;
        return;
      case OcgMessageType.DRAW:
        appendLog(`Player ${message.player + 1} drew ${message.drawn.length} card(s)`);
        appendLog(
          `You drew ${message.drawn.map((card) => cards.get(card.code)?.name ?? `Card ${card.code}`).join(", ")}`,
          message.player,
        );
        return;
      case OcgMessageType.SUMMONING:
      case OcgMessageType.SPSUMMONING:
      case OcgMessageType.FLIPSUMMONING: {
        const verb = message.type === OcgMessageType.SUMMONING ? "Normal Summons"
          : message.type === OcgMessageType.SPSUMMONING ? "Special Summons" : "Flip Summons";
        const who = playerLabel(format, message.controller);
        const text = `${who} ${verb} ${cards.get(message.code)?.name ?? `Card ${message.code}`}`;
        if ((message.position & OcgPosition.FACEDOWN) !== 0) {
          appendLog(`${who} ${verb} a face-down monster`);
          if (!isNoDuelist(format, message.controller)) appendLog(text, message.controller);
        } else {
          appendLog(text);
        }
        return;
      }
      case OcgMessageType.SET:
        appendLog(`${playerLabel(format, message.controller)} Sets a card`);
        return;
      case OcgMessageType.CHAIN_NEGATED:
        appendLog("A chain link was negated");
        return;
      case OcgMessageType.CHAIN_END:
        appendLog("Chain ended");
        return;
      case OcgMessageType.ATTACK:
        appendLog(message.target ? "A monster declares an attack" : "A monster declares a direct attack");
        return;
      case OcgMessageType.SHUFFLE_DECK:
        appendLog(`Player ${message.player + 1} shuffled their deck`);
        clearRevealsAt(reveals, message.player, OcgLocation.DECK);
        return;
      case OcgMessageType.SHUFFLE_HAND:
        appendLog(`Player ${message.player + 1} shuffled their hand`);
        clearRevealsAt(reveals, message.player, OcgLocation.HAND);
        return;
      case OcgMessageType.SHUFFLE_EXTRA:
        clearRevealsAt(reveals, message.player, OcgLocation.EXTRA);
        return;
      case OcgMessageType.SHUFFLE_SET_CARD:
        for (let seat = 0; seat < seatCount; seat += 1) clearRevealsAt(reveals, seat, message.location);
        return;
      case OcgMessageType.CONFIRM_CARDS:
        for (const card of message.cards) {
          noteReveal(reveals, message.player, card.controller, card.location, card.sequence, card.code);
          const partner = partnerSeatOf(format, message.player);
          if (partner != null) noteReveal(reveals, partner, card.controller, card.location, card.sequence, card.code);
        }
        appendLog(`Confirmed ${message.cards.map((card) => cards.get(card.code)?.name ?? `Card ${card.code}`).join(", ")}`, message.player);
        return;
      case OcgMessageType.CONFIRM_DECKTOP:
      case OcgMessageType.CONFIRM_EXTRATOP:
        // Excavation is public: message.player owns the Deck, and every duelist sees the cards
        // (Conscription excavates the opponent's Deck for the activating player).
        for (const card of message.cards) {
          for (const viewer of reveals.keys()) noteReveal(reveals, viewer, card.controller, card.location, card.sequence, card.code);
        }
        appendLog(`Excavated ${message.cards.map((card) => cards.get(card.code)?.name ?? `Card ${card.code}`).join(", ")}`);
        return;
      case OcgMessageType.MOVE:
        moveReveals(reveals, message.from, message.to, message.card);
        if (message.to.location === OcgLocation.GRAVE || (message.to.location === OcgLocation.REMOVED && (message.to.position & OcgPosition.FACEDOWN) === 0)) {
          appendLog(`${cards.get(message.card)?.name ?? `Card ${message.card}`} moved`);
        }
        return;
      case OcgMessageType.TOSS_COIN:
        appendLog(`Coin toss: ${message.results.map((value) => (value ? "Heads" : "Tails")).join(", ")}`);
        return;
      case OcgMessageType.TOSS_DICE:
        appendLog(`Dice roll: ${message.results.join(", ")}`);
        return;
      default:
        return;
    }
  };

  /** A multi-duelist message that the wrapper drops: MSG_DUELIST_ELIMINATED (200) and MSG_ATTACK_DUELIST (201). */
  const applyRaw = (raw: RawDuelistMessage) => {
    if (raw.type !== MSG_DUELIST_ELIMINATED) eliminationGroup = null;
    if (raw.type === MSG_DUELIST_ELIMINATED) {
      // A seat is 0..seatCount-1. Anything else (0xFF, "no duelist") eliminates nobody.
      if (raw.duelist >= seatCount) {
        diagnose("msg200", null, `no duelist (${raw.duelist}) reason ${raw.reason}`);
        return;
      }
      // FFA: the duelist. Tag: the whole team loses its cards and turns.
      const lost = format === "tag" ? seatsOfTeam(format, teamOfSeat(format, raw.duelist)) : [raw.duelist];
      const newlyLost = lost.filter((seat) => !eliminated.has(seat));
      // A queued surrender has its own place, also when no card-removal message separates losses.
      if (raw.reason === 0 && queuedSurrenders.has(raw.duelist)) eliminationGroup = null;
      if (newlyLost.length) {
        if (!eliminationGroup) {
          eliminationGroup = [];
          eliminationOrder.push(eliminationGroup);
        }
        eliminationGroup.push(...newlyLost);
        for (const seat of newlyLost) eliminated.add(seat);
      }
      diagnose("msg200", raw.duelist, `reason ${raw.reason}`);
      const reason = raw.reason === 0 ? "Surrender" : cards.victory(raw.reason) ?? `Win reason ${raw.reason}`;
      appendLog(format === "tag" ? `Team ${teamOfSeat(format, raw.duelist) + 1} is eliminated (${reason})` : `Player ${raw.duelist + 1} is eliminated (${reason})`);
    } else if (raw.type === MSG_ATTACK_DUELIST) {
      // The core writes 0xFF when a direct attack has no defender duelist (no seat to name).
      if (isNoDuelist(format, raw.duelist) || raw.duelist >= seatCount) {
        diagnose("msg201", null, `attacked directly, no duelist (${raw.duelist})`);
        return;
      }
      diagnose("msg201", raw.duelist, "attacked directly");
      appendLog(`Player ${raw.duelist + 1} is attacked directly`);
    } else if (raw.type === MSG_FIELD_DISABLED_N) {
      for (const zone of raw.zones) {
        if (zone.duelist >= seatCount) continue;
        disabledZones.set(zone.duelist, zone.mask);
      }
      diagnose("msg202", null, raw.zones.map((zone) => `${zone.duelist}:0x${zone.mask.toString(16)}`).join(" "));
    }
  };

  const readDomainState = (): DomainSeatState[] | undefined => {
    if (options.mode !== "domain") return undefined;
    if (!getDomainState) throw new Error("Domain core did not provide getDomainState");
    return getDomainState();
  };

  const processUntilWait = () => {
    if (closed) throw new Error("Engine is closed");
    resetEventBatch(eventContext);
    while (!result) {
      const status = lib.duelProcess(handle);
      // The wrapper warns once per message id 200, 201 and 202 (it does not know them). The tap reads them below.
      const messages = tap ? withoutDuelistParseWarnings(() => lib.duelGetMessage(handle)) : lib.duelGetMessage(handle);
      callsSinceLastPrompt += 1;
      messagesSinceLastPrompt += messages.length;
      if (tap) {
        // Interleave the raw-only messages with the parsed ones, in buffer order.
        const extras = tap.take().flatMap((buffer) => parseDuelistMessages(buffer).extras);
        let nextExtra = 0;
        messages.forEach((message, index) => {
          while (nextExtra < extras.length && extras[nextExtra]!.after <= index) applyRaw(extras[nextExtra++]!);
          applyMessage(message);
          recordEvent(message);
        });
        while (nextExtra < extras.length) applyRaw(extras[nextExtra++]!);
      } else {
        for (const message of messages) {
          applyMessage(message);
          recordEvent(message);
        }
      }
      flushDeferredDestroys();
      if (errors.length > 0) {
        const detail = errors.join("; ");
        errors.length = 0;
        throw new Error(detail);
      }
      if (result) {
        pending = null;
        break;
      }
      if (status === OcgProcessResult.END) {
        throw new Error("Engine ended without a WIN event");
      }
      if (status === OcgProcessResult.CONTINUE) continue;
      if (sawRetry) break;
      const waiting = [...messages].reverse().find(isWaitingMessage);
      if (!waiting) throw new Error("Engine is waiting without a prompt");
      if (waiting.type === OcgMessageType.SELECT_CHAIN) {
        diagnose("response", waiting.player, `${waiting.selects.length} choice(s)${waiting.forced ? ", forced" : ""}${waiting.spe_count === 0x7f ? ", trigger" : ""}, chain ${liveChainSize}`);
      }
      const domainState = readDomainState();
      const recallState =
        waiting.type === OcgMessageType.SELECT_YESNO && waiting.description === BigInt(DOMAIN_RECALL_DESC)
          ? domainState?.[waiting.player]
          : undefined;
      const recall = recallState ? recallPromptContext(recallState, cards) : undefined;
      // The main action prompts start a new play; a hint card from an earlier effect no longer applies.
      if (waiting.type === OcgMessageType.SELECT_IDLECMD || waiting.type === OcgMessageType.SELECT_BATTLECMD) lastHintCard = undefined;
      const next = mapPrompt(
        waiting,
        cards,
        `p${revision}-${promptSeq + 1}`,
        lastSelectHint,
        {
          domain: domainState,
          recall: recall ? { card: recall.card, returns: recall.returns, nextCost: recall.nextCost } : undefined,
          hintCard: lastHintCard,
          ...(multi && "player" in waiting ? { placeOpponent: nextLivingOpponent(waiting.player) } : {}),
          ...(multi && lastPlaceSeat != null ? { placeSeat: lastPlaceSeat } : {}),
          ...(multi ? { livingSeats: Array.from({ length: seatCount }, (_, seat) => seat).filter((seat) => !eliminated.has(seat) && !isLeaving(seat)) } : {}),
        },
      );
      lastSelectHint = undefined;
      lastPlaceSeat = undefined;
      const automated = autoResponse(next);
      if (automated) {
        lib.duelSetResponse(handle, automated);
        continue;
      }
      promptSeq += 1;
      next.id = `p${revision}-${promptSeq}`;
      next.prompt.id = next.id;
      pending = next;
      callsSinceLastPrompt = 0;
      messagesSinceLastPrompt = 0;
      break;
    }
  };

  /** Automatic answers for a leaving seat per call: the core reports the loss at its next Adjust, long before this. */
  const LEAVING_ANSWER_LIMIT = 200;

  /**
   * While the open prompt belongs to a seat that is leaving, answer it for that seat (the answer that changes
   * the game least) until the core reports the loss or the prompt moves to a seat that stays. Deterministic:
   * a journal replay of the same commands gives the same answers.
   */
  const answerForLeavingSeats = () => {
    for (let step = 0; pending && !result && isLeaving(pending.seat); step += 1) {
      const current = pending;
      if (step >= LEAVING_ANSWER_LIMIT) {
        throw new Error(`Seat ${current.seat} is still in the duel after ${LEAVING_ANSWER_LIMIT} automatic answers (open prompt ${current.id}, ${current.prompt.kind})`);
      }
      const permittedCards = current.prompt.kind === "announce-card" ? game.searchCards("") : undefined;
      const answer = chooseSurrenderedAnswer(current.prompt, { permittedCards });
      const response = resolveAnswer(current, current.seat, current.id, answer, cards);
      diagnose("leaving-answer", current.seat, `${current.prompt.kind} ${current.id}`);
      sawRetry = false;
      lib.duelSetResponse(handle, response);
      processUntilWait();
      if (sawRetry) {
        pending = current;
        sawRetry = false;
        throw new Error(`The core refused the automatic answer of leaving seat ${current.seat} (prompt ${current.id}, ${current.prompt.kind})`);
      }
    }
  };

  try {
    processUntilWait();
  } catch (error) {
    lib.destroyDuel(handle);
    throw error;
  }

  const game: EngineGame = {
    view(seat) {
      if (closed) throw new Error("Engine is closed");
      if (seat != null && !(Number.isInteger(seat) && seat >= 0 && seat < seatCount)) throw new Error("Invalid seat");
      const projected = projectView({
        lib,
        handle,
        cards,
        viewer: seat,
        revision,
        turn,
        turnSeat,
        phase,
        battleStep,
        lp: Array.from({ length: seatCount }, (_, index) => lpOf(index)),
        prompt: pending?.prompt ?? null,
        promptSeat: pending?.seat ?? null,
        log,
        events,
        result,
        reveals,
        mode: options.mode,
        domainState: readDomainState(),
        ...(multi ? { format, eliminated, leaving: new Set([...leaving].filter(isLeaving)), chain: chainMemory.slice(0, liveChainSize) } : {}),
      });
      // Disabled zones are public board facts. The field is set only for seats that have one.
      if (multi) projected.eliminationOrder = eliminationOrder.map((group) => [...group]);
      for (const entry of projected.seats) {
        if (multi) entry.pendingElimination = !result && !eliminated.has(entry.seat)
          && (isLeaving(entry.seat) || queuedSurrenders.has(entry.seat));
        const mask = disabledZones.get(entry.seat);
        if (mask) entry.disabledZones = mask;
      }
      return projected;
    },
    answer(seat, promptId, answer) {
      if (closed) throw new Error("Engine is closed");
      if (result) throw new EngineAnswerError("Duel is over");
      if (!pending) throw new EngineAnswerError("No prompt is waiting");
      const response = resolveAnswer(pending, seat, promptId, answer, cards);
      const previous = pending;
      sawRetry = false;
      // Stays set through the summon's follow-up prompts; observeDuelEvent clears it at SPSUMMONED.
      if (isPendulumSummonAnswer(pending, answer)) eventContext.pendulumSummon = true;
      lib.duelSetResponse(handle, response);
      processUntilWait();
      if (sawRetry) {
        pending = previous;
        sawRetry = false;
        throw new EngineAnswerError("Invalid answer");
      }
      answerForLeavingSeats();
      revision += 1;
    },
    eliminate(seat, reason, atTurnEnd = false) {
      if (closed) throw new Error("Engine is closed");
      if (result) throw new EngineAnswerError("Duel is over");
      if (!multi) throw new Error("Only duels with more than two seats can eliminate a duelist");
      if (!Number.isInteger(seat) || seat < 0 || seat >= seatCount) throw new Error("Invalid seat");
      if (eliminated.has(seat) || leaving.has(seat)) throw new EngineAnswerError("Seat is already eliminated");
      if (queuedSurrenders.has(seat)) throw new EngineAnswerError("Seat has a queued surrender");
      if (!Number.isInteger(reason) || reason < 0 || reason > 255) throw new Error("Invalid loss reason");
      // Check before the core is touched, so a throw cannot leave the duel half changed.
      if (!pending) throw new Error("The core waits for an answer but the engine has no open prompt");
      if (!lib.loadScript(handle, "duel-probe-eliminate.lua", "assert(Debug.EliminateDuelist~=nil)")) {
        errors.length = 0;
        throw new Error("This duel core has no Debug.EliminateDuelist");
      }
      const finishQueuedTurn = !atTurnEnd && reason === 0 && seat === turnSeat && liveChainSize === 0 && queuedSurrenders.size > 0;
      if (atTurnEnd || finishQueuedTurn) {
        // Each loss has one effect, in queue order. DELAY makes the core run Adjust
        // after each operation, so the last living seat wins before its loss can run.
        // EVENT_TURN_END follows all End Phase actions, also when the turn ends early.
        const script = `
local immediate=${finishQueuedTurn}
local late=immediate or (Duel.GetCurrentPhase()==PHASE_END and Duel.CheckEvent(EVENT_TURN_END))
local queue=__yugidraft_surrender_eot or {}
__yugidraft_surrender_eot=queue
local entry={seat=${seat},reason=${reason}}
table.insert(queue,entry)
local function register(loss)
local e=Effect.GlobalEffect()
e:SetType(EFFECT_TYPE_FIELD|EFFECT_TYPE_CONTINUOUS)
e:SetProperty(EFFECT_FLAG_DELAY)
e:SetCountLimit(1)
e:SetCode(late and EVENT_ADJUST or EVENT_TURN_END)
if late then e:SetCondition(function() return queue[1]==loss end) end
e:SetOperation(function(effect)
  table.remove(queue,1)
  if #queue==0 then __yugidraft_surrender_eot=nil end
  local ok,err=pcall(Debug.EliminateDuelist,loss.seat,loss.reason)
  if not ok and not tostring(err):find("Debug.EliminateDuelist: the duelist is not in the duel.",1,true) then error(err) end
  effect:Reset()
end)
loss.effect=e
Duel.RegisterEffect(e,0)
end
if immediate then
  for _,loss in ipairs(queue) do
    if loss.effect then loss.effect:Reset() end
    register(loss)
  end
else register(entry) end`;
        if (!lib.loadScript(handle, "duel-surrender-eot.lua", script)) {
          const detail = errors.join("; ");
          errors.length = 0;
          throw new Error(`Failed to queue surrender of seat ${seat}: ${detail}`);
        }
        queuedSurrenders.add(seat);
        diagnose(finishQueuedTurn ? "surrender-turn-end" : "surrender-eot", seat, `reason ${reason}`);
        if (finishQueuedTurn) {
          for (const gone of format === "tag" ? seatsOfTeam(format, teamOfSeat(format, seat)) : [seat]) leaving.add(gone);
          answerForLeavingSeats();
        }
        revision += 1;
        return;
      }
      if (!lib.loadScript(handle, "duel-eliminate.lua", `Debug.EliminateDuelist(${seat},${Math.trunc(reason)})`)) {
        const detail = errors.join("; ");
        errors.length = 0;
        throw new Error(`Failed to eliminate seat ${seat}${detail ? `: ${detail}` : ""}`);
      }
      diagnose("eliminate", seat, `reason ${Math.trunc(reason)}`);
      // The loss is only flagged in the core. It lands at the next Adjust, which runs after the open prompt is answered.
      for (const gone of format === "tag" ? seatsOfTeam(format, teamOfSeat(format, seat)) : [seat]) leaving.add(gone);
      // Do not run the core here. A call with no new response is no no-op: the core takes the old response buffer as the answer
      // of the open prompt (a chain window gets a pass), so the prompt of ANOTHER seat would be answered without that seat.
      // The open prompt stays. If its seat is the one that leaves, answerForLeavingSeats answers it with a real response.
      answerForLeavingSeats();
      revision += 1;
    },
    diagnostics() {
      return diagnostics.map((entry) => ({ ...entry }));
    },
    coreInfo() {
      return { wasmSha: loaded.sha, wasmFile: loaded.file, callsSinceLastPrompt, messagesSinceLastPrompt };
    },
    searchCards(query) {
      if (closed) throw new Error("Engine is closed");
      if (pending?.message.type === OcgMessageType.ANNOUNCE_CARD) {
        const opcodes = pending.message.opcodes as OcgOpCode[];
        return cards.search(query, (data) => cardMatchesOpcode(data, opcodes));
      }
      return cards.search(query);
    },
    close() {
      if (closed) return;
      closed = true;
      lib.destroyDuel(handle);
    },
  };
  return game;
}

export { EngineAnswerError, LOCATION_DECKMASTER };
