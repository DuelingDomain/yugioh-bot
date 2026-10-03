import { isMonster, isSpell, isTrap, type CardSummary } from "@/lib/card-types";
import { formatPickSeconds } from "../pick-time";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "2 sets, 36 passcodes", "1 set", "Nothing yet". */
export function poolRowText(setCount: number, passcodeCount: number): string {
  const parts: string[] = [];
  if (setCount > 0) parts.push(plural(setCount, "set", "sets"));
  if (passcodeCount > 0) parts.push(plural(passcodeCount, "passcode", "passcodes"));
  return parts.length ? parts.join(", ") : "Nothing yet";
}

/** A card in a cube's main pool and how many copies of it the cube holds. */
export type SavedPoolCard = { id: number; copies: number };

/**
 * Passcodes a saved pool loads into the form. A pool saved from the form keeps its ids
 * (repeats = copies) in the config; a cube built in the editor keeps them as cards in its
 * main pool, each listed once per copy it holds. Config ids come first, then main-pool
 * cards the config does not already list.
 * The Extra Deck pool is left out: cube drafts deal main-deck cards only.
 */
export function savedPoolIds(customCardIds: number[] = [], mainCards: SavedPoolCard[] = []): number[] {
  const listed = new Set(customCardIds);
  const ids = [...customCardIds];
  for (const { id, copies } of mainCards) {
    if (listed.has(id)) continue;
    for (let i = 0; i < copies; i += 1) ids.push(id);
  }
  return ids;
}

/** The status line after a saved pool loads. */
export function loadedPoolHint(name: string, setCount: number, passcodeCount: number, extraCount = 0): string {
  const skipped =
    extraCount > 0
      ? ` ${plural(extraCount, "Extra Deck card isn't", "Extra Deck cards aren't")} loaded; cube drafts deal main-deck cards.`
      : "";
  return `Loaded ${name}: ${poolRowText(setCount, passcodeCount)}.${skipped} Loading replaces the pool below.`;
}

/** The sentence under the pack fields; the leftover sentence is dropped when nothing is left over. */
export function packsSentence(cardsPerPlayer: number, packsPerPlayer: number, packSize: number): string {
  const left = packsPerPlayer * packSize - cardsPerPlayer;
  const base = `Each player drafts ${cardsPerPlayer} cards across ${plural(packsPerPlayer, "pack", "packs")} of ${packSize}.`;
  if (left <= 0) return base;
  const last = left === 1 ? "The last card" : `The last ${left} cards`;
  return `${base} ${last} of pack ${packsPerPlayer} ${left === 1 ? "isn't" : "aren't"} picked.`;
}

export type PoolTally = { total: number; monsters: number; spells: number; traps: number };

/** Copies by kind across the resolved pool (a card with qty 3 counts three times). */
export function tallyPool(cards: CardSummary[]): PoolTally {
  const t: PoolTally = { total: 0, monsters: 0, spells: 0, traps: 0 };
  for (const c of cards) {
    const n = c.qty ?? 1;
    t.total += n;
    if (isMonster(c.type)) t.monsters += n;
    else if (isSpell(c.type)) t.spells += n;
    else if (isTrap(c.type)) t.traps += n;
  }
  return t;
}

export function themeSelectionText(selection: "player_pick" | "random", unique: boolean): string {
  return `${selection === "random" ? "Random" : "Players pick"}, ${unique ? "all different" : "can repeat"}`;
}

export const secondsText = (s: number) => formatPickSeconds(s);
