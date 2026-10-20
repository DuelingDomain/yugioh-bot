import { normalizeImportedCardName, rankCardsByTypo } from "../../services/card-name-match.js";

/** Shared catalog folding, additionally allowing the compact aliases players type. */
export const compactEffectName = (name: string): string => normalizeImportedCardName(name).replaceAll(" ", "");

export function resolveEffectName<T extends { name: string }>(entries: readonly T[], text: string): T | undefined {
  const key = compactEffectName(text);
  if (!key) return undefined;
  const exact = entries.find(entry => compactEffectName(entry.name) === key);
  if (exact) return exact;
  // The established catalog matcher supports transpositions and partial name words.
  return rankCardsByTypo(entries, text)[0]
    ?? rankCardsByTypo(entries.map(entry => ({ name: compactEffectName(entry.name), entry })), key)[0]?.entry;
}
