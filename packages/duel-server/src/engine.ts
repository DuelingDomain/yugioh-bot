import type { DuelAnswer, DuelCardInfo, DuelDeck, DuelEngineView, DuelMasterRule, DuelMode } from "@yugidraft/shared/duels";
import createCore, {
  OcgDuelMode,
  OcgHintType,
  OcgLocation,
  OcgLogType,
  OcgMessageType,
  OcgPosition,
  OcgProcessResult,
  cardMatchesOpcode,
  type OcgCardData,
  type OcgCoreSync,
  type OcgDuelHandle,
  type OcgMessage,
  type OcgOpCode,
} from "ocgcore-wasm";
import { isOptionalCardScript, loadCardDatabase, type CardDatabase } from "./cards.js";
import { EngineAnswerError, autoResponse, isWaitingMessage, mapPrompt, recallPromptContext, resolveAnswer, type PendingPrompt } from "./prompts.js";
import {
  DOMAIN_RECALL_DESC,
  LOCATION_DECKMASTER,
  clearRevealsAt,
  createRevealMap,
  moveReveals,
  noteReveal,
  observeDuelEvent,
  phaseName,
  projectView,
  type DomainSeatState,
  type LogEntry,
  type StoredChainLink,
  type StoredDuelEvent,
} from "./views.js";
import { createDomainCore } from "./domain-core.js";

export interface EngineGameOptions {
  mode: DuelMode;
  decks: DuelDeck[];
  seed: string[];
  dataDirectory: string;
  masterRule?: DuelMasterRule;
}

export interface EngineGame {
  view(seat: number | null): DuelEngineView;
  answer(seat: number, promptId: string, answer: DuelAnswer): void;
  searchCards(query: string): DuelCardInfo[];
  close(): void;
}

export type DomainCoreFactory = (ctx: {
  createStockCore: typeof createCore;
  dataDirectory: string;
  seed: [bigint, bigint, bigint, bigint];
  decks: DuelDeck[];
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

function duelFlagsFor(mode: DuelMode, masterRule?: DuelMasterRule): bigint {
  const rule = masterRule ?? 5;
  if (rule !== 1 && rule !== 2 && rule !== 3 && rule !== 4 && rule !== 5) {
    throw new Error(`Unknown master rule ${String(rule)}`);
  }
  if (mode === "domain" && rule !== 5) {
    throw new Error("Domain Format requires Master Rule 5");
  }
  return MASTER_RULE_FLAGS[rule];
}


function addDeck(lib: OcgCoreSync, handle: OcgDuelHandle, team: 0 | 1, deck: DuelDeck) {
  for (const code of deck.main) {
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

function loadScriptOrThrow(lib: OcgCoreSync, handle: OcgDuelHandle, cards: CardDatabase, name: string) {
  const content = cards.readScript(name);
  if (!content) throw new Error(`Required script missing: ${name}`);
  if (!lib.loadScript(handle, name, content)) throw new Error(`Failed to load script ${name}`);
}

export async function createEngineGame(options: EngineGameOptions): Promise<EngineGame> {
  if (options.decks.length !== 2) throw new Error("Exactly two decks are required");
  const flags = duelFlagsFor(options.mode, options.masterRule);
  const seed = parseSeed(options.seed);
  const cards = loadCardDatabase(options.dataDirectory);
  const errors: string[] = [];
  const cardReader = (code: number) => {
    if (!code) return null;
    return cards.cardData(code);
  };
  const scriptReader = (name: string) => {
    const content = cards.readScript(name);
    if (!content && !isOptionalCardScript(name, cards.cardData)) errors.push(`Missing script ${name}`);
    return content;
  };
  const errorHandler = (type: number, text: string) => {
    if (type === OcgLogType.ERROR || type === OcgLogType.UNDEFINED) errors.push(text);
  };

  let lib: OcgCoreSync;
  let handle: OcgDuelHandle;
  let getDomainState: (() => DomainSeatState[]) | undefined;

  if (options.mode === "domain") {
    if (!domainCoreFactory) throw new Error("Domain core is not registered");
    const created = await domainCoreFactory({
      createStockCore: createCore,
      dataDirectory: options.dataDirectory,
      seed,
      decks: options.decks,
      cardReader,
      scriptReader,
      errorHandler,
    });
    lib = created.lib;
    handle = created.handle;
    if (!created.getDomainState) throw new Error("Domain core did not provide getDomainState");
    getDomainState = created.getDomainState;
  } else {
    lib = await createCore({ sync: true });
    const created = lib.createDuel({
      flags,
      seed,
      team1: { startingLP: 8000, startingDrawCount: 5, drawCountPerTurn: 1 },
      team2: { startingLP: 8000, startingDrawCount: 5, drawCountPerTurn: 1 },
      cardReader,
      scriptReader,
      errorHandler,
    });
    if (!created) throw new Error("Failed to create duel");
    handle = created;
  }

  try {
    loadScriptOrThrow(lib, handle, cards, "constant.lua");
    loadScriptOrThrow(lib, handle, cards, "utility.lua");
    if (options.mode === "domain") {
      loadScriptOrThrow(lib, handle, cards, "domain.lua");
      // Card creation runs initial_effect; procedure libraries must be loaded first.
      for (const team of [0, 1] as const) {
        const code = options.decks[team].deckMaster;
        if (!code) throw new Error(`Seat ${team} is missing a Deck Master`);
        lib.duelNewCard(handle, {
          team,
          duelist: 0,
          code,
          controller: team,
          location: LOCATION_DECKMASTER as OcgLocation,
          sequence: 0,
          position: OcgPosition.FACEUP_ATTACK,
        });
      }
    }
    addDeck(lib, handle, 0, options.decks[0]);
    addDeck(lib, handle, 1, options.decks[1]);
    if (!lib.loadScript(handle, "duel-startup.lua", `
      local e=Effect.GlobalEffect()
      e:SetType(EFFECT_TYPE_FIELD|EFFECT_TYPE_CONTINUOUS)
      e:SetCode(EVENT_STARTUP)
      e:SetOperation(function(effect)
        Duel.ShuffleDeck(0)
        Duel.ShuffleDeck(1)
        effect:Reset()
      end)
      Duel.RegisterEffect(e,0)
    `)) throw new Error("Failed to register opening deck shuffle");
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
  const lp: [number, number] = [8000, 8000];
  let pending: PendingPrompt | null = null;
  let result: DuelEngineView["result"] = null;
  let closed = false;
  const log: LogEntry[] = [];
  const events: StoredDuelEvent[] = [];
  const chainMemory: StoredChainLink[] = [];
  const reveals = createRevealMap();
  let nextLogId = 1;
  let nextEventId = 1;
  let lastSelectHint: string | undefined;
  let sawRetry = false;

  const appendLog = (text: string, audience: "all" | number = "all") => {
    log.push({ id: nextLogId++, text, audience });
    if (log.length > 400) log.splice(0, log.length - 400);
  };

  const recordEvent = (message: OcgMessage) => {
    const stored = observeDuelEvent(message, cards, chainMemory, nextEventId);
    if (!stored) return;
    nextEventId += 1;
    events.push(stored);
    if (events.length > 400) events.splice(0, events.length - 400);
  };

  const applyMessage = (message: OcgMessage) => {
    switch (message.type) {
      case OcgMessageType.RETRY:
        sawRetry = true;
        return;
      case OcgMessageType.HINT:
        if (message.hint_type === OcgHintType.SELECTMSG) {
          lastSelectHint = cards.resolveLabel(message.hint) || cards.system(Number(message.hint));
        } else if (message.hint_type === OcgHintType.EVENT || message.hint_type === OcgHintType.MESSAGE) {
          const text = cards.resolveLabel(message.hint) || cards.system(Number(message.hint));
          if (text) appendLog(text);
        } else if (message.hint_type === OcgHintType.CODE) {
          return;
        }
        return;
      case OcgMessageType.WIN: {
        const winnerSeat = message.player === 0 || message.player === 1 ? message.player : null;
        const reason = cards.victory(message.reason) ?? `Win reason ${message.reason}`;
        result = { winnerSeat, reason };
        appendLog(winnerSeat == null ? `Draw (${reason})` : `Player ${winnerSeat + 1} wins (${reason})`);
        return;
      }
      case OcgMessageType.NEW_TURN:
        turn += 1;
        turnSeat = message.player;
        appendLog(`Turn ${turn} — Player ${message.player + 1}`);
        return;
      case OcgMessageType.NEW_PHASE:
        phase = phaseName(message.phase);
        appendLog(phase);
        return;
      case OcgMessageType.DAMAGE:
        lp[message.player] = Math.max(0, lp[message.player] - message.amount);
        appendLog(`Player ${message.player + 1} takes ${message.amount} damage`);
        return;
      case OcgMessageType.RECOVER:
        lp[message.player] += message.amount;
        appendLog(`Player ${message.player + 1} gains ${message.amount} LP`);
        return;
      case OcgMessageType.PAY_LPCOST:
        lp[message.player] = Math.max(0, lp[message.player] - message.amount);
        appendLog(`Player ${message.player + 1} pays ${message.amount} LP`);
        return;
      case OcgMessageType.LPUPDATE:
        lp[message.player] = message.lp;
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
        const text = `Player ${message.controller + 1} ${verb} ${cards.get(message.code)?.name ?? `Card ${message.code}`}`;
        if ((message.position & OcgPosition.FACEDOWN) !== 0) {
          appendLog(`Player ${message.controller + 1} ${verb} a face-down monster`);
          appendLog(text, message.controller);
        } else {
          appendLog(text);
        }
        return;
      }
      case OcgMessageType.SET:
        appendLog(`Player ${message.controller + 1} Sets a card`);
        return;
      case OcgMessageType.CHAINING:
        appendLog(`${cards.get(message.code)?.name ?? `Card ${message.code}`} is activating`);
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
        clearRevealsAt(reveals, 0, message.location);
        clearRevealsAt(reveals, 1, message.location);
        return;
      case OcgMessageType.CONFIRM_CARDS:
        for (const card of message.cards) {
          noteReveal(reveals, message.player, card.controller, card.location, card.sequence, card.code);
        }
        appendLog(`Confirmed ${message.cards.map((card) => cards.get(card.code)?.name ?? `Card ${card.code}`).join(", ")}`, message.player);
        return;
      case OcgMessageType.CONFIRM_DECKTOP:
      case OcgMessageType.CONFIRM_EXTRATOP:
        for (const card of message.cards) {
          noteReveal(reveals, message.player, card.controller, card.location, card.sequence, card.code);
        }
        appendLog(`Excavated ${message.cards.map((card) => cards.get(card.code)?.name ?? `Card ${card.code}`).join(", ")}`, message.player);
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

  const readDomainState = (): DomainSeatState[] | undefined => {
    if (options.mode !== "domain") return undefined;
    if (!getDomainState) throw new Error("Domain core did not provide getDomainState");
    return getDomainState();
  };

  const processUntilWait = () => {
    if (closed) throw new Error("Engine is closed");
    while (!result) {
      const status = lib.duelProcess(handle);
      const messages = lib.duelGetMessage(handle);
      for (const message of messages) {
        applyMessage(message);
        recordEvent(message);
      }
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
      const domainState = readDomainState();
      const recallState =
        waiting.type === OcgMessageType.SELECT_YESNO && waiting.description === BigInt(DOMAIN_RECALL_DESC)
          ? domainState?.[waiting.player]
          : undefined;
      const recall = recallState ? recallPromptContext(recallState, cards) : undefined;
      const next = mapPrompt(
        waiting,
        cards,
        `p${revision}-${promptSeq + 1}`,
        lastSelectHint,
        domainState ? {
          domain: domainState,
          recall: recall ? { card: recall.card, returns: recall.returns, nextCost: recall.nextCost } : undefined,
        } : undefined,
      );
      lastSelectHint = undefined;
      const automated = autoResponse(next);
      if (automated) {
        lib.duelSetResponse(handle, automated);
        continue;
      }
      promptSeq += 1;
      next.id = `p${revision}-${promptSeq}`;
      next.prompt.id = next.id;
      pending = next;
      break;
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
      if (seat != null && seat !== 0 && seat !== 1) throw new Error("Invalid seat");
      return projectView({
        lib,
        handle,
        cards,
        viewer: seat,
        revision,
        turn,
        turnSeat,
        phase,
        lp,
        prompt: pending?.prompt ?? null,
        promptSeat: pending?.seat ?? null,
        log,
        events,
        result,
        reveals,
        mode: options.mode,
        domainState: readDomainState(),
      });
    },
    answer(seat, promptId, answer) {
      if (closed) throw new Error("Engine is closed");
      if (result) throw new EngineAnswerError("Duel is over");
      if (!pending) throw new EngineAnswerError("No prompt is waiting");
      const response = resolveAnswer(pending, seat, promptId, answer, cards);
      const previous = pending;
      sawRetry = false;
      lib.duelSetResponse(handle, response);
      processUntilWait();
      if (sawRetry) {
        pending = previous;
        sawRetry = false;
        throw new EngineAnswerError("Invalid answer");
      }
      revision += 1;
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
