/**
 * Theme Draft readiness for a cube, at the default settings: 3 choices a pick, 40 main,
 * 15 extra, no burn. The same rule as the server's pool analysis (`analyzeCubePools`):
 * a pool needs `cards + (choices - 1)` copies, so 42 main and 17 Extra.
 */
export const THEME_CHOICES = 3;
export const THEME_MAIN_CARDS = 40;
export const THEME_EXTRA_CARDS = 15;
export const THEME_MAIN_NEEDED = THEME_MAIN_CARDS + (THEME_CHOICES - 1);
export const THEME_EXTRA_NEEDED = THEME_EXTRA_CARDS + (THEME_CHOICES - 1);
export const MAX_COPIES = 3;
export const MIN_COPIES = 1;

export interface PoolEntry {
  maxCopies: number;
}

export interface PoolTotals {
  cards: number;
  copies: number;
}

export function poolTotals(entries: readonly PoolEntry[]): PoolTotals {
  let copies = 0;
  for (const entry of entries) copies += entry.maxCopies;
  return { cards: entries.length, copies };
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
  /** blocked: short on main (a Theme Draft cannot start). soft: only Extra is short. */
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
 * How many cards, raised to ×3 starting with the ones that gain the most, cover a shortfall.
 * Null when raising every card to ×3 still is not enough.
 */
export function cardsToRaise(entries: readonly PoolEntry[], short: number): number | null {
  if (short <= 0) return 0;
  const gains = entries
    .map((entry) => MAX_COPIES - entry.maxCopies)
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
