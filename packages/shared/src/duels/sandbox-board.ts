import type { DuelMasterRule, DuelMode } from "./index.js";
import { DUEL_FORMATS, seatCountFor, type DuelFormat } from "./settings.js";

/** Shared structural limits. Byte limits apply to compact UTF-8 JSON, including defaults. */
export const SANDBOX_LIMITS = Object.freeze({
  boardBytes: 32 * 1024,
  runBytes: 1024,
  hand: 20,
  monsters: 7,
  spells: 5,
  pendulum: 2,
  grave: 60,
  banished: 60,
  deck: 60,
  deckSize: 60,
  extra: 30,
  materials: 10,
  lpMin: 1,
  lpMax: 999999,
  passcodeMax: 0xffffffff,
});

export type SandboxDuelistId = "p0" | "p1" | "p2" | "p3";
export const SANDBOX_START_PHASES = Object.freeze(["draw", "standby", "main1", "battle", "main2", "end"] as const);
export type SandboxStartPhase = typeof SANDBOX_START_PHASES[number];

export type SandboxStance = "atk" | "def" | "set" | "up";

/** Numeric subset of the compiler's CardSpec. Catalog validity is checked by the server. */
export interface SandboxCardSpec {
  card: number;
  pos?: SandboxStance;
  materials?: number[];
  summoned?: boolean;
}
export type SandboxCardEntry = number | SandboxCardSpec;

/** Numeric subset of DuelistSetup. Omitted LP uses the compiler's starting LP (8000). */
export interface SandboxDuelistSetup {
  lp?: number;
  hand?: SandboxCardEntry[];
  /** Slots 0-4 are main zones; 5-6 are EMZ (Master Rule 4+). Null keeps a gap. */
  monsters?: Array<SandboxCardEntry | null>;
  spells?: Array<SandboxCardEntry | null>;
  field?: SandboxCardEntry;
  pendulum?: [SandboxCardEntry | null, SandboxCardEntry | null];
  grave?: number[];
  banished?: number[];
  /** Ordered top cards; board.deckSize includes the filler below them. */
  deck?: number[];
  extra?: number[];
  deckMaster?: number;
}

/**
 * JSON-only BoardSpec subset, assignable to the compiler without conversion.
 * No teams, Lua, or withoutCoreFunctions. The host walks from Draw Phase to startAt.
 * Optional fields keep board drafts small; parseSandboxBoard fills the board-level defaults.
 */
export interface SandboxBoard {
  format?: DuelFormat;
  mode?: DuelMode;
  masterRule?: DuelMasterRule;
  turn?: SandboxDuelistId;
  startAt?: SandboxStartPhase;
  /** FFA only. Seats stay in place and must contain no cards; at least two seats remain active. */
  eliminated?: SandboxDuelistId[];
  /** Only false is allowed: a sandbox must visit Draw Phase. */
  skipOpeningDraw?: false;
  attackFirstTurn?: boolean;
  /** One size for every seat, including filler. Default 20; range 0-60. */
  deckSize?: number;
  p0?: SandboxDuelistSetup;
  p1?: SandboxDuelistSetup;
  p2?: SandboxDuelistSetup;
  p3?: SandboxDuelistSetup;
}

export type SandboxBotMode = "pass" | "practice" | "manual";
export interface SandboxRun {
  /** All three keys are stored, even for 1v1. Seat 0 is always manual and has no key. */
  bots: Record<"1" | "2" | "3", SandboxBotMode>;
  /** Four nonzero decimal uint64 strings, as required by the duel engine. Omit for random. */
  seed?: [string, string, string, string];
}

/** First invalid field. Paths use p0.monsters[0].card notation; $ means the whole input. */
export class SandboxBoardError extends Error {
  constructor(public readonly path: string, message: string) {
    super(message);
    this.name = "SandboxBoardError";
  }
}

const SEATS: readonly SandboxDuelistId[] = ["p0", "p1", "p2", "p3"];
const SEAT_KEYS = ["lp", "hand", "monsters", "spells", "field", "pendulum", "grave", "banished", "deck", "extra", "deckMaster"] as const;
const BOARD_KEYS = ["format", "mode", "masterRule", "turn", "startAt", "eliminated", "skipOpeningDraw", "attackFirstTurn", "deckSize", ...SEATS];

function fail(path: string, message: string): never {
  throw new SandboxBoardError(path, message);
}

function child(path: string, key: string): string {
  return path === "$" ? key : `${path}.${key}`;
}

function object(value: unknown, path: string, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(path, "Expected a JSON object.");
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) fail(path, "Expected a plain JSON object.");
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) fail(child(path, key), "Unsupported field.");
  }
  return value as Record<string, unknown>;
}

function integer(value: unknown, path: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    fail(path, `Expected an integer from ${min} to ${max}.`);
  }
  return value;
}

function choice<T extends string | number | boolean>(value: unknown, path: string, values: readonly T[]): T {
  if (!values.includes(value as T)) fail(path, `Expected one of: ${values.join(", ")}.`);
  return value as T;
}

function passcode(value: unknown, path: string): number {
  return integer(value, path, 1, SANDBOX_LIMITS.passcodeMax);
}

function list<T>(value: unknown, path: string, max: number, parse: (entry: unknown, path: string) => T): T[] {
  if (!Array.isArray(value)) fail(path, "Expected an array.");
  if (value.length > max) fail(path, `Use at most ${max} entries.`);
  // Array.from visits holes, so sparse arrays cannot hide an invalid entry.
  return Array.from(value, (entry, index) => parse(entry, `${path}[${index}]`));
}

function cardEntry(value: unknown, path: string): SandboxCardEntry {
  if (typeof value !== "object" || value === null) return passcode(value, path);
  const input = object(value, path, ["card", "pos", "materials", "summoned"]);
  const result: SandboxCardSpec = { card: passcode(input.card, `${path}.card`) };
  if (Object.hasOwn(input, "pos")) result.pos = choice(input.pos, `${path}.pos`, ["atk", "def", "set", "up"] as const);
  if (Object.hasOwn(input, "materials")) {
    result.materials = list(input.materials, `${path}.materials`, SANDBOX_LIMITS.materials, passcode);
  }
  if (Object.hasOwn(input, "summoned")) result.summoned = choice(input.summoned, `${path}.summoned`, [true, false]);
  return result;
}

function slot(value: unknown, path: string): SandboxCardEntry | null {
  return value === null ? null : cardEntry(value, path);
}

function duelist(value: unknown, path: string, eliminated: boolean): SandboxDuelistSetup {
  const input = object(value, path, SEAT_KEYS);
  const result: SandboxDuelistSetup = {};
  if (Object.hasOwn(input, "lp")) result.lp = integer(input.lp, `${path}.lp`, eliminated ? 0 : SANDBOX_LIMITS.lpMin, SANDBOX_LIMITS.lpMax);
  if (Object.hasOwn(input, "hand")) result.hand = list(input.hand, `${path}.hand`, SANDBOX_LIMITS.hand, cardEntry);
  for (const key of ["monsters", "spells"] as const) {
    if (Object.hasOwn(input, key)) result[key] = list(input[key], `${path}.${key}`, SANDBOX_LIMITS[key], slot);
  }
  if (Object.hasOwn(input, "field")) result.field = cardEntry(input.field, `${path}.field`);
  if (Object.hasOwn(input, "pendulum")) {
    const entries = list(input.pendulum, `${path}.pendulum`, SANDBOX_LIMITS.pendulum, slot);
    result.pendulum = [entries[0] ?? null, entries[1] ?? null];
  }
  for (const key of ["grave", "banished", "deck", "extra"] as const) {
    if (Object.hasOwn(input, key)) result[key] = list(input[key], `${path}.${key}`, SANDBOX_LIMITS[key], passcode);
  }
  if (Object.hasOwn(input, "deckMaster")) result.deckMaster = passcode(input.deckMaster, `${path}.deckMaster`);
  return result;
}

function checkSize(value: SandboxBoard | SandboxRun, limit: number): void {
  // Both parsers construct fresh, bounded JSON data before this call. No Node-only Buffer dependency.
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > limit) {
    fail("$", `Serialized JSON must not exceed ${limit} bytes.`);
  }
}

/**
 * Parse untrusted board data in web or server code. Returns a fresh JSON value; never mutates input.
 * Defaults: 1v1, normal, MR5, p0, deckSize 20, startAt draw. Missing seats stay absent (empty).
 * Rejects unknown fields and reports the first structural error; does not query a card catalog.
 * Runtime card legality and multi-core turn support remain the compiler/host's responsibility.
 */
export function parseSandboxBoard(value: unknown): SandboxBoard {
  const input = object(value, "$", BOARD_KEYS);
  const format = Object.hasOwn(input, "format") ? choice(input.format, "format", DUEL_FORMATS) : "1v1";
  const mode = Object.hasOwn(input, "mode") ? choice(input.mode, "mode", ["normal", "domain"] as const) : "normal";
  const masterRule = Object.hasOwn(input, "masterRule") ? choice(input.masterRule, "masterRule", [1, 2, 3, 4, 5] as const) : 5;
  const turn = Object.hasOwn(input, "turn") ? choice(input.turn, "turn", SEATS) : "p0";
  const deckSize = Object.hasOwn(input, "deckSize") ? integer(input.deckSize, "deckSize", 0, SANDBOX_LIMITS.deckSize) : 20;
  const startAt = Object.hasOwn(input, "startAt") ? choice(input.startAt, "startAt", SANDBOX_START_PHASES) : "draw";
  const result: SandboxBoard = { format, mode, masterRule, turn, deckSize, startAt };
  if (Object.hasOwn(input, "skipOpeningDraw")) result.skipOpeningDraw = choice(input.skipOpeningDraw, "skipOpeningDraw", [false] as const);
  if (Object.hasOwn(input, "attackFirstTurn")) result.attackFirstTurn = choice(input.attackFirstTurn, "attackFirstTurn", [true, false]);

  if (startAt === "battle" && turn === "p0" && result.attackFirstTurn !== true) {
    fail("startAt", "Battle Phase on turn 1 requires attackFirstTurn to be true.");
  }

  const seatCount = seatCountFor(format);
  const eliminated = new Set<SandboxDuelistId>();
  if (Object.hasOwn(input, "eliminated")) {
    if (format !== "ffa3" && format !== "ffa4") fail("eliminated", "Eliminated seats require ffa3 or ffa4.");
    result.eliminated = list(input.eliminated, "eliminated", SEATS.length, (entry, path) => {
      const seat = choice(entry, path, SEATS.slice(0, seatCount));
      if (eliminated.has(seat)) fail(path, "Seat is already in eliminated.");
      eliminated.add(seat);
      return seat;
    });
    if (seatCount - eliminated.size < 2) fail("eliminated", "At least two seats must remain active.");
    if (eliminated.has(turn)) fail("turn", "Turn player cannot be eliminated.");
  }
  if (SEATS.indexOf(turn) >= seatCount) fail("turn", `Turn player must be a seat of ${format}.`);
  for (const [index, id] of SEATS.entries()) {
    if (index >= seatCount) {
      if (Object.hasOwn(input, id)) fail(id, `Seat does not exist in ${format}.`);
      continue;
    }
    const setup = Object.hasOwn(input, id) ? duelist(input[id], id, eliminated.has(id)) : undefined;
    if (setup) {
      if (eliminated.has(id)) {
        for (const key of SEAT_KEYS) {
          if (key === "lp") continue;
          const zone = setup[key];
          if (Array.isArray(zone) ? zone.some((card) => card !== null) : zone !== undefined) {
            fail(`${id}.${key}`, "Remove all cards from an eliminated seat.");
          }
        }
      }
      if (format === "tag" && index >= 2 && setup.lp !== undefined) fail(`${id}.lp`, "Set team LP on p0 or p1 only.");
      if ((setup.deck?.length ?? 0) > deckSize) fail(`${id}.deck`, "Deck top must fit in board.deckSize.");
      if (masterRule < 4) {
        for (const zone of [5, 6]) {
          if (setup.monsters?.[zone] != null) fail(`${id}.monsters[${zone}]`, "Extra Monster Zones need Master Rule 4 or 5.");
        }
      }
      if (mode !== "domain" && setup.deckMaster !== undefined) fail(`${id}.deckMaster`, "Deck Masters require Domain mode.");
      result[id] = setup;
    }
    if (mode === "domain" && !eliminated.has(id) && setup?.deckMaster === undefined) fail(`${id}.deckMaster`, "Every active Domain seat needs a Deck Master.");
  }
  checkSize(result, SANDBOX_LIMITS.boardBytes);
  return result;
}

/** Parse run settings with the same error shape. Bot modes for inactive seats are stored but unused. */
export function parseSandboxRun(value: unknown): SandboxRun {
  const input = object(value, "$", ["bots", "seed"]);
  const modes = object(input.bots, "bots", ["1", "2", "3"]);
  const parseMode = (seat: string) => choice(modes[seat], `bots.${seat}`, ["pass", "practice", "manual"] as const);
  const result: SandboxRun = { bots: { "1": parseMode("1"), "2": parseMode("2"), "3": parseMode("3") } };
  if (Object.hasOwn(input, "seed")) {
    const seed = list(input.seed, "seed", 4, (part, path) => {
      if (typeof part !== "string" || !/^[0-9]+$/.test(part)) fail(path, "Expected a nonzero decimal uint64 string.");
      return part;
    });
    if (seed.length !== 4) fail("seed", "Expected exactly four seed strings.");
    result.seed = seed as SandboxRun["seed"];
    // Check bytes before converting arbitrary-length strings to BigInt.
    checkSize(result, SANDBOX_LIMITS.runBytes);
    for (const [index, part] of seed.entries()) {
      const number = BigInt(part);
      if (number === 0n || number > 0xffffffffffffffffn) fail(`seed[${index}]`, "Expected a nonzero decimal uint64 string.");
    }
  }
  checkSize(result, SANDBOX_LIMITS.runBytes);
  return result;
}
