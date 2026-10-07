import { foldCardText } from "../duels/card-query.js";

/** Same punctuation/space folding as catalog search, with typographic quotes made explicit. */
export const straightenCardQuotes = (name: string): string => name.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
export const normalizeImportedCardName = (name: string): string => foldCardText(straightenCardQuotes(name));

function closeName(a: string, b: string): boolean {
  if (Math.min(a.length, b.length) < 8) return false;
  // At least 88% similarity, and never more than three edits even in a long name.
  const limit = Math.min(3, Math.floor(Math.max(a.length, b.length) * 0.12));
  if (Math.abs(a.length - b.length) > limit) return false;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + Number(a[i - 1] !== b[j - 1]));
    }
    if (Math.min(...current) > limit) return false;
    previous = current;
  }
  return previous[b.length] <= limit;
}

/** Artwork duplicates share a printed name. A second plausible printed name makes correction unsafe. */
export function matchImportedCardName<T extends { name: string }>(cards: readonly T[], name: string): T | undefined {
  const query = normalizeImportedCardName(name);
  if (!query) return;
  const distinct = new Map<string, T>();
  for (const card of cards) {
    const folded = normalizeImportedCardName(card.name);
    if (!distinct.has(folded)) distinct.set(folded, card);
  }
  const exact = distinct.get(query);
  if (exact) return exact;
  const close = [...distinct].filter(([folded]) => closeName(query, folded));
  return close.length === 1 ? close[0][1] : undefined;
}

/** Edits between two words (a swap of two neighbours counts as one), or `limit + 1` when more than `limit`. */
function wordDistance(a: string, b: string, limit: number): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let older: number[] = [];
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + Number(a[i - 1] !== b[j - 1]));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) current[j] = Math.min(current[j], older[j - 2] + 1);
    }
    if (Math.min(...current) > limit) return limit + 1;
    older = previous;
    previous = current;
  }
  return Math.min(previous[b.length], limit + 1);
}

/** One edit for a short word, two for a longer one. Words under 3 letters must be exact. */
const typoLimit = (word: string): number => (word.length < 3 ? 0 : word.length < 7 ? 1 : 2);

/**
 * Cards whose name holds every typed word, allowing a typo in each word ("drak hole" finds "Dark Hole"). A typed word
 * also matches the start of a longer name word, so a half-typed word still works. Closest first: fewest edits in total,
 * then the shorter name. Cards with no near match are left out.
 */
export function rankCardsByTypo<T extends { name: string }>(cards: readonly T[], query: string): T[] {
  const words = normalizeImportedCardName(query).split(" ").filter(Boolean);
  if (words.length === 0) return [];
  const scored: Array<{ card: T; edits: number; length: number }> = [];
  for (const card of cards) {
    const nameWords = normalizeImportedCardName(card.name).split(" ").filter(Boolean);
    let edits = 0;
    let fits = true;
    for (const word of words) {
      const limit = typoLimit(word);
      let best = limit + 1;
      for (const nameWord of nameWords) {
        const head = nameWord.length > word.length ? nameWord.slice(0, word.length) : nameWord;
        best = Math.min(best, wordDistance(word, nameWord, limit), wordDistance(word, head, limit));
      }
      if (best > limit) {
        fits = false;
        break;
      }
      edits += best;
    }
    if (fits) scored.push({ card, edits, length: card.name.length });
  }
  return scored.sort((a, b) => a.edits - b.edits || a.length - b.length).map((entry) => entry.card);
}
