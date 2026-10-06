/**
 * Signature attacks and card set pieces are keyed by the passcode of the original card, but a player can pick another
 * art, and the duel then carries that art's passcode. The server is meant to name the original itself
 * (`canonicalPasscode` on a card, a canonical source code on a destroy event); until it does, this map sends such a
 * passcode back to the original. It starts empty and is filled from the artworks API (see primeSignatureAliases), so a
 * card with no known family keeps its own passcode.
 */

import { ArtworksRequestError, fetchCardArtworks } from "@/lib/card-artworks-client";

const originalOf = new Map<number, number>();

/**
 * The passcode the signature and set-piece tables know this card by: the server's canonical passcode when the
 * card carries one, else what the artworks lookup learned, else the card's own passcode.
 */
export function signatureCode(code: number, canonicalPasscode?: number | null): number {
  return canonicalPasscode ?? originalOf.get(code) ?? code;
}

/** The canonical passcode a server view or event carries, when it carries one. */
export function canonicalOf(source: object | null | undefined, field = "canonicalPasscode"): number | undefined {
  const value = (source as Record<string, unknown> | null | undefined)?.[field];
  return typeof value === "number" ? value : undefined;
}

/** Remember that every art of a family stands for the family's original card. */
export function learnArtworkFamily(family: { passcode: number; artworks: ReadonlyArray<{ passcode: number }> }): void {
  for (const art of family.artworks) {
    if (art.passcode !== family.passcode) originalOf.set(art.passcode, family.passcode);
  }
}

/** Families asked for and not failed, so a later mount does not ask again. */
const asked = new Set<number>();
let denied = false;

/** The FX lab and its preview pages are public: there is no session, so the lookup would only get a 401. */
function onPublicPage(): boolean {
  return typeof window !== "undefined" && window.location.pathname.startsWith("/dev/");
}

async function lookup(code: number): Promise<void> {
  asked.add(code);
  try {
    learnArtworkFamily(await fetchCardArtworks(code));
  } catch (reason) {
    // A failure is not remembered: the next mount asks again. No session means no later request can work either.
    asked.delete(code);
    if (reason instanceof ArtworksRequestError && (reason.status === 401 || reason.status === 403)) denied = true;
  }
}

/**
 * Load the arts of the cards with their own effects. The first lookup goes alone: if it is refused (no session), the
 * rest are not sent. A failed lookup only means those arts play the plain style until the next try.
 */
export async function primeSignatureAliases(codes: Iterable<number>): Promise<void> {
  if (denied || onPublicPage()) return;
  const todo = [...new Set(codes)].filter((code) => !asked.has(code));
  const [first, ...rest] = todo;
  if (first == null) return;
  await lookup(first);
  if (denied) return;
  await Promise.all(rest.map(lookup));
}

/** For tests. */
export function resetSignatureAliases(): void {
  originalOf.clear();
  asked.clear();
  denied = false;
}
