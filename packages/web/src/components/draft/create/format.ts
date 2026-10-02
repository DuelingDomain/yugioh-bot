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
