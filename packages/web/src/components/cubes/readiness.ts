/**
 * Theme draft readiness for a cube, at the default settings: 3 choices a pick, 40 main,
 * 15 extra, no burn. The same rule as the server's pool analysis (`analyzeCubePools`):
 * a pool needs `cards + (choices - 1)` copies, so 42 main and 17 Extra. A player can be given
 * at most 3 copies of a card, so a card counts at most ×3 here however many copies the cube holds.
 */
export const THEME_CHOICES = 3;
export const THEME_MAIN_CARDS = 40;
export const THEME_EXTRA_CARDS = 15;
export const THEME_MAIN_NEEDED = THEME_MAIN_CARDS + (THEME_CHOICES - 1);
export const THEME_EXTRA_NEEDED = THEME_EXTRA_CARDS + (THEME_CHOICES - 1);
/** Copies of one card a cube can hold: a quantity, not a deck limit. Mirrors MAX_CUBE_COPIES in shared. */
export const MAX_COPIES = 99;
export const MIN_COPIES = 1;
/** The most copies of one card a single player can be given in a draft. Mirrors MAX_COPIES_PER_PLAYER in shared. */
export const PLAYER_COPY_CAP = 3;

export interface PoolEntry {
  maxCopies: number;
}

export interface PoolTotals {
  cards: number;
  /** Copies in the cube. */
  copies: number;
  /** Copies one player can be given: each card counts at most PLAYER_COPY_CAP times. */
  usable: number;
}

export function poolTotals(entries: readonly PoolEntry[]): PoolTotals {
  let copies = 0;
  let usable = 0;
  for (const entry of entries) {
    copies += entry.maxCopies;
    usable += Math.min(entry.maxCopies, PLAYER_COPY_CAP);
  }
  return { cards: entries.length, copies, usable };
}

export interface PoolReadiness {
  have: number;
  need: number;
  short: number;
  /** 0 to 100, for the meter. */
  pct: number;
}

export type ReadinessState = "blocked" | "soft" | "ready";

export interface CubeReadiness {
  main: PoolReadiness;
  extra: PoolReadiness;
  /** blocked: short on main (a theme draft cannot start). soft: only Extra is short. */
  state: ReadinessState;
}

function pool(have: number, need: number): PoolReadiness {
  const short = Math.max(0, need - have);
  return { have, need, short, pct: need <= 0 ? 100 : Math.min(100, Math.round((have / need) * 100)) };
}

export function cubeReadiness(mainCopies: number, extraCopies: number): CubeReadiness {
  const main = pool(mainCopies, THEME_MAIN_NEEDED);
  const extra = pool(extraCopies, THEME_EXTRA_NEEDED);
  const state: ReadinessState = main.short > 0 ? "blocked" : extra.short > 0 ? "soft" : "ready";
  return { main, extra, state };
}

/**
 * How many cards, raised to ×3 (the most one player can be given) starting with the ones that gain the most, cover a shortfall.
 * Null when raising every card to ×3 still is not enough.
 */
export function cardsToRaise(entries: readonly PoolEntry[], short: number): number | null {
  if (short <= 0) return 0;
  const gains = entries
    .map((entry) => PLAYER_COPY_CAP - entry.maxCopies)
    .filter((gain) => gain > 0)
    .sort((a, b) => b - a);
  let covered = 0;
  for (let i = 0; i < gains.length; i += 1) {
    covered += gains[i]!;
    if (covered >= short) return i + 1;
  }
  return null;
}

export function clampCopies(value: number): number {
  return Math.min(MAX_COPIES, Math.max(MIN_COPIES, Math.round(value)));
}

/** Booster readiness uses all Main Deck copies for the deal and legal copies for a deck warning. */
export const BOOSTER_DEFAULT_CARDS = 40;
export const BOOSTER_DEFAULT_PACK_SIZE = 15;
/** A draft needs two players at least. */
export const BOOSTER_MIN_PLAYERS = 2;

export interface BoosterSettings {
  cardsPerPlayer?: number;
  packSize?: number;
  packsPerPlayer?: number;
  poolFromConfig?: boolean;
}

export interface BoosterReadiness {
  /** Copies in the cube's Main pool. */
  copies: number;
  cardsPerPlayer: number;
  packSize: number;
  /** Packs each player opens. */
  waves: number;
  /** Cards one player can reach, and cards the deck needs. */
  reach: PoolReadiness;
  /** Copies in the cube and the copies two players need. */
  copies2: PoolReadiness;
  /** Most players the cube can seat: copies ÷ (packs × pack size), rounded down. */
  maxPlayers: number;
  state: "blocked" | "ready";
}

function positive(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

export function boosterReadiness(copies: number, usable: number, settings: BoosterSettings = {}): BoosterReadiness {
  const cardsPerPlayer = positive(settings.cardsPerPlayer, BOOSTER_DEFAULT_CARDS);
  const packSize = positive(settings.packSize, BOOSTER_DEFAULT_PACK_SIZE);
  const waves = positive(settings.packsPerPlayer, Math.max(1, Math.ceil(cardsPerPlayer / packSize)));
  const reach = pool(usable, cardsPerPlayer);
  const copies2 = pool(copies, BOOSTER_MIN_PLAYERS * waves * packSize);
  const maxPlayers = Math.floor(copies / (waves * packSize));
  return { copies, cardsPerPlayer, packSize, waves, reach, copies2, maxPlayers,
    state: copies2.short > 0 || cardsPerPlayer > waves * packSize ? "blocked" : "ready" };
}
