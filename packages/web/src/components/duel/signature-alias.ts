/**
 * Signature attacks and card set pieces are keyed by the passcode of the original card, but a player can pick another
 * art, and the duel then carries that art's passcode. The server names the original itself: `canonicalPasscode` on a
 * card and `sourceCanonicalCode` on a destroy event. An older replay or event without the field keeps its own passcode.
 */

/** The passcode the signature and set-piece tables know a card by: the server's canonical passcode, else its own. */
export function signatureCode(code: number, canonicalPasscode?: number | null): number {
  return canonicalPasscode ?? code;
}
