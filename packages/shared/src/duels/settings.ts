import { DUEL_BANLIST_OPTIONS, NO_BANLIST_ID, PINNED_TCG_BANLIST_ID } from "./banlist-options.js";

export type DuelVisibility = "public" | "private";
export type DuelCardPool = "both" | "tcg" | "ocg";
export type DuelTimeout = "loss" | "continue";
export type DuelSettingsMode = "normal" | "domain";
export type DuelSettingsMasterRule = 1 | 2 | 3 | 4 | 5;

export { NO_BANLIST_ID, PINNED_TCG_BANLIST_ID };

/** Table formats. Seats are in turn order; Tag turn order is 1A, 2A, 1B, 2B, so the team of a seat is seat % 2. */
export type DuelFormat = "1v1" | "tag" | "ffa3" | "ffa4";

export const DUEL_FORMATS: readonly DuelFormat[] = ["1v1", "tag", "ffa3", "ffa4"];
export const DEFAULT_DUEL_FORMAT: DuelFormat = "1v1";
/** The most seats any format uses. */
export const MAX_DUEL_SEATS = 4;

const FORMAT_SEAT_COUNT: Record<DuelFormat, number> = { "1v1": 2, tag: 4, ffa3: 3, ffa4: 4 };

export function isDuelFormat(value: unknown): value is DuelFormat {
  return typeof value === "string" && (DUEL_FORMATS as readonly string[]).includes(value);
}

export function seatCountFor(format: DuelFormat): number {
  return FORMAT_SEAT_COUNT[format];
}

/** 1v1 and FFA: every seat is its own team. Tag: seats 0 and 2 are team 0, seats 1 and 3 are team 1. */
export function teamOfSeat(format: DuelFormat, seat: number): number {
  return format === "tag" ? seat % 2 : seat;
}

export function teamCountFor(format: DuelFormat): number {
  return format === "tag" ? 2 : seatCountFor(format);
}

export function seatsOfTeam(format: DuelFormat, team: number): number[] {
  const seats: number[] = [];
  for (let seat = 0; seat < seatCountFor(format); seat += 1) {
    if (teamOfSeat(format, seat) === team) seats.push(seat);
  }
  return seats;
}

export function opponentSeatsOf(format: DuelFormat, seat: number): number[] {
  const team = teamOfSeat(format, seat);
  const seats: number[] = [];
  for (let other = 0; other < seatCountFor(format); other += 1) {
    if (teamOfSeat(format, other) !== team) seats.push(other);
  }
  return seats;
}

/** The Tag partner of a seat; null in every other format. */
export function partnerSeatOf(format: DuelFormat, seat: number): number | null {
  if (format !== "tag") return null;
  return (seat + 2) % 4;
}

/** The living across seat that shares this seat's EMZ in FFA4; null in every other format. */
export function sharedExtraSeatOf(format: DuelFormat, seat: number, eliminated?: ReadonlySet<number>): number | null {
  if (format !== "ffa4" || !Number.isInteger(seat) || seat < 0 || seat >= 4 || eliminated?.has(seat)) return null;
  const across = (seat + 2) % 4;
  return eliminated?.has(across) ? null : across;
}

/**
 * Starting LP of one side. Tag: one shared total per team, the sum of its members' starting LP.
 * 1v1 and FFA: per duelist.
 */
export function startingLpFor(format: DuelFormat, settings: Pick<DuelSettings, "startingLP">): number {
  return format === "tag" ? settings.startingLP * 2 : settings.startingLP;
}

const SETTINGS_KEYS = [
  "visibility",
  "banlist",
  "cardPool",
  "turnSeconds",
  "startingLP",
  "startingHand",
  "drawPerTurn",
  "timeout",
  "validateDeck",
  "shuffleDeck",
  "stopAtEveryWindow",
] as const;

/**
 * Time-bank rules. `turnSeconds` is the bank size (the most a seat can hold). Every accepted decision
 * by a seat adds the increment back; every new duel turn each seat regains a quarter of the bank
 * (at least 30 s). Everything is capped at the bank. Single source of truth for server and web.
 */
export const DUEL_CLOCK_INCREMENT_MS = 3_000;
export const DUEL_CLOCK_REGAIN_FRACTION = 0.25;
export const DUEL_CLOCK_REGAIN_MIN_MS = 30_000;

export function duelClockBankMs(turnSeconds: number): number | null {
  if (!Number.isFinite(turnSeconds) || turnSeconds <= 0) return null;
  return turnSeconds * 1000;
}

/** Time each seat regains at the start of a turn; 0 when the room has no timer. */
export function duelClockRegainMs(turnSeconds: number): number {
  const bank = duelClockBankMs(turnSeconds);
  if (bank === null) return 0;
  const quarter = Math.round((bank * DUEL_CLOCK_REGAIN_FRACTION) / 1000) * 1000;
  return Math.min(bank, Math.max(DUEL_CLOCK_REGAIN_MIN_MS, quarter));
}

function formatClockSpan(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`;
}

/** e.g. "4 min bank · +3 s per move · +1 min each turn". Empty string when the room has no timer. */
export function duelClockRulesText(turnSeconds: number): string {
  const bank = duelClockBankMs(turnSeconds);
  if (bank === null) return "";
  return `${formatClockSpan(bank)} bank · +${formatClockSpan(DUEL_CLOCK_INCREMENT_MS)} per move · +${formatClockSpan(duelClockRegainMs(turnSeconds))} each turn`;
}

const CLOCK_KEYS = ["turn", "remainingMs", "activeSeat", "startedAt"] as const;

export interface DuelSettings {
  visibility: DuelVisibility;
  banlist: string;
  cardPool: DuelCardPool;
  turnSeconds: number;
  startingLP: number;
  startingHand: number;
  drawPerTurn: number;
  timeout: DuelTimeout;
  validateDeck: boolean;
  shuffleDeck: boolean;
  /**
   * true = the engine asks about every response window that lists a card (the pre-existing behaviour);
   * false = it passes a window silently when no listed card fits its timing (what EDOPro does).
   * It changes which prompts a duel has, so it is stored with the duel: rows saved without it read as
   * true, and a replay of a saved duel therefore sees the same prompts it was played with.
   */
  stopAtEveryWindow?: boolean;
}

export interface DuelClockState {
  turn: number;
  /** One entry per seat (2 to 4). */
  remainingMs: number[];
  activeSeat: number | null;
  startedAt: number | null;
}

export interface DuelClock extends DuelClockState {
  serverNow: number;
}

export class DuelSettingsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DuelSettingsError";
  }
}

function fail(message: string): never {
  throw new DuelSettingsError(message);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function firstUnknownKey(value: Record<string, unknown>, allowed: readonly string[]): string | undefined {
  return Object.keys(value).find((key) => !allowed.includes(key));
}

function asInteger(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    fail(`${label} must be an integer from ${min} to ${max}`);
  }
  return value;
}

function asBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") fail(`${label} must be a boolean`);
  return value;
}

function asBanlist(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 128 || value !== value.trim()) {
    fail("banlist must be a known versioned id");
  }
  if (!DUEL_BANLIST_OPTIONS.some((option) => option.id === value)) {
    fail("banlist must be a known versioned id");
  }
  return value;
}

function asTurnSeconds(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || (value !== 0 && (value < 30 || value > 3600))) {
    fail("turnSeconds must be 0 or an integer from 30 to 3600");
  }
  return value;
}

function readSetting<K extends keyof DuelSettings>(
  input: Record<string, unknown>,
  key: K,
  fallback: DuelSettings[K],
  parse: (value: unknown) => DuelSettings[K],
): DuelSettings[K] {
  if (!(key in input) || input[key] === undefined) return fallback;
  return parse(input[key]);
}

function parseSettingsObject(value: Record<string, unknown>, fallback: DuelSettings): DuelSettings {
  const visibility = readSetting(value, "visibility", fallback.visibility, (field) => {
    if (field !== "public" && field !== "private") fail("visibility must be public or private");
    return field;
  });
  const cardPool = readSetting(value, "cardPool", fallback.cardPool, (field) => {
    if (field !== "both" && field !== "tcg" && field !== "ocg") fail("cardPool must be both, tcg, or ocg");
    return field;
  });
  const timeout = readSetting(value, "timeout", fallback.timeout, (field) => {
    if (field !== "loss" && field !== "continue") fail("timeout must be loss or continue");
    return field;
  });
  return {
    visibility,
    banlist: readSetting(value, "banlist", fallback.banlist, asBanlist),
    cardPool,
    turnSeconds: readSetting(value, "turnSeconds", fallback.turnSeconds, asTurnSeconds),
    startingLP: readSetting(value, "startingLP", fallback.startingLP, (field) => asInteger(field, "startingLP", 1, 100000)),
    startingHand: readSetting(value, "startingHand", fallback.startingHand, (field) => asInteger(field, "startingHand", 0, 40)),
    drawPerTurn: readSetting(value, "drawPerTurn", fallback.drawPerTurn, (field) => asInteger(field, "drawPerTurn", 0, 10)),
    timeout,
    validateDeck: readSetting(value, "validateDeck", fallback.validateDeck, (field) => asBoolean(field, "validateDeck")),
    shuffleDeck: readSetting(value, "shuffleDeck", fallback.shuffleDeck, (field) => asBoolean(field, "shuffleDeck")),
    stopAtEveryWindow: readSetting(value, "stopAtEveryWindow", fallback.stopAtEveryWindow, (field) => asBoolean(field, "stopAtEveryWindow")),
  };
}

export function defaultDuelSettings(mode: DuelSettingsMode, format: DuelFormat = DEFAULT_DUEL_FORMAT): DuelSettings {
  return {
    visibility: "public",
    banlist: mode === "domain" ? NO_BANLIST_ID : PINNED_TCG_BANLIST_ID,
    cardPool: "both",
    turnSeconds: 240,
    startingLP: 8000,
    startingHand: 5,
    drawPerTurn: 1,
    timeout: "loss",
    validateDeck: true,
    shuffleDeck: true,
    stopAtEveryWindow: format !== "1v1",
  };
}

/** Pre-creator rows: no banlist, unlimited clock, classic start numbers. */
export function legacyDuelSettings(): DuelSettings {
  return {
    visibility: "public",
    banlist: NO_BANLIST_ID,
    cardPool: "both",
    turnSeconds: 0,
    startingLP: 8000,
    startingHand: 5,
    drawPerTurn: 1,
    timeout: "loss",
    validateDeck: true,
    shuffleDeck: true,
    stopAtEveryWindow: true,
  };
}

export function normalizeDuelSettings(mode: DuelSettingsMode, input: unknown, format: DuelFormat = DEFAULT_DUEL_FORMAT): DuelSettings {
  if (mode !== "normal" && mode !== "domain") fail("Duel mode must be normal or domain");
  if (input === undefined || input === null) return defaultDuelSettings(mode, format);
  if (!isObject(input)) fail("settings must be an object");
  const extra = firstUnknownKey(input, SETTINGS_KEYS);
  if (extra) fail(`Unknown duel setting: ${extra}`);
  return parseSettingsObject(input, defaultDuelSettings(mode, format));
}

export function isCustomDomain(masterRule: DuelSettingsMasterRule, settings: DuelSettings): boolean {
  return (
    masterRule !== 5 ||
    settings.banlist !== NO_BANLIST_ID ||
    settings.cardPool !== "both" ||
    settings.startingLP !== 8000 ||
    settings.startingHand !== 5 ||
    settings.drawPerTurn !== 1 ||
    !settings.validateDeck ||
    !settings.shuffleDeck
  );
}

export function parseStoredDuelSettings(raw: string | null): DuelSettings {
  if (raw == null) return legacyDuelSettings();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    fail("Stored duel settings are corrupt");
  }
  if (!isObject(parsed)) fail("Stored duel settings are corrupt");
  try {
    return parseSettingsObject(parsed, legacyDuelSettings());
  } catch (error) {
    if (error instanceof DuelSettingsError) fail("Stored duel settings are corrupt");
    throw error;
  }
}

function asRemainingMs(value: unknown): number[] {
  const message = `remainingMs must be a list of 2 to ${MAX_DUEL_SEATS} non-negative integers`;
  if (!Array.isArray(value) || value.length < 2 || value.length > MAX_DUEL_SEATS) fail(message);
  const parsed: number[] = [];
  for (const entry of value) {
    if (typeof entry !== "number" || !Number.isInteger(entry) || entry < 0) fail(message);
    parsed.push(entry);
  }
  return parsed;
}

function asSeat(value: unknown, seatCount: number): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value >= seatCount) {
    fail(`activeSeat must be a seat from 0 to ${seatCount - 1}, or null`);
  }
  return value;
}

function asStartedAt(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    fail("startedAt must be a non-negative integer or null");
  }
  return value;
}

function parseClockObject(input: Record<string, unknown>, rejectUnknown: boolean): DuelClockState {
  if (rejectUnknown) {
    const extra = firstUnknownKey(input, CLOCK_KEYS);
    if (extra) fail(`Unknown clock field: ${extra}`);
  }
  if (!("turn" in input) || !("remainingMs" in input) || !("activeSeat" in input) || !("startedAt" in input)) {
    fail("clock is missing required fields");
  }
  const remainingMs = asRemainingMs(input.remainingMs);
  return {
    turn: asInteger(input.turn, "turn", 0, 1_000_000),
    remainingMs,
    activeSeat: asSeat(input.activeSeat, remainingMs.length),
    startedAt: asStartedAt(input.startedAt),
  };
}

export function normalizeDuelClockState(input: unknown): DuelClockState {
  if (!isObject(input)) fail("clock must be an object");
  return parseClockObject(input, true);
}

export function parseStoredDuelClock(raw: string | null): DuelClockState | null {
  if (raw == null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    fail("Stored duel clock is corrupt");
  }
  if (!isObject(parsed)) fail("Stored duel clock is corrupt");
  try {
    return parseClockObject(parsed, false);
  } catch (error) {
    if (error instanceof DuelSettingsError) fail("Stored duel clock is corrupt");
    throw error;
  }
}

export function clockWithServerNow(clock: DuelClockState | null, serverNow = Date.now()): DuelClock | null {
  if (!clock) return null;
  return { ...clock, serverNow };
}
