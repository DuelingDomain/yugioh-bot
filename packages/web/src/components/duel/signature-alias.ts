/**
 * Signature attacks and card set pieces are keyed by the passcode of the original card, but a player can pick another
 * art, and the duel then carries that art's passcode. This map sends such a passcode back to the
 * original. It starts empty and is filled from the artworks API (see primeSignatureAliases), so a
 * card with no known family keeps its own passcode.
 */

import { fetchCardArtworks } from "@/lib/card-artworks-client";

const originalOf = new Map<number, number>();

/** The passcode the signature and set-piece tables know this card by. */
export function signatureCode(code: number): number {
  return originalOf.get(code) ?? code;
}

/** Remember that every art of a family stands for the family's original card. */
export function learnArtworkFamily(family: { passcode: number; artworks: ReadonlyArray<{ passcode: number }> }): void {
  for (const art of family.artworks) {
    if (art.passcode !== family.passcode) originalOf.set(art.passcode, family.passcode);
  }
}

let primed: Promise<void> | null = null;

/** Load the arts of the cards with their own effects once. A failed lookup only means those arts play the plain style. */
export function primeSignatureAliases(codes: Iterable<number>): Promise<void> {
  primed ??= Promise.all(
    [...codes].map((code) => fetchCardArtworks(code).then(learnArtworkFamily, () => undefined)),
  ).then(() => undefined);
  return primed;
}

/** For tests. */
export function resetSignatureAliases(): void {
  originalOf.clear();
  primed = null;
}
