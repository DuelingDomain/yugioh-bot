import { DUEL_BANLIST_OPTIONS, NO_BANLIST_ID, PINNED_TCG_BANLIST_ID } from "./banlist-options.js";

export type DuelVisibility = "public" | "private";
export type DuelCardPool = "both" | "tcg" | "ocg";
export type DuelTimeout = "loss" | "continue";
export type DuelSettingsMode = "normal" | "domain";
export type DuelSettingsMasterRule = 1 | 2 | 3 | 4 | 5;

export { NO_BANLIST_ID, PINNED_TCG_BANLIST_ID };

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
] as const;

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
}

export interface DuelClockState {
  turn: number;
  remainingMs: [number, number];
  activeSeat: 0 | 1 | null;
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
  };
}

export function defaultDuelSettings(mode: DuelSettingsMode): DuelSettings {
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
  };
}

export function normalizeDuelSettings(mode: DuelSettingsMode, input: unknown): DuelSettings {
  if (mode !== "normal" && mode !== "domain") fail("Duel mode must be normal or domain");
  if (input === undefined || input === null) return defaultDuelSettings(mode);
  if (!isObject(input)) fail("settings must be an object");
  const extra = firstUnknownKey(input, SETTINGS_KEYS);
  if (extra) fail(`Unknown duel setting: ${extra}`);
  return parseSettingsObject(input, defaultDuelSettings(mode));
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

function asSeat(value: unknown): 0 | 1 | null {
  if (value === null) return null;
  if (value !== 0 && value !== 1) fail("activeSeat must be 0, 1, or null");
  return value;
}

function asRemainingMs(value: unknown): [number, number] {
  if (!Array.isArray(value) || value.length !== 2) fail("remainingMs must be a pair of non-negative integers");
  const left = value[0];
  const right = value[1];
  if (typeof left !== "number" || !Number.isInteger(left) || left < 0 || typeof right !== "number" || !Number.isInteger(right) || right < 0) {
    fail("remainingMs must be a pair of non-negative integers");
  }
  return [left, right];
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
  return {
    turn: asInteger(input.turn, "turn", 0, 1_000_000),
    remainingMs: asRemainingMs(input.remainingMs),
    activeSeat: asSeat(input.activeSeat),
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
