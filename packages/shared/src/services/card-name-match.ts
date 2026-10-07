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
