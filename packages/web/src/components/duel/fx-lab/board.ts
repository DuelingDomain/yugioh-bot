import type { DuelCard, DuelCardInfo, DuelChainLink, DuelEvent, DuelMasterRule, DuelPrompt, DuelSeatView, DuelZoneRef } from "@yugidraft/shared/duels";
import {
  LOCATION_DECK,
  LOCATION_EXTRA,
  LOCATION_GRAVE,
  LOCATION_HAND,
  LOCATION_MZONE,
  LOCATION_REMOVED,
  LOCATION_SZONE,
  POS_FACEDOWN_ATTACK,
  POS_FACEDOWN_DEFENSE,
  POS_FACEUP_ATTACK,
} from "../constants";
import type { BattleStep } from "../station-track";

/**
 * The scripted board of one FX lab scenario: pure data and pure functions, no React and no DOM.
 * A scenario is a start board plus timed steps. Each step brings engine events and a changed board
 * together, the way one engine batch reaches the room. The lab runner numbers the events.
 */

export type LabBoard = {
  seats: DuelSeatView[];
  chain: DuelChainLink[];
  phase: string;
  turnSeat: number;
  /** Public prompt ownership; no prompt contents are needed to preview opponent priority. */
  prioritySeat?: number | null;
};

/** An engine event before the runner gives it an id. */
export type EventSpec = Omit<DuelEvent, "id">;

/** A change to a board; it edits the copy it is given. */
export type Edit = (board: LabBoard) => void;

export type LabStep = {
  /** ms after the scenario starts (the lab lead-in comes first). */
  at: number;
  events?: EventSpec[];
  edits?: Edit[];
  /** Replaces the live chain snapshot (engine.chain) when set. */
  chain?: DuelChainLink[];
  /** The result screen opens at this step. */
  result?: { winnerSeat: number | null; reason: string };
};

export type LabAim = { mode: "preview" | "aim" | "locked"; from: string | null; to: { zones?: readonly string[]; lpSeat?: number | null } };

export type LabScript = {
  initial: LabBoard;
  steps: LabStep[];
  /** ms after the last step until the scenario has settled (the end of the longest effect). */
  tailMs: number;
  /** Zone keys drawn as usable (the glow on a legal card). Static for the whole run. */
  legalKeys?: string[];
  /** The aim arrow BattleFx draws while a player chooses a target. Static for the whole run. */
  aim?: LabAim;
  /** A prompt for the bottom player, drawn by the real PromptCenter over the effect layers. Static for the whole run. */
  prompt?: {
    prompt: DuelPrompt;
    battleStep?: BattleStep;
    /** Option ids shown as already picked. */
    selected?: string[];
    /** Clicks on the legal cards toggle the pick, as in a duel (nothing is ever sent). */
    interactive?: boolean;
  };
  /**
   * Your own deck menu: "menu" opens the Surrender menu on the deck once the scenario plays; "confirm" goes on to
   * the "Are you sure?" confirm. Nothing is ever sent.
   */
  deckMenu?: "menu" | "confirm";
  /** Show the Deck Master rail (a Domain duel). */
  domain?: boolean;
  /** Whose view: that seat is at the bottom; null watches with both hands concealed. */
  mySeat?: number | null;
  /** The Master Rule the board is drawn for (default 5): it decides the Extra Monster and Pendulum zones. */
  masterRule?: DuelMasterRule;
  /** A Best of 3 game: the header shows the game label; `screen` opens a between-games or match screen over the board. */
  series?: LabSeries;
  /** The rock-paper-scissors opening: the screen opens over the board, in a lobby room. */
  opening?: LabOpening;
  /** The 3-way or 4-way dice opening: the real screen plays the scripted rounds on the server's 3 second beat. */
  diceOpening?: LabDiceOpening;
  /**
   * The first step is not played as it arrives: the board opens on that step's finished state with its
   * events already in the list, as a real room does on its first load of a new duel (finished hands,
   * the deal still to be shown). Hand cards then carry the engine's hand identities.
   */
  preload?: boolean;
};

/** What the opening part of a lab scenario shows. The buttons call the real API, which fails in the lab. */
export type LabOpening = {
  stage: "pick" | "pick-chosen" | "reveal-tie" | "choose" | "wait-choose" | "start";
  /** Opponent already played this round. */
  opponentChose?: boolean;
};

/**
 * What a dice opening lab scenario plays. Rolls are by lobby seat, a seat that keeps its roll has `null`. The last
 * round carries the order, as the server's does. You are `mySeat` (a lobby seat), or a spectator when `null`.
 */
export type LabDiceOpening = {
  rounds: Array<Array<number | null>>;
  /** Rank to lobby seat, as the server sends it after the last round. */
  order: number[];
  mySeat: number | null;
  /** Open on the finished screen (the duel is about to start), as after a random tie-break. */
  startPhase?: boolean;
};

/** What the series part of a Best of 3 lab scenario shows. Static for the whole run. */
export type LabSeries = {
  /** The score after the game on screen, you first. */
  wins: [number, number];
  /** Game number of the duel on screen. */
  game: number;
  /**
   * Which screen opens over the board; "label" shows the board with the header label only.
   * "next-live": the game on screen is over and the next game of the series is already being played.
   */
  screen: "label" | "side" | "ready" | "won" | "next-live";
  /** Who looks at the screen: the player in seat 0 (default) or a spectator. */
  viewer?: "player" | "spectator";
  /** Private spectators keep their admission for later games (default public). */
  visibility?: "public" | "private";
  /** The player in seat 1 has not clicked Ready, or has. */
  opponentReady?: boolean;
  /** Seconds left in the side deck window (ready and side screens). */
  secondsLeft?: number;
  /** What the loser of the last game chose for the next game; absent while they are still choosing. */
  choice?: "first" | "second";
  /** The opponent is the practice bot: no player id, ready at once, no side deck. */
  vsBot?: boolean;
  /** Side deck screen: siding already in progress. "even" takes 2 cards out and brings 2 in; "uneven" takes 2 out and brings 1 in. */
  marks?: "even" | "uneven";
  /** Side deck screen: the player's deck has no Side Deck. */
  noSide?: boolean;
  /** Stress the between-games layout with a maximum-size Main Deck. */
  mainCount?: 60;
};

export type LabCategory = "Attacks" | "Destroy" | "Summons" | "Card moves" | "Chain" | "LP" | "Banners" | "Board states" | "Match";

export type LabScenario = {
  id: string;
  category: LabCategory;
  name: string;
  description: string;
  build: () => LabScript;
};

/** Time from the first step to the end of the tail, in ms at 1x. */
export function scriptDurationMs(script: LabScript): number {
  const last = script.steps.reduce((max, step) => Math.max(max, step.at), 0);
  return last + script.tailMs;
}

/* ---------- zones and cards ---------- */

export const z = (controller: number, location: number, sequence: number): DuelZoneRef => ({ controller, location, sequence });
export const MZ = (seat: number, sequence: number): DuelZoneRef => z(seat, LOCATION_MZONE, sequence);
export const SZ = (seat: number, sequence: number): DuelZoneRef => z(seat, LOCATION_SZONE, sequence);
export const HAND = (seat: number, sequence: number): DuelZoneRef => z(seat, LOCATION_HAND, sequence);
export const GY = (seat: number, sequence: number): DuelZoneRef => z(seat, LOCATION_GRAVE, sequence);
export const BANISHED = (seat: number, sequence: number): DuelZoneRef => z(seat, LOCATION_REMOVED, sequence);
/** The Deck pile. The engine numbers its cards (the top card has the highest sequence), the pile is one anchor. */
export const DECK = (seat: number, sequence = 0): DuelZoneRef => z(seat, LOCATION_DECK, sequence);
export const EXTRA = (seat: number, sequence: number): DuelZoneRef => z(seat, LOCATION_EXTRA, sequence);
export const FIELD = (seat: number): DuelZoneRef => z(seat, LOCATION_SZONE, 5);

export function cardAt(info: DuelCardInfo, ref: DuelZoneRef, position = POS_FACEUP_ATTACK): DuelCard {
  return {
    controller: ref.controller,
    location: ref.location,
    sequence: ref.sequence,
    position,
    code: info.code,
    name: info.name,
    description: info.description,
    attack: info.attack,
    defense: info.defense,
    level: info.level,
    type: info.type,
    attribute: info.attribute,
    race: info.race,
  };
}

/** A card the viewer cannot see: no identity. */
export function hiddenAt(ref: DuelZoneRef, position = POS_FACEDOWN_ATTACK): DuelCard {
  return { controller: ref.controller, location: ref.location, sequence: ref.sequence, position };
}

/* ---------- boards ---------- */

export type SeatOptions = {
  lp?: number;
  /** Hand cards in order; null is a card the viewer cannot see. */
  hand?: Array<DuelCardInfo | null>;
  deck?: number;
  extra?: Array<DuelCardInfo | null>;
};

export function newSeat(seat: number, options: SeatOptions = {}): DuelSeatView {
  const hand = (options.hand ?? []).map((info, index) => (info ? cardAt(info, HAND(seat, index), POS_FACEUP_ATTACK) : hiddenAt(HAND(seat, index))));
  const extra = (options.extra ?? []).map((info, index) => (info ? cardAt(info, EXTRA(seat, index), POS_FACEDOWN_DEFENSE) : hiddenAt(EXTRA(seat, index), POS_FACEDOWN_DEFENSE)));
  return {
    seat,
    lp: options.lp ?? 8000,
    hand,
    deckCount: options.deck ?? 30,
    extraCount: extra.length,
    extra,
    monsters: Array.from({ length: 7 }, () => null),
    spells: Array.from({ length: 8 }, () => null),
    graveyard: [],
    banished: [],
  };
}

export function newBoard(me: SeatOptions = {}, opp: SeatOptions = {}, phase = "main1", turnSeat = 0): LabBoard {
  return { seats: [newSeat(0, me), newSeat(1, opp)], chain: [], phase, turnSeat };
}

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/**
 * Gives every hand card the opaque identity the server sends (`hand-n` for the viewer's own cards,
 * `sleeve-n` for the others) and sets the same identity on the move events that bring a card there.
 * Returns the board and events as copies.
 */
export function withHandIds(board: LabBoard, events: readonly DuelEvent[], viewer: number | null): { board: LabBoard; events: DuelEvent[] } {
  const next = clone(board);
  let sleeves = 0;
  const own: number[] = next.seats.map(() => 0);
  const ids = next.seats.map((seat) => seat.hand.map(() => (seat.seat === viewer ? `hand-${++own[seat.seat]}` : `sleeve-${++sleeves}`)));
  next.seats.forEach((seat, index) => seat.hand.forEach((card, i) => { card.handId = ids[index][i]; }));
  const tagged = events.map((event) => {
    const zone = event.zone;
    if (event.kind !== "move" || !zone || zone.location !== LOCATION_HAND) return event;
    const handId = ids[zone.controller]?.[zone.sequence];
    return handId ? { ...event, handId } : event;
  });
  return { board: next, events: tagged };
}

/** Applies edits to a copy of the board. */
export function applyEdits(board: LabBoard, edits: readonly Edit[]): LabBoard {
  if (edits.length === 0) return board;
  const next = clone(board);
  for (const edit of edits) edit(next);
  return next;
}

function renumber(cards: DuelCard[], location: number): void {
  cards.forEach((card, index) => {
    card.location = location;
    card.sequence = index;
  });
}

/** Edit builders. Each returns an Edit; compose them in a step. */
export const edit = {
  monster: (seat: number, sequence: number, info: DuelCardInfo | null, position = POS_FACEUP_ATTACK): Edit => (board) => {
    board.seats[seat].monsters[sequence] = info ? cardAt(info, MZ(seat, sequence), position) : null;
  },
  hiddenMonster: (seat: number, sequence: number, position = POS_FACEDOWN_DEFENSE): Edit => (board) => {
    board.seats[seat].monsters[sequence] = hiddenAt(MZ(seat, sequence), position);
  },
  spell: (seat: number, sequence: number, info: DuelCardInfo | null, position = POS_FACEUP_ATTACK): Edit => (board) => {
    board.seats[seat].spells[sequence] = info ? cardAt(info, SZ(seat, sequence), position) : null;
  },
  hiddenSpell: (seat: number, sequence: number): Edit => (board) => {
    board.seats[seat].spells[sequence] = hiddenAt(SZ(seat, sequence), 0x0a);
  },
  /** Face-down card with its identity known to the viewer (their own Set card). */
  setSpell: (seat: number, sequence: number, info: DuelCardInfo): Edit => (board) => {
    board.seats[seat].spells[sequence] = cardAt(info, SZ(seat, sequence), 0x0a);
  },
  position: (seat: number, sequence: number, position: number): Edit => (board) => {
    const card = board.seats[seat].monsters[sequence];
    if (card) card.position = position;
  },
  addHand: (seat: number, info: DuelCardInfo | null): Edit => (board) => {
    const hand = board.seats[seat].hand;
    hand.push(info ? cardAt(info, HAND(seat, hand.length), POS_FACEUP_ATTACK) : hiddenAt(HAND(seat, hand.length)));
  },
  removeHand: (seat: number, index: number): Edit => (board) => {
    const hand = board.seats[seat].hand;
    hand.splice(index, 1);
    renumber(hand, LOCATION_HAND);
  },
  drawFromDeck: (seat: number, count = 1): Edit => (board) => {
    board.seats[seat].deckCount -= count;
  },
  deckCount: (seat: number, count: number): Edit => (board) => {
    board.seats[seat].deckCount = count;
  },
  grave: (seat: number, info: DuelCardInfo): Edit => (board) => {
    const grave = board.seats[seat].graveyard;
    grave.push(cardAt(info, GY(seat, grave.length), POS_FACEUP_ATTACK));
  },
  banish: (seat: number, info: DuelCardInfo): Edit => (board) => {
    const pile = board.seats[seat].banished;
    pile.push(cardAt(info, BANISHED(seat, pile.length), POS_FACEUP_ATTACK));
  },
  removeGrave: (seat: number, index: number): Edit => (board) => {
    const grave = board.seats[seat].graveyard;
    grave.splice(index, 1);
    renumber(grave, LOCATION_GRAVE);
  },
  removeExtra: (seat: number, index: number): Edit => (board) => {
    const seatView = board.seats[seat];
    seatView.extra.splice(index, 1);
    seatView.extraCount = seatView.extra.length;
    seatView.extra.forEach((card, i) => {
      card.sequence = i;
    });
  },
  lp: (seat: number, lp: number): Edit => (board) => {
    board.seats[seat].lp = lp;
  },
  phase: (phase: string, turnSeat?: number): Edit => (board) => {
    board.phase = phase;
    if (turnSeat != null) board.turnSeat = turnSeat;
  },
  /** An equipped card: the Spell/Trap zone card points at its monster. */
  equipTo: (seat: number, sequence: number, target: DuelZoneRef): Edit => (board) => {
    const card = board.seats[seat].spells[sequence];
    if (card) card.equippedTo = { ...target };
  },
  deckMaster: (seat: number, info: DuelCardInfo, state: { inZone: boolean; returns: number; nextCost?: number }): Edit => (board) => {
    board.seats[seat].deckMaster = { card: { ...info }, inZone: state.inZone, returns: state.returns, nextCost: state.nextCost ?? 0 };
  },
};

/* ---------- chain snapshot ---------- */

export const link = (index: number, seat: number, info: DuelCardInfo): DuelChainLink => ({
  index,
  seat,
  code: info.code,
  name: info.name,
  description: info.description || undefined,
});

/* ---------- event builders ---------- */

export const ev = {
  summon: (seat: number, info: DuelCardInfo, zone: DuelZoneRef, summonKind: NonNullable<DuelEvent["summonKind"]> = "normal"): EventSpec => ({
    kind: "summon", seat, card: info, zone, summonKind, text: `Player ${seat + 1} ${summonKind === "normal" || summonKind === "tribute" ? "Normal" : summonKind === "flip" ? "Flip" : "Special"} Summons ${info.name}`,
  }),
  set: (seat: number, info: DuelCardInfo, zone: DuelZoneRef): EventSpec => ({
    kind: "set", seat, card: info, zone, text: `Player ${seat + 1} Sets ${info.name}`,
  }),
  move: (seat: number, info: DuelCardInfo | null, from: DuelZoneRef, zone: DuelZoneRef, reason: NonNullable<DuelEvent["reason"]>, extra: Partial<EventSpec> = {}): EventSpec => ({
    kind: "move", seat, ...(info ? { card: info } : {}), from, zone, reason, text: `${info?.name ?? "A card"} moved`, ...extra,
  }),
  addToHand: (seat: number, info: DuelCardInfo | null, from: DuelZoneRef, zone: DuelZoneRef): EventSpec =>
    ev.move(seat, info, from, zone, "other", { addedToHand: true }),
  draw: (seat: number, info: DuelCardInfo | null, handIndex: number): EventSpec =>
    ev.move(seat, info, DECK(seat), HAND(seat, handIndex), "draw"),
  attack: (seat: number, attacker: DuelZoneRef, target?: DuelZoneRef): EventSpec => ({
    kind: "attack", seat, zone: attacker, ...(target ? { target } : {}), text: `Player ${seat + 1} declares ${target ? "an" : "a direct"} attack`,
  }),
  damage: (seat: number, amount: number, cause: "battle" | "effect" | "cost" = "battle"): EventSpec => ({
    kind: "damage", seat, amount, cause, text: cause === "cost" ? `Player ${seat + 1} pays ${amount} LP` : `Player ${seat + 1} takes ${amount} damage`,
  }),
  destroy: (seat: number, info: DuelCardInfo, zone: DuelZoneRef, why: { cause: "battle" | "effect" | "rule"; sourceCode?: number; sourceKind?: "monster" | "spell" | "trap"; sourceSeat?: number }): EventSpec => ({
    kind: "destroy", seat, card: info, zone, ...why, text: `${info.name} was destroyed`,
  }),
  /** The move to the Graveyard that follows a destroy event. */
  toGrave: (seat: number, info: DuelCardInfo, from: DuelZoneRef, graveIndex: number, why: { cause?: "battle" | "effect"; sourceCode?: number; sourceKind?: "monster" | "spell" | "trap"; sourceSeat?: number } = {}): EventSpec =>
    ev.move(seat, info, from, GY(seat, graveIndex), "destroy", why),
  activate: (seat: number, info: DuelCardInfo, zone: DuelZoneRef, chainIndex: number): EventSpec => ({
    kind: "activate", seat, card: info, zone, chainIndex, text: `${info.name} is activating`, ...(info.description ? { description: info.description } : {}),
  }),
  chain: (kind: "chain-resolving" | "chain-resolved" | "chain-negated", seat: number, info: DuelCardInfo, chainIndex: number): EventSpec => ({
    kind, seat, card: info, chainIndex, text: `Chain link ${chainIndex} (${info.name}) ${kind === "chain-resolving" ? "is resolving" : kind === "chain-resolved" ? "resolved" : "was negated"}`,
  }),
  chainEnd: (): EventSpec => ({ kind: "chain-end", text: "Chain ended" }),
  position: (seat: number, info: DuelCardInfo, zone: DuelZoneRef, fromPosition: number, toPosition: number, flip = false): EventSpec => ({
    kind: "position", seat, card: info, zone, fromPosition, toPosition, ...(flip ? { flip: true as const } : {}),
    text: flip ? `${info.name} was flipped face-up` : `${info.name} changed position`,
  }),
  equip: (seat: number, equipZone: DuelZoneRef, target: DuelZoneRef): EventSpec => ({
    kind: "equip", seat, zone: equipZone, target, text: `Player ${seat + 1} equips a card`,
  }),
  phase: (text: string): EventSpec => ({ kind: "phase", text }),
};

/** Gives each event of the steps an id (idBase + 1, + 2, ...) in order. Used by the runner and the tests. */
export function numberSteps(steps: readonly LabStep[], idBase: number): Array<{ step: LabStep; events: DuelEvent[] }> {
  let next = idBase;
  return steps.map((step) => ({
    step,
    events: (step.events ?? []).map((spec) => {
      next += 1;
      return { ...spec, id: next } as DuelEvent;
    }),
  }));
}
