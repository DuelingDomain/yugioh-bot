import { createCardLookupBudget, type CardCatalogService, type CubeImportEntry } from "@yugidraft/shared/services";
import { CardListError, parseCardList } from "./card-list-parser";
import { YDK_MAX_COPIES } from "./ydk-file";

export interface ListImportResult {
  /** Distinct resolved cards touched, including cards already in the cube. */
  added: number;
  /** Copies gained after the per-card 99 cap. */
  copies: number;
  unknown: string[];
  lookupLimited?: true;
  /** Distinct main cards listed under Extra and routed to Main by a saved-cube list import. */
  movedToMain?: number;
  corrected: Array<{ from: string; to: string }>;
}

/** Resolve every line before the caller opens a synchronous cube write transaction. */
export async function prepareCubeListImport(catalog: CardCatalogService, text: unknown): Promise<{
  entries: CubeImportEntry[];
  unknown: string[];
  corrected: ListImportResult["corrected"];
  lookupLimited?: true;
}> {
  if (typeof text !== "string") throw new CardListError("Add a card list file or paste a list.");
  const parsed = parseCardList(text);
  const lookupBudget = createCardLookupBudget();
  const cachedNames = [...new Set(parsed.flatMap((entry) => !entry.heading && typeof entry.query === "string"
    ? [entry.query, ...(entry.fallbackName ? [entry.fallbackName] : [])] : []))];
  const cached = new Map((await catalog.resolveCardNames(cachedNames, { cacheOnly: true })).map((result) => [result.name, result]));
  // A cached printed name such as 7 Colored Fish must work even when the upstream is offline.
  const preferFullName = new Set(parsed.filter((entry) => typeof entry.query === "string" && entry.fallbackName
    && !cached.get(entry.query)?.card && cached.get(entry.fallbackName)?.card));
  // The lookup budget is shared, and a misspelt name costs extra probes. Counted lines come first so section
  // titles and prose in a pasted Doc cannot use up the budget before the real cards are looked up.
  const nameEntries = parsed.filter((entry) => !entry.heading && !preferFullName.has(entry) && typeof entry.query === "string");
  const names = [...new Set([...nameEntries.filter((entry) => entry.counted), ...nameEntries.filter((entry) => !entry.counted)]
    .map((entry) => entry.query as string))];
  const resolutions = new Map((await catalog.resolveCardNames(names, { lookupBudget })).map((result) => [result.name, result]));
  const fallbackNames = [...new Set(parsed.flatMap((entry) => typeof entry.query === "string"
    && !preferFullName.has(entry) && !resolutions.get(entry.query)?.card && entry.fallbackName ? [entry.fallbackName] : []))];
  const fallbacks = new Map((await catalog.resolveCardNames(fallbackNames, { lookupBudget })).map((result) => [result.name, result]));
  const codes = [...new Set(parsed.flatMap((entry) => typeof entry.query === "number" ? [entry.query] : []))];
  await catalog.prefetchCardsByIds(codes, { lookupBudget });
  const byCode = new Map(catalog.findByIds(codes).map((card) => [card.ygoprodeckId, card]));
  for (const code of codes) {
    if (byCode.has(code) && catalog.hasCatalogRow(code)) continue;
    const card = await catalog.syncCardById(code, { lookupBudget });
    if (card && catalog.hasCatalogRow(code)) byCode.set(code, card);
  }
  const entries = new Map<number, CubeImportEntry>();
  const unknown = new Set<string>();
  const corrected = new Map<string, { from: string; to: string }>();
  for (const entry of parsed) {
    if (entry.heading) { unknown.add(entry.original); continue; }
    const resolution = typeof entry.query === "string" && !preferFullName.has(entry) ? resolutions.get(entry.query) : undefined;
    // Fallback printed names must match exactly after normalization, never through typo correction.
    const fallback = entry.fallbackName
      ? (preferFullName.has(entry) ? cached.get(entry.fallbackName) : fallbacks.get(entry.fallbackName)) : undefined;
    const fallbackCard = fallback && !fallback.corrected ? fallback.card : undefined;
    const card = typeof entry.query === "number" ? byCode.get(entry.query) : resolution?.card ?? fallbackCard;
    if (!card) { unknown.add(entry.original); continue; }
    if (resolution?.corrected) corrected.set(resolution.corrected.from, resolution.corrected);
    const id = card.ygoprodeckId;
    const previous = entries.get(id);
    const copies = resolution?.card || typeof entry.query === "number" ? entry.copies : 1;
    entries.set(id, { id, copies: Math.min(YDK_MAX_COPIES, (previous?.copies ?? 0) + copies),
      pool: entry.pool === "extra" || previous?.pool === "extra" ? "extra" : "main" });
  }
  return { entries: [...entries.values()], unknown: [...unknown], corrected: [...corrected.values()], ...(lookupBudget.lookupLimited ? { lookupLimited: true as const } : {}) };
}
