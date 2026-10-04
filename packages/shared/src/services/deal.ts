import { createHmac } from "node:crypto";
import type { DraftConfig } from "../types/index.js";
import { MAX_COPIES_PER_PLAYER } from "./constants.js";

/** Numeric seeds preserve existing test fixtures; production uses secret string seeds. */
export type ShuffleSeed = number | string;

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededRandom(seed: ShuffleSeed): () => number {
  if (typeof seed === "number") return mulberry32(seed);

  // Do not reduce the secret to a 32-bit PRNG state: visible packs would let a
  // participant brute-force that state and reconstruct the rest of the deal.
  let counter = 0;
  return () => createHmac("sha256", seed).update(String(counter++)).digest().readUInt32BE(0) / 4294967296;
}

export function seededShuffle<T>(items: T[], seed: ShuffleSeed): T[] {
  const result = items.slice();
  const rand = seededRandom(seed);
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export interface CubeAnalysis {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

/** Sets and named pools have no authored quantities; expand evenly before the single shuffle. */
export function prepareBoosterPool(cardIds: number[], config: DraftConfig, slots: number): number[] {
  const fromNames = Boolean(config.setNames?.length || config.includeNames?.length);
  const authored = Boolean(config.preservePoolCopies || (!fromNames && (config.customCardIds?.length || config.cubeCardIds?.length || config.poolCardIds?.length)));
  if (authored || cardIds.length === 0) return cardIds;

  // catalogCardIdsForDraft returns baseIds first, then eligible custom copies.
  // Use that boundary so overlapping passcodes keep their additive quantities.
  const eligibleIds = new Set(cardIds);
  const customCopies = (config.customCardIds ?? []).filter((id) => eligibleIds.has(id));
  const baseIds = cardIds.slice(0, cardIds.length - customCopies.length);
  if (baseIds.length === 0) return cardIds;
  const copies = Math.max(1, Math.ceil((slots - customCopies.length) / baseIds.length));
  return [...baseIds.flatMap((id) => Array<number>(copies).fill(id)), ...customCopies];
}

export function analyzeCube(
  cubeCardIds: number[],
  players: number,
  waves: number,
  packSize: number,
  cardsPerPlayer = waves * packSize,
): CubeAnalysis {
  const errors: string[] = [];
  const warnings: string[] = [];
  const slots = players * waves * packSize;
  if (cubeCardIds.length < slots) {
    errors.push(`The cube has ${cubeCardIds.length} cards. ${players} players × ${waves} packs × ${packSize} cards needs ${slots}. Add cards, or use fewer packs or smaller packs.`);
  }
  if (cardsPerPlayer > waves * packSize) {
    errors.push(`Each player opens ${waves} packs of ${packSize} = ${waves * packSize} cards, but needs ${cardsPerPlayer}.`);
  }
  const counts = new Map<number, number>();
  for (const id of cubeCardIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  const reachable = [...counts.values()].reduce((sum, count) => sum + Math.min(count, MAX_COPIES_PER_PLAYER), 0);
  if (reachable < cardsPerPlayer) {
    warnings.push(`A player cannot make a legal ${cardsPerPlayer}-card deck from this cube.`);
  }
  return { ok: errors.length === 0, errors, warnings };
}

/** Shuffle every authored copy once; packs are stored in wave then seat order. */
export function buildDealWithRemainder(
  cubeCardIds: number[],
  opts: { players: number; waves: number; packSize: number; seed: ShuffleSeed },
): { packs: number[][]; remainder: number[] } {
  const { players, waves, packSize, seed } = opts;
  const slots = players * waves * packSize;
  if (cubeCardIds.length < slots) {
    throw new Error(`The cube has ${cubeCardIds.length} cards, but needs ${slots}.`);
  }
  const deck = seededShuffle(cubeCardIds, seed);
  return {
    packs: Array.from({ length: players * waves }, (_, i) => deck.slice(i * packSize, (i + 1) * packSize)),
    remainder: deck.slice(slots),
  };
}

export function buildDeal(cubeCardIds: number[], opts: Parameters<typeof buildDealWithRemainder>[1]): number[][] {
  return buildDealWithRemainder(cubeCardIds, opts).packs;
}
