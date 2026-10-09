import type { DraftConfig } from "../types/index.js";
import { buildDealWithRemainder, seededShuffle, type ShuffleSeed } from "./deal.js";

import { boosterMainRounds } from "../types/draft-size.js";
export { boosterMainRounds, mainDraftPicksPerPlayer, cardsPerPlayerError, effectiveDraftNumbers, derivedBoosterMainRounds } from "../types/draft-size.js";

/** Keep the same shuffle and full-pack deal, allowing an authored pool to end in partial packs. */
export function buildCappedBoosterDeal(cardIds: number[], players: number, config: DraftConfig, seed: ShuffleSeed) {
  const waves = boosterMainRounds(config);
  const packSize = config.packSize ?? 8;
  if (cardIds.length >= players * waves * packSize) {
    return buildDealWithRemainder(cardIds, { players, waves, packSize, seed });
  }
  const deck = seededShuffle(cardIds, seed);
  const packs: number[][] = [];
  let position = 0;
  for (let wave = 0; wave < waves; wave++) {
    const remaining = Math.min(deck.length - position, players * packSize);
    for (let seat = 0; seat < players; seat++) {
      const size = Math.floor(remaining / players) + (seat < remaining % players ? 1 : 0);
      packs.push(deck.slice(position, position + size));
      position += size;
    }
  }
  return { packs, remainder: deck.slice(position) };
}

/** Exact per-seat Main totals for a persisted deal, including partial packs and grouped passing. */
export function reachableBoosterMainPicks(packCounts: number[][], config: DraftConfig): number[] {
  const players = packCounts[0]?.length ?? 0;
  const cap = config.cardsPerPlayer ?? 40;
  const picksPerStep = config.picksPerStep ?? 1;
  const totals = Array<number>(players).fill(0);
  for (const [wave, sizes] of packCounts.entries()) {
    const remaining = sizes.slice();
    const holders = Array.from({ length: players }, (_, seat) => seat);
    const direction = wave % 2 === 1 && config.alternatePassDirection ? -1 : 1;
    for (let step = 1; remaining.some((n) => n > 0) && totals.some((n) => n < cap); step++) {
      for (let pack = 0; pack < players; pack++) {
        const seat = holders[pack];
        if (remaining[pack] > 0 && totals[seat] < cap) {
          remaining[pack]--;
          totals[seat]++;
        }
      }
      if (step % picksPerStep === 0) {
        for (let pack = 0; pack < players; pack++) holders[pack] = (holders[pack] + direction + players) % players;
      }
    }
  }
  return totals;
}
