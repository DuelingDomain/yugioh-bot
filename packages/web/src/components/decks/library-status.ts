import type { SavedDeck } from "@yugidraft/shared/duels";
import { guidanceNotes, modeLabel } from "./model";

export interface DeckStatus {
  ok: boolean;
  /** "Sizes fit a Standard table", or the short head of the first note. */
  head: string;
  /** The rest of the first note, when there is one. */
  rest: string | null;
  /** Notes beyond the first. */
  more: number;
}

/** One status line for a library row, built from the editor's own size notes. */
export function deckStatus(deck: Pick<SavedDeck, "mode" | "deck">): DeckStatus {
  const notes = guidanceNotes(deck.mode, deck.deck);
  if (notes.length === 0) {
    return { ok: true, head: `Sizes fit a ${modeLabel(deck.mode)} table`, rest: null, more: 0 };
  }
  const first = notes[0]!;
  const match = /^(.+?)(?:; |\. )(.+)$/.exec(first);
  return {
    ok: false,
    head: match ? match[1]! : first.replace(/\.$/, ""),
    rest: match ? match[2]! : null,
    more: notes.length - 1,
  };
}

/** Up to three distinct card codes for the row's fan: Deck Master first, then main, then extra. */
export function deckFanCodes(deck: SavedDeck["deck"]): number[] {
  const seen = new Set<number>();
  const codes: number[] = [];
  const all = [...(deck.deckMaster != null ? [deck.deckMaster] : []), ...deck.main, ...deck.extra];
  for (const code of all) {
    if (seen.has(code)) continue;
    seen.add(code);
    codes.push(code);
    if (codes.length === 3) break;
  }
  return codes;
}
