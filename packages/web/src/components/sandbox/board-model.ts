/**
 * Dev sandbox builder state model. Pure: no React, no fetch, no catalog.
 *
 * `SandboxBuilderState` holds a `SandboxBoard` and a `SandboxRun` in their saved form: defaults
 * filled at board level, empty seats, empty zones and default positions left out. So the state can
 * go to the API as it is, and `parseSandboxBoard(state.board)` returns an equal value.
 *
 * Every change goes through `applyAction`. A bad action returns the same state and an `error`
 * text; it never throws. Card names are never stored: the UI resolves a name to a passcode first,
 * or gives `pasteList` a resolver function.
 */
import {
  DUEL_FORMATS,
  SANDBOX_LIMITS,
  SANDBOX_START_PHASES,
  parseSandboxBoard,
  parseSandboxRun,
  seatCountFor,
  SandboxBoardError,
  type DuelFormat,
  type DuelMasterRule,
  type DuelMode,
  type SandboxBotMode,
  type SandboxBoard,
  type SandboxCardEntry,
  type SandboxCardSpec,
  type SandboxDuelistId,
  type SandboxDuelistSetup,
  type SandboxRun,
  type SandboxStance,
  type SandboxStartPhase,
} from "@yugidraft/shared/duels";

export const SANDBOX_SEATS: readonly SandboxDuelistId[] = ["p0", "p1", "p2", "p3"];
export const DEFAULT_LP = 8000;
export const DEFAULT_DECK_SIZE = 20;

export type SlotZone = "monster" | "spell" | "field" | "pendulum" | "deckMaster";
export type PileZone = "hand" | "deck" | "grave" | "banished" | "extra";
export type SandboxZone = SlotZone | PileZone;

/** A card place. Slots use the zone index (field and deckMaster: 0). Piles use the card index. */
export interface CardLoc {
  seat: SandboxDuelistId;
  zone: SandboxZone;
  index: number;
}

export interface SandboxBuilderState {
  board: SandboxBoard;
  run: SandboxRun;
}

export type SandboxAction =
  | { type: "place"; at: CardLoc; card: number; pos?: SandboxStance }
  | { type: "remove"; at: CardLoc }
  /** Slot or pile to slot or pile. Slot target that is full: the two cards swap. Pile target: insert at `to.index` (default end). */
  | { type: "move"; from: CardLoc; to: CardLoc }
  | { type: "setPosition"; at: CardLoc; pos: SandboxStance }
  | { type: "setSummoned"; at: CardLoc; summoned: boolean }
  | { type: "addMaterial"; at: CardLoc; card: number }
  | { type: "removeMaterial"; at: CardLoc; index: number }
  /** Quick add: append one card to a pile. Zone default: hand. */
  | { type: "add"; seat: SandboxDuelistId; zone?: PileZone; card: number }
  /** Many cards at once. Cards over the pile limit are dropped and counted in `overflow`. */
  | { type: "paste"; seat: SandboxDuelistId; zone?: PileZone; codes: number[]; mode?: "append" | "replace" }
  /** Fast clear of one zone, one seat or the whole board. Cards only: LP, format and bot modes stay. */
  | { type: "clearZone"; seat: SandboxDuelistId; zone: SandboxZone }
  | { type: "clearSeat"; seat: SandboxDuelistId }
  | { type: "clearBoard" }
  | { type: "setLp"; seat: SandboxDuelistId; lp: number | null }
  | { type: "setFormat"; format: DuelFormat }
  | { type: "setMode"; mode: DuelMode }
  | { type: "setMasterRule"; masterRule: DuelMasterRule }
  | { type: "setTurn"; turn: SandboxDuelistId }
  | { type: "setDeckSize"; deckSize: number }
  | { type: "setAttackFirstTurn"; value: boolean }
  /** Phase the duel starts in. The host walks the real engine from Draw Phase to it. */
  | { type: "setStartAt"; phase: SandboxStartPhase }
  /** 3-way and 4-way only. Out: the seat keeps its place, loses its cards, and cannot act. In: the seat comes back empty. */
  | { type: "toggleEliminated"; seat: SandboxDuelistId }
  | { type: "setBotMode"; seat: 1 | 2 | 3; mode: SandboxBotMode }
  | { type: "setSeed"; seed: SandboxRun["seed"] | null };

export interface ApplyResult {
  state: SandboxBuilderState;
  /** Set when the action was refused. `state` is then the input state. */
  error?: string;
  /** `add` and `paste`: cards stored. */
  added?: number;
  /** `paste`: cards dropped because the pile was full. */
  overflow?: number;
  /** The action worked, but the model also changed something else. Show it to the owner. */
  notice?: string;
}

// ---------------------------------------------------------------------------------------------
// Constants and small helpers

const SLOT_ZONES: readonly SlotZone[] = ["monster", "spell", "field", "pendulum", "deckMaster"];
export const PILE_ZONES: readonly PileZone[] = ["hand", "deck", "grave", "banished", "extra"];
const SLOT_COUNT: Record<SlotZone, number> = { monster: 7, spell: 5, field: 1, pendulum: 2, deckMaster: 1 };
const MONSTER_POS: readonly SandboxStance[] = ["atk", "def", "set"];
const SPELL_POS: readonly SandboxStance[] = ["up", "set"];
const ZONE_LABEL: Record<SandboxZone, string> = {
  monster: "Monster Zone",
  spell: "Spell & Trap Zone",
  field: "Field Zone",
  pendulum: "Pendulum Zone",
  deckMaster: "Deck Master zone",
  hand: "Hand",
  deck: "Deck top",
  grave: "Graveyard",
  banished: "Banished",
  extra: "Extra Deck",
};

export function isSlotZone(zone: SandboxZone): zone is SlotZone {
  return (SLOT_ZONES as readonly string[]).includes(zone);
}
export function isPileZone(zone: SandboxZone): zone is PileZone {
  return !isSlotZone(zone);
}

/** Zones that can swap with each other. Deck Master only takes cards from piles. */
function slotClass(zone: SlotZone): string {
  return zone === "monster" ? "monster" : zone === "deckMaster" ? "deckMaster" : "spell";
}

/** Cards a pile can hold. */
export function pileCapacity(zone: PileZone): number {
  return SANDBOX_LIMITS[zone];
}

/** Seats of a format, as ids. */
export function seatsOf(format: DuelFormat | undefined): SandboxDuelistId[] {
  return SANDBOX_SEATS.slice(0, seatCountFor(format ?? "1v1"));
}

export function seatIndex(seat: SandboxDuelistId): number {
  return SANDBOX_SEATS.indexOf(seat);
}

/** Formats that can have players out. */
export function supportsElimination(format: DuelFormat | undefined): boolean {
  return format === "ffa3" || format === "ffa4";
}

/** Seats that are out, in seat order. Always empty for 1v1 and Tag. */
export function eliminatedSeats(board: SandboxBoard): SandboxDuelistId[] {
  if (!supportsElimination(board.format)) return [];
  const seats = seatsOf(board.format);
  return SANDBOX_SEATS.filter((id) => seats.includes(id) && board.eliminated?.includes(id));
}

export function isEliminated(board: SandboxBoard, seat: SandboxDuelistId): boolean {
  return eliminatedSeats(board).includes(seat);
}

/** Seats still in the duel. */
export function activeSeats(board: SandboxBoard): SandboxDuelistId[] {
  const out = eliminatedSeats(board);
  return seatsOf(board.format).filter((id) => !out.includes(id));
}

/** Same rule as the shared parser: Battle Phase on turn 1 (turn player P0) needs "attack first turn". */
export function battleBlockReason(board: SandboxBoard): string | null {
  return (board.turn ?? "p0") === "p0" && board.attackFirstTurn !== true
    ? "Battle Phase on turn 1 needs \u201cAttack on turn 1\u201d."
    : null;
}

/** Slot count of a zone on this board. Monster slots 5 and 6 need Master Rule 4 or 5. */
export function slotCount(board: SandboxBoard, zone: SlotZone): number {
  if (zone === "monster") return (board.masterRule ?? 5) >= 4 ? 7 : 5;
  if (zone === "deckMaster") return board.mode === "domain" ? 1 : 0;
  return SLOT_COUNT[zone];
}

export function cardOf(entry: SandboxCardEntry): number {
  return typeof entry === "number" ? entry : entry.card;
}

function specOf(entry: SandboxCardEntry): SandboxCardSpec {
  return typeof entry === "number" ? { card: entry } : entry;
}

export function defaultPos(zone: SlotZone): SandboxStance | undefined {
  if (zone === "monster") return "atk";
  return zone === "deckMaster" ? undefined : "up";
}

export function allowedPositions(zone: SandboxZone): readonly SandboxStance[] {
  if (zone === "monster") return MONSTER_POS;
  return zone === "spell" || zone === "field" || zone === "pendulum" ? SPELL_POS : [];
}

function isPasscode(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= SANDBOX_LIMITS.passcodeMax;
}

class ModelError extends Error {}
function fail(message: string): never {
  throw new ModelError(message);
}

// ---------------------------------------------------------------------------------------------
// Working copy: every zone expanded, so edits are plain array work. `collapse` restores the saved form.

interface Work {
  lp?: number;
  hand: SandboxCardEntry[];
  monsters: Array<SandboxCardEntry | null>;
  spells: Array<SandboxCardEntry | null>;
  field: SandboxCardEntry | null;
  pendulum: [SandboxCardEntry | null, SandboxCardEntry | null];
  grave: number[];
  banished: number[];
  deck: number[];
  extra: number[];
  deckMaster: number | null;
}
type WorkBoard = Record<SandboxDuelistId, Work>;

function expand(setup: SandboxDuelistSetup | undefined): Work {
  const monsters: Array<SandboxCardEntry | null> = Array.from({ length: SLOT_COUNT.monster }, (_, i) => setup?.monsters?.[i] ?? null);
  const spells: Array<SandboxCardEntry | null> = Array.from({ length: SLOT_COUNT.spell }, (_, i) => setup?.spells?.[i] ?? null);
  const work: Work = {
    hand: [...(setup?.hand ?? [])],
    monsters,
    spells,
    field: setup?.field ?? null,
    pendulum: [setup?.pendulum?.[0] ?? null, setup?.pendulum?.[1] ?? null],
    grave: [...(setup?.grave ?? [])],
    banished: [...(setup?.banished ?? [])],
    deck: [...(setup?.deck ?? [])],
    extra: [...(setup?.extra ?? [])],
    deckMaster: setup?.deckMaster ?? null,
  };
  if (setup?.lp !== undefined) work.lp = setup.lp;
  return work;
}

function emptyWork(lp: number | undefined): Work {
  const work = expand(undefined);
  if (lp !== undefined) work.lp = lp;
  return work;
}

/** Saved form of a slot entry: default position, default `summoned` and empty materials are left out. */
function compactSlot(entry: SandboxCardEntry | null, zone: SlotZone): SandboxCardEntry | null {
  if (entry === null) return null;
  const spec = specOf(entry);
  const out: SandboxCardSpec = { card: spec.card };
  if (spec.pos !== undefined && spec.pos !== defaultPos(zone) && allowedPositions(zone).includes(spec.pos)) out.pos = spec.pos;
  if (zone === "monster") {
    if (spec.materials && spec.materials.length > 0) out.materials = [...spec.materials];
    if (spec.summoned === false) out.summoned = false;
  }
  return Object.keys(out).length === 1 ? out.card : out;
}

function trimTail<T>(list: Array<T | null>): Array<T | null> {
  let end = list.length;
  while (end > 0 && list[end - 1] === null) end -= 1;
  return list.slice(0, end);
}

function collapse(work: Work, board: SandboxBoard): SandboxDuelistSetup | undefined {
  const out: SandboxDuelistSetup = {};
  if (work.lp !== undefined && work.lp !== DEFAULT_LP) out.lp = work.lp;
  if (work.hand.length > 0) out.hand = work.hand.map(cardOf);
  const monsters = trimTail(work.monsters.slice(0, slotCount(board, "monster")).map((e) => compactSlot(e, "monster")));
  if (monsters.length > 0) out.monsters = monsters;
  const spells = trimTail(work.spells.map((e) => compactSlot(e, "spell")));
  if (spells.length > 0) out.spells = spells;
  const field = compactSlot(work.field, "field");
  if (field !== null) out.field = field;
  const pendulum = work.pendulum.map((e) => compactSlot(e, "pendulum"));
  if (pendulum[0] !== null || pendulum[1] !== null) out.pendulum = [pendulum[0], pendulum[1]];
  for (const key of ["grave", "banished", "deck", "extra"] as const) {
    if (work[key].length > 0) out[key] = [...work[key]];
  }
  if (work.deckMaster !== null && board.mode === "domain") out.deckMaster = work.deckMaster;
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Board fields other than the seats, in saved form. */
function boardHead(board: SandboxBoard): SandboxBoard {
  const head: SandboxBoard = {
    format: board.format ?? "1v1",
    mode: board.mode ?? "normal",
    masterRule: board.masterRule ?? 5,
    turn: board.turn ?? "p0",
    deckSize: board.deckSize ?? DEFAULT_DECK_SIZE,
    startAt: board.startAt ?? "draw",
  };
  if (board.attackFirstTurn === true) head.attackFirstTurn = true;
  const out = eliminatedSeats(board);
  if (out.length > 0) head.eliminated = out;
  return head;
}

function workOf(board: SandboxBoard): WorkBoard {
  return { p0: expand(board.p0), p1: expand(board.p1), p2: expand(board.p2), p3: expand(board.p3) };
}

/** Raise `deckSize` so the longest deck top fits. Never lowers it. */
function fitDeckSize(head: SandboxBoard, works: WorkBoard): void {
  const longest = Math.max(...SANDBOX_SEATS.map((id) => works[id].deck.length));
  if (longest > (head.deckSize ?? DEFAULT_DECK_SIZE)) head.deckSize = longest;
}

function build(head: SandboxBoard, works: WorkBoard): SandboxBoard {
  const board = boardHead(head);
  // A seat that is out holds no cards. Its LP stays (the parser takes 0 to 999999 there).
  for (const id of eliminatedSeats(board)) works[id] = emptyWork(works[id].lp);
  fitDeckSize(board, works);
  const seats = seatsOf(board.format);
  for (const id of seats) {
    // Tag keeps team LP on P0 and P1 only.
    if (board.format === "tag" && seatIndex(id) >= 2) delete works[id].lp;
    const setup = collapse(works[id], board);
    if (setup) board[id] = setup;
  }
  return board;
}

// ---------------------------------------------------------------------------------------------
// State creation and load

export function defaultRun(): SandboxRun {
  return { bots: { "1": "pass", "2": "pass", "3": "pass" } };
}

/** Empty board: 1v1, Master Rule 5, 8000 LP, filler Deck of 20, bots on auto-pass. */
export function createBuilderState(format: DuelFormat = "1v1"): SandboxBuilderState {
  return { board: boardHead({ format }), run: defaultRun() };
}

/**
 * Build state from saved data. Uses the shared parser, so it throws `SandboxBoardError` on bad
 * input. Run data is optional: missing means all bots auto-pass.
 */
export function loadBuilderState(board: unknown, run?: unknown): SandboxBuilderState {
  const parsed = parseSandboxBoard(board);
  const parsedRun = run === undefined ? defaultRun() : parseSandboxRun(run);
  return { board: build(parsed, workOf(parsed)), run: parsedRun };
}

export interface BoardCheck {
  ok: boolean;
  /** First structural error from the shared parser. Path uses `p0.monsters[0].card` notation. */
  error?: { path: string; message: string };
}

/** Live check with the shared parser (same rules as the server). */
export function checkBuilderState(state: SandboxBuilderState): BoardCheck {
  try {
    parseSandboxBoard(state.board);
    parseSandboxRun(state.run);
    return { ok: true };
  } catch (error) {
    if (error instanceof SandboxBoardError) return { ok: false, error: { path: error.path, message: error.message } };
    throw error;
  }
}

// ---------------------------------------------------------------------------------------------
// Location access

function checkLoc(board: SandboxBoard, loc: CardLoc): void {
  if (!seatsOf(board.format).includes(loc.seat)) fail(`${loc.seat.toUpperCase()} is not a seat in ${board.format ?? "1v1"}.`);
  if (isEliminated(board, loc.seat)) fail(`${loc.seat.toUpperCase()} is out. Put the player back in to change its cards.`);
  if (!Number.isInteger(loc.index) || loc.index < 0) fail("Bad position.");
  if (isSlotZone(loc.zone)) {
    if (loc.zone === "deckMaster" && board.mode !== "domain") fail("Deck Masters need Domain mode.");
    if (loc.index >= slotCount(board, loc.zone)) {
      fail(loc.zone === "monster" && loc.index < 7 ? "Extra Monster Zones need Master Rule 4 or 5." : `No ${ZONE_LABEL[loc.zone]} ${loc.index + 1}.`);
    }
  } else if (!(PILE_ZONES as readonly string[]).includes(loc.zone)) {
    fail("Unknown zone.");
  }
}

function readEntry(work: Work, loc: CardLoc): SandboxCardEntry | null {
  switch (loc.zone) {
    case "monster":
      return work.monsters[loc.index] ?? null;
    case "spell":
      return work.spells[loc.index] ?? null;
    case "field":
      return work.field;
    case "pendulum":
      return work.pendulum[loc.index] ?? null;
    case "deckMaster":
      return work.deckMaster;
    case "hand":
      return work.hand[loc.index] ?? null;
    default:
      return work[loc.zone][loc.index] ?? null;
  }
}

function writeSlot(work: Work, loc: CardLoc, entry: SandboxCardEntry | null): void {
  switch (loc.zone) {
    case "monster":
      work.monsters[loc.index] = entry;
      return;
    case "spell":
      work.spells[loc.index] = entry;
      return;
    case "field":
      work.field = entry;
      return;
    case "pendulum":
      work.pendulum[loc.index as 0 | 1] = entry;
      return;
    case "deckMaster":
      work.deckMaster = entry === null ? null : cardOf(entry);
      return;
    default:
      fail("Not a slot.");
  }
}

function pileOf(work: Work, zone: PileZone): SandboxCardEntry[] {
  return work[zone];
}

function clearZone(work: Work, zone: SandboxZone): void {
  switch (zone) {
    case "monster":
      work.monsters.fill(null);
      return;
    case "spell":
      work.spells.fill(null);
      return;
    case "field":
      work.field = null;
      return;
    case "pendulum":
      work.pendulum = [null, null];
      return;
    case "deckMaster":
      work.deckMaster = null;
      return;
    default:
      work[zone] = [];
  }
}

function checkPasscode(card: number): void {
  if (!isPasscode(card)) fail("Not a valid card passcode.");
}

/** Add `cards` to the end of a pile (or the given index). Fails when the pile is full. */
function insertPile(work: Work, zone: PileZone, cards: SandboxCardEntry[], at?: number): void {
  const pile = pileOf(work, zone);
  if (pile.length + cards.length > pileCapacity(zone)) fail(`${ZONE_LABEL[zone]} is full (${pileCapacity(zone)}).`);
  const index = at === undefined ? pile.length : Math.max(0, Math.min(at, pile.length));
  pile.splice(index, 0, ...cards);
}

// ---------------------------------------------------------------------------------------------
// Actions

function runAction(state: SandboxBuilderState, action: SandboxAction, result: ApplyResult): SandboxBuilderState {
  const head = boardHead(state.board);
  const works = workOf(state.board);
  let runValue = state.run;
  const board = state.board;

  switch (action.type) {
    case "place": {
      checkLoc(board, action.at);
      if (!isSlotZone(action.at.zone)) fail("Pick a zone slot.");
      checkPasscode(action.card);
      const zone = action.at.zone;
      if (action.pos !== undefined && !allowedPositions(zone).includes(action.pos)) fail("That position does not fit this zone.");
      const entry: SandboxCardEntry = action.pos && action.pos !== defaultPos(zone) ? { card: action.card, pos: action.pos } : action.card;
      writeSlot(works[action.at.seat], action.at, entry);
      break;
    }
    case "remove": {
      checkLoc(board, action.at);
      const work = works[action.at.seat];
      if (readEntry(work, action.at) === null) fail("Nothing there.");
      if (isSlotZone(action.at.zone)) writeSlot(work, action.at, null);
      else pileOf(work, action.at.zone as PileZone).splice(action.at.index, 1);
      break;
    }
    case "move":
      moveCard(board, works, action.from, action.to);
      break;
    case "setPosition": {
      checkLoc(board, action.at);
      const work = works[action.at.seat];
      const entry = isSlotZone(action.at.zone) ? readEntry(work, action.at) : null;
      if (entry === null) fail("Nothing there.");
      if (!allowedPositions(action.at.zone).includes(action.pos)) fail("That position does not fit this zone.");
      writeSlot(work, action.at, { ...specOf(entry), pos: action.pos });
      break;
    }
    case "setSummoned": {
      checkLoc(board, action.at);
      const work = works[action.at.seat];
      const entry = action.at.zone === "monster" ? readEntry(work, action.at) : null;
      if (entry === null) fail("Pick a monster.");
      writeSlot(work, action.at, { ...specOf(entry), summoned: action.summoned });
      break;
    }
    case "addMaterial": {
      checkLoc(board, action.at);
      checkPasscode(action.card);
      const work = works[action.at.seat];
      const entry = action.at.zone === "monster" ? readEntry(work, action.at) : null;
      if (entry === null) fail("Pick a monster.");
      const spec = specOf(entry);
      const materials = [...(spec.materials ?? [])];
      if (materials.length >= SANDBOX_LIMITS.materials) fail(`A monster holds at most ${SANDBOX_LIMITS.materials} materials.`);
      writeSlot(work, action.at, { ...spec, materials: [...materials, action.card] });
      break;
    }
    case "removeMaterial": {
      checkLoc(board, action.at);
      const work = works[action.at.seat];
      const entry = action.at.zone === "monster" ? readEntry(work, action.at) : null;
      if (entry === null) fail("Pick a monster.");
      const spec = specOf(entry);
      const materials = [...(spec.materials ?? [])];
      if (!Number.isInteger(action.index) || action.index < 0 || action.index >= materials.length) fail("No such material.");
      materials.splice(action.index, 1);
      writeSlot(work, action.at, { ...spec, materials });
      break;
    }
    case "add": {
      const zone = action.zone ?? "hand";
      checkLoc(board, { seat: action.seat, zone, index: 0 });
      checkPasscode(action.card);
      insertPile(works[action.seat], zone, [action.card]);
      result.added = 1;
      break;
    }
    case "paste": {
      const zone = action.zone ?? "hand";
      checkLoc(board, { seat: action.seat, zone, index: 0 });
      for (const card of action.codes) checkPasscode(card);
      const work = works[action.seat];
      const pile = pileOf(work, zone);
      const base = action.mode === "replace" ? [] : [...pile];
      const room = Math.max(0, pileCapacity(zone) - base.length);
      const taken = action.codes.slice(0, room);
      pile.splice(0, pile.length, ...base, ...taken);
      result.added = taken.length;
      result.overflow = action.codes.length - taken.length;
      break;
    }
    case "clearZone":
      checkLoc(board, { seat: action.seat, zone: action.zone, index: 0 });
      clearZone(works[action.seat], action.zone);
      break;
    case "clearSeat": {
      if (!seatsOf(board.format).includes(action.seat)) fail(`${action.seat.toUpperCase()} is not a seat in ${board.format ?? "1v1"}.`);
      const lp = works[action.seat].lp;
      works[action.seat] = expand(undefined);
      if (lp !== undefined) works[action.seat].lp = lp;
      break;
    }
    case "clearBoard":
      for (const id of SANDBOX_SEATS) {
        const lp = works[id].lp;
        works[id] = expand(undefined);
        if (lp !== undefined) works[id].lp = lp;
      }
      break;
    case "setLp": {
      if (!seatsOf(board.format).includes(action.seat)) fail(`${action.seat.toUpperCase()} is not a seat in ${board.format ?? "1v1"}.`);
      if (board.format === "tag" && seatIndex(action.seat) >= 2) fail("Set team LP on P0 or P1.");
      if (action.lp === null) {
        delete works[action.seat].lp;
        break;
      }
      // Same as the parser: a seat that is out may have 0 LP.
      const lpMin = isEliminated(board, action.seat) ? 0 : SANDBOX_LIMITS.lpMin;
      if (!Number.isInteger(action.lp) || action.lp < lpMin || action.lp > SANDBOX_LIMITS.lpMax) {
        fail(`LP must be a whole number from ${lpMin} to ${SANDBOX_LIMITS.lpMax}.`);
      }
      works[action.seat].lp = action.lp;
      break;
    }
    case "setFormat": {
      if (!DUEL_FORMATS.includes(action.format)) fail("Unknown format.");
      head.format = action.format;
      // Seats outside the new format lose their cards; build() drops them. A turn on a lost seat goes back to P0.
      if (seatIndex(head.turn ?? "p0") >= seatCountFor(action.format)) head.turn = "p0";
      // Players out only exist on 3-way and 4-way tables, and two must stay in.
      head.eliminated = eliminatedSeats(head);
      if (seatsOf(action.format).length - head.eliminated.length < 2) head.eliminated = [];
      if (head.turn && head.eliminated.includes(head.turn)) head.eliminated = head.eliminated.filter((id) => id !== head.turn);
      fixBattleStart(head, result);
      break;
    }
    case "setMode":
      head.mode = action.mode;
      break;
    case "setMasterRule":
      if (![1, 2, 3, 4, 5].includes(action.masterRule)) fail("Master Rule must be 1 to 5.");
      head.masterRule = action.masterRule;
      break;
    case "setTurn":
      if (!seatsOf(head.format).includes(action.turn)) fail(`${action.turn.toUpperCase()} is not a seat in ${head.format}.`);
      if (isEliminated(board, action.turn)) fail(`${action.turn.toUpperCase()} is out. The turn player must stay in.`);
      head.turn = action.turn;
      fixBattleStart(head, result);
      break;
    case "setDeckSize": {
      if (!Number.isInteger(action.deckSize) || action.deckSize < 0 || action.deckSize > SANDBOX_LIMITS.deckSize) {
        fail(`Deck size must be 0 to ${SANDBOX_LIMITS.deckSize}.`);
      }
      const longest = Math.max(...seatsOf(head.format).map((id) => works[id].deck.length));
      if (action.deckSize < longest) fail(`Deck size cannot be below the Deck top (${longest}).`);
      head.deckSize = action.deckSize;
      break;
    }
    case "setAttackFirstTurn":
      if (action.value) head.attackFirstTurn = true;
      else delete head.attackFirstTurn;
      fixBattleStart(head, result);
      break;
    case "setStartAt": {
      if (!(SANDBOX_START_PHASES as readonly string[]).includes(action.phase)) fail("Unknown phase.");
      if (action.phase === "battle") {
        const reason = battleBlockReason(head);
        if (reason) fail(reason);
      }
      head.startAt = action.phase;
      break;
    }
    case "toggleEliminated": {
      if (!supportsElimination(head.format)) fail("Only 3-way and 4-way tables can have players out.");
      if (!seatsOf(head.format).includes(action.seat)) fail(`${action.seat.toUpperCase()} is not a seat in ${head.format}.`);
      const out = new Set(eliminatedSeats(head));
      if (out.has(action.seat)) {
        out.delete(action.seat);
      } else {
        if ((head.turn ?? "p0") === action.seat) fail(`${action.seat.toUpperCase()} is the turn player. Pick another turn player first.`);
        if (seatsOf(head.format).length - out.size - 1 < 2) fail("At least two players must stay in.");
        out.add(action.seat);
      }
      head.eliminated = SANDBOX_SEATS.filter((id) => out.has(id));
      break;
    }
    case "setBotMode": {
      if (![1, 2, 3].includes(action.seat)) fail("Seat 0 is always manual.");
      if (!["pass", "practice", "manual"].includes(action.mode)) fail("Unknown bot mode.");
      const key = String(action.seat) as "1" | "2" | "3";
      runValue = { ...state.run, bots: { ...state.run.bots, [key]: action.mode } };
      break;
    }
    case "setSeed": {
      runValue = { bots: state.run.bots };
      if (action.seed) runValue.seed = [...action.seed] as SandboxRun["seed"];
      break;
    }
    default:
      fail("Unknown action.");
  }

  return { board: build(head, works), run: runValue };
}

/** The start phase must stay legal when the turn player or "attack on turn 1" changes. Fall back to Main 1 and say so. */
function fixBattleStart(head: SandboxBoard, result: ApplyResult): void {
  if (head.startAt === "battle" && battleBlockReason(head)) {
    head.startAt = "main1";
    result.notice = "Start phase changed to Main 1: Battle Phase on turn 1 needs \u201cAttack on turn 1\u201d.";
  }
}

function moveCard(board: SandboxBoard, works: WorkBoard, from: CardLoc, to: CardLoc): void {
  checkLoc(board, from);
  checkLoc(board, to);
  const source = works[from.seat];
  const target = works[to.seat];
  const entry = readEntry(source, from);
  if (entry === null) fail("Nothing to move.");
  if (from.seat === to.seat && from.zone === to.zone && from.index === to.index) return;

  const fromSlot = isSlotZone(from.zone);
  const toSlot = isSlotZone(to.zone);

  if (fromSlot && toSlot) {
    if (slotClass(from.zone as SlotZone) !== slotClass(to.zone as SlotZone)) fail(`A card cannot move from ${ZONE_LABEL[from.zone]} to ${ZONE_LABEL[to.zone]}.`);
    const displaced = readEntry(target, to);
    writeSlot(target, to, from.zone === "deckMaster" ? cardOf(entry) : entry);
    writeSlot(source, from, displaced);
    return;
  }

  if (fromSlot && !toSlot) {
    // Position, materials and "summoned" stay behind: a pile holds plain cards.
    insertPile(target, to.zone as PileZone, [cardOf(entry)], to.index);
    writeSlot(source, from, null);
    return;
  }

  const sourcePile = pileOf(source, from.zone as PileZone);
  if (!fromSlot && toSlot) {
    const displaced = readEntry(target, to);
    sourcePile.splice(from.index, 1);
    writeSlot(target, to, cardOf(entry));
    if (displaced !== null) sourcePile.splice(Math.min(from.index, sourcePile.length), 0, cardOf(displaced));
    return;
  }

  // Pile to pile. Same pile = reorder, so the size check does not apply.
  const targetZone = to.zone as PileZone;
  if (source === target && from.zone === to.zone) {
    sourcePile.splice(from.index, 1);
    sourcePile.splice(Math.max(0, Math.min(to.index, sourcePile.length)), 0, entry);
    return;
  }
  insertPile(target, targetZone, [cardOf(entry)], to.index);
  sourcePile.splice(from.index, 1);
}

/** Apply one action. Never throws; a refused action returns the same state with an `error`. */
export function applyAction(state: SandboxBuilderState, action: SandboxAction): ApplyResult {
  const result: ApplyResult = { state };
  try {
    result.state = runAction(state, action, result);
  } catch (error) {
    if (error instanceof ModelError) return { state, error: error.message };
    throw error;
  }
  return result;
}

/** Reducer form for `useReducer`. Refused actions leave the state as it was. */
export function boardReducer(state: SandboxBuilderState, action: SandboxAction): SandboxBuilderState {
  return applyAction(state, action).state;
}

// ---------------------------------------------------------------------------------------------
// Card lists: quick add and paste

export interface CardListLine {
  /** 1-based line number in the pasted text. */
  line: number;
  count: number;
  /** Set when the line is a passcode. */
  passcode?: number;
  /** Set when the line is a card name. */
  name?: string;
}

/** Returns a passcode, a card name, or a name resolver result. `null`/`undefined` = unknown card. */
export type CardResolver = (name: string) => number | null | undefined;
export type AsyncCardResolver = (name: string) => Promise<number | null | undefined>;

export interface CardListResult {
  /** Passcodes in line order, repeated by line count. */
  codes: number[];
  /** Names the resolver did not know (or gave a bad code). */
  unresolved: Array<{ line: number; text: string }>;
}

/**
 * Split pasted text into lines. Blank lines and comment lines (`#`, `!`, `//`: YDK headers) are
 * skipped. Counts: `3x Name`, `3 x Name`, `Name x3`. A line of only digits is a passcode.
 */
export function parseCardList(text: string): CardListLine[] {
  const lines: CardListLine[] = [];
  text
    .replace(/^﻿/, "")
    .split(/\r\n|\r|\n/)
    .forEach((raw, i) => {
      let body = raw.trim();
      if (body === "" || body.startsWith("#") || body.startsWith("!") || body.startsWith("//")) return;
      let count = 1;
      const front = /^(\d{1,2})\s*[x×]\s+(.+)$/i.exec(body);
      const back = /^(.+?)\s+[x×]\s*(\d{1,2})$/i.exec(body);
      if (front && Number(front[1]) >= 1) {
        count = Number(front[1]);
        body = front[2].trim();
      } else if (back && Number(back[2]) >= 1) {
        count = Number(back[2]);
        body = back[1].trim();
      }
      if (/^\d{1,10}$/.test(body) && isPasscode(Number(body))) lines.push({ line: i + 1, count, passcode: Number(body) });
      else lines.push({ line: i + 1, count, name: body });
    });
  return lines;
}

function nameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function collect(lines: CardListLine[], lookup: (name: string) => number | null | undefined): CardListResult {
  const codes: number[] = [];
  const unresolved: CardListResult["unresolved"] = [];
  for (const line of lines) {
    const code = line.passcode ?? lookup(line.name ?? "");
    if (!isPasscode(code)) {
      unresolved.push({ line: line.line, text: line.name ?? String(line.passcode) });
      continue;
    }
    for (let n = 0; n < line.count; n += 1) codes.push(code);
  }
  return { codes, unresolved };
}

/** Resolve a pasted list. Passcode lines skip the resolver. Each distinct name is looked up once. */
export function resolveCardList(text: string, resolve: CardResolver): CardListResult {
  const cache = new Map<string, number | null | undefined>();
  return collect(parseCardList(text), (name) => {
    const key = nameKey(name);
    if (!cache.has(key)) cache.set(key, resolve(name));
    return cache.get(key);
  });
}

/** Same as `resolveCardList` for a resolver that calls the server. Distinct names run in parallel. */
export async function resolveCardListAsync(text: string, resolve: AsyncCardResolver): Promise<CardListResult> {
  const lines = parseCardList(text);
  const names = new Map<string, string>();
  for (const line of lines) if (line.name !== undefined && !names.has(nameKey(line.name))) names.set(nameKey(line.name), line.name);
  const found = new Map<string, number | null | undefined>();
  await Promise.all(
    [...names].map(async ([key, name]) => {
      try {
        found.set(key, await resolve(name));
      } catch {
        found.set(key, null);
      }
    }),
  );
  return collect(lines, (name) => found.get(nameKey(name)));
}

export interface PasteOptions {
  seat: SandboxDuelistId;
  /** Default: hand. */
  zone?: PileZone;
  text: string;
  resolve: CardResolver;
  /** `append` (default) keeps the cards already in the pile. */
  mode?: "append" | "replace";
}

export interface PasteResult extends ApplyResult {
  unresolved: CardListResult["unresolved"];
}

/**
 * Fill a pile from pasted names and passcodes (one per line). Cards the resolver does not know
 * are listed in `unresolved` and skipped; the rest are stored. Also serves quick add from a
 * search box: pass the typed name as `text`.
 */
export function pasteList(state: SandboxBuilderState, options: PasteOptions): PasteResult {
  const { codes, unresolved } = resolveCardList(options.text, options.resolve);
  return finishPaste(state, options, codes, unresolved);
}

/** `pasteList` for a resolver that calls the server. */
export async function pasteListAsync(state: SandboxBuilderState, options: Omit<PasteOptions, "resolve"> & { resolve: AsyncCardResolver }): Promise<PasteResult> {
  const { codes, unresolved } = await resolveCardListAsync(options.text, options.resolve);
  return finishPaste(state, options, codes, unresolved);
}

function finishPaste(state: SandboxBuilderState, options: Omit<PasteOptions, "resolve" | "text">, codes: number[], unresolved: CardListResult["unresolved"]): PasteResult {
  if (codes.length === 0) return { state, added: 0, overflow: 0, unresolved };
  const applied = applyAction(state, { type: "paste", seat: options.seat, zone: options.zone, codes, mode: options.mode });
  return { ...applied, unresolved };
}

// ---------------------------------------------------------------------------------------------
// Read helpers for the UI

export function getEntry(state: SandboxBuilderState, loc: CardLoc): SandboxCardEntry | null {
  try {
    checkLoc(state.board, loc);
  } catch {
    return null;
  }
  return readEntry(workOf(state.board)[loc.seat], loc);
}

export interface SeatSummary {
  lp: number;
  hand: number;
  /** Monsters, Spells and Traps, Field Spell and Pendulum cards on the field. */
  field: number;
  grave: number;
  banished: number;
  /** Cards named on top. The Deck holds `deckSize` in all. */
  deckTop: number;
  extra: number;
}

export function seatSummary(state: SandboxBuilderState, seat: SandboxDuelistId): SeatSummary {
  const work = workOf(state.board)[seat];
  const filled = (list: Array<SandboxCardEntry | null>) => list.filter((e) => e !== null).length;
  return {
    lp: work.lp ?? DEFAULT_LP,
    hand: work.hand.length,
    field: filled(work.monsters.slice(0, slotCount(state.board, "monster"))) + filled(work.spells) + filled([work.field]) + filled(work.pendulum),
    grave: work.grave.length,
    banished: work.banished.length,
    deckTop: work.deck.length,
    extra: work.extra.length,
  };
}

/** Every distinct passcode on the board, Xyz materials included, in first-seen order. */
export function boardCodes(state: SandboxBuilderState): number[] {
  const seen = new Set<number>();
  const works = workOf(state.board);
  for (const id of seatsOf(state.board.format)) {
    const work = works[id];
    const entries: Array<SandboxCardEntry | null> = [...work.hand, ...work.monsters, ...work.spells, work.field, ...work.pendulum];
    for (const entry of entries) {
      if (entry === null) continue;
      seen.add(cardOf(entry));
      for (const material of specOf(entry).materials ?? []) seen.add(material);
    }
    for (const code of [...work.grave, ...work.banished, ...work.deck, ...work.extra]) seen.add(code);
    if (work.deckMaster !== null) seen.add(work.deckMaster);
  }
  return [...seen];
}

// ---------------------------------------------------------------------------------------------
// Undo and redo (for fast clear and paste)

export interface BuilderHistory {
  past: SandboxBuilderState[];
  present: SandboxBuilderState;
  future: SandboxBuilderState[];
}

export type HistoryAction = SandboxAction | { type: "undo" } | { type: "redo" } | { type: "load"; state: SandboxBuilderState } | { type: "replace"; state: SandboxBuilderState };

const HISTORY_LIMIT = 50;

export function createHistory(present: SandboxBuilderState): BuilderHistory {
  return { past: [], present, future: [] };
}

/** Reducer with undo/redo. Refused and no-op actions leave `past` alone. `load` resets the history. */
export function historyReducer(history: BuilderHistory, action: HistoryAction): BuilderHistory {
  if (action.type === "undo") {
    const previous = history.past[history.past.length - 1];
    if (!previous) return history;
    return { past: history.past.slice(0, -1), present: previous, future: [history.present, ...history.future] };
  }
  if (action.type === "redo") {
    const next = history.future[0];
    if (!next) return history;
    return { past: [...history.past, history.present].slice(-HISTORY_LIMIT), present: next, future: history.future.slice(1) };
  }
  if (action.type === "load") return createHistory(action.state);
  // Import: swap the whole board but keep undo, so a wrong code is one step back.
  if (action.type === "replace") {
    if (JSON.stringify(action.state) === JSON.stringify(history.present)) return history;
    return { past: [...history.past, history.present].slice(-HISTORY_LIMIT), present: action.state, future: [] };
  }
  const { state, error } = applyAction(history.present, action);
  if (error || JSON.stringify(state) === JSON.stringify(history.present)) return history;
  return { past: [...history.past, history.present].slice(-HISTORY_LIMIT), present: state, future: [] };
}
