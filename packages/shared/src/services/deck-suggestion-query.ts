import { DUEL_BANLIST_OPTIONS, type DuelDeck } from "../duels/index.js";
import { isCardEra, isReleasedRange, type CardEra, type ReleasedRange } from "../cards/effects/releases.js";
import { searchIntentTarget } from "../cards/effects/search-intents.js";
import type { CardEffectSearchResult, CardInsightFormat } from "./card-insights.js";
import type { DeckSuggestionResult } from "./deck-suggestions.js";

export interface DeckSuggestionQueryOptions {
  format: CardInsightFormat;
  pool?: number[];
  exclude?: number[];
  banlist?: string;
  deckMaster?: number;
  genesysRemaining?: number;
  released?: ReleasedRange;
  sort?: "match" | "newest";
  era?: CardEra;
  limit?: number;
}
/** Public query data only. Legality, cache controls and actor authority are server owned. */
export type DeckSuggestionQuery =
  | (DeckSuggestionQueryOptions & { op: "suggestRows"; deck: DuelDeck })
  | (DeckSuggestionQueryOptions & { op: "effectSearch"; text: string; deck?: DuelDeck; omittedChips?: string[] });

export type DeckSuggestionHostResponse =
  | { contextVersion: string; notModified: true }
  | { contextVersion: string; result: DeckSuggestionResult | CardEffectSearchResult };

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const passcode = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 0xffffffff;
const codes = (value: unknown, max: number): value is number[] => Array.isArray(value) && value.length <= max && value.every(passcode);
const integer = (value: unknown, min: number, max: number): value is number => typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
function deck(value: unknown): value is DuelDeck {
  return object(value) && Object.keys(value).every(key => ["main", "extra", "side", "deckMaster"].includes(key))
    && codes(value.main, 100) && codes(value.extra, 100) && codes(value.side, 100)
    && value.main.length + value.extra.length + value.side.length <= 100
    && (value.deckMaster === undefined || passcode(value.deckMaster));
}

/** Strict shared boundary for the signed host and its web caller. */
export function parseDeckSuggestionQuery(value: unknown): DeckSuggestionQuery | null {
  if (!object(value) || (value.op !== "suggestRows" && value.op !== "effectSearch")) return null;
  const common = ["op", "deck", "format", "pool", "exclude", "banlist", "deckMaster", "genesysRemaining", "released", "sort", "era", "limit"];
  const keys = value.op === "effectSearch" ? [...common, "text", "exact", "omittedChips"] : common;
  if (Object.keys(value).some(key => !keys.includes(key))) return null;
  if (value.op === "suggestRows" ? !deck(value.deck) : value.deck !== undefined && !deck(value.deck)) return null;
  if (value.format !== undefined && !["normal", "domain", "genesys", "genesys-domain"].includes(value.format as string)) return null;
  if (value.pool !== undefined && !codes(value.pool, 5000)) return null;
  if (value.exclude !== undefined && !codes(value.exclude, 5000)) return null;
  if (value.banlist !== undefined && !DUEL_BANLIST_OPTIONS.some(option => option.id === value.banlist)) return null;
  if (value.deckMaster !== undefined && !passcode(value.deckMaster)) return null;
  if (value.genesysRemaining !== undefined && !integer(value.genesysRemaining, 0, 1000)) return null;
  if (value.limit !== undefined && !integer(value.limit, 1, 120)) return null;
  if (value.released !== undefined && !isReleasedRange(value.released)) return null;
  if (value.sort !== undefined && value.sort !== "match" && value.sort !== "newest") return null;
  if (value.era !== undefined && !isCardEra(value.era)) return null;
  if (value.op === "effectSearch") {
    if (typeof value.text !== "string" || !value.text.trim() || value.text.length > 512 || searchIntentTarget(value.text)?.kind !== "outside") return null;
    if (value.exact !== undefined && value.exact !== false) return null;
    if (value.omittedChips !== undefined && (!Array.isArray(value.omittedChips) || value.omittedChips.length > 16
      || value.omittedChips.some(chip => typeof chip !== "string" || !chip.length || chip.length > 256))) return null;
  }
  const options: DeckSuggestionQueryOptions = { format: value.format as CardInsightFormat | undefined ?? "normal" };
  for (const key of ["pool", "exclude", "banlist", "deckMaster", "genesysRemaining", "released", "sort", "era", "limit"] as const) {
    if (value[key] !== undefined) Object.assign(options, { [key]: value[key] });
  }
  if (options.pool) options.pool = [...options.pool];
  if (options.exclude) options.exclude = [...options.exclude];
  if (options.released) options.released = { ...options.released };
  if (options.era) options.era = { ...options.era };
  const selectedDeck = value.deck as DuelDeck | undefined;
  const copiedDeck = selectedDeck && { main: [...selectedDeck.main], extra: [...selectedDeck.extra], side: [...selectedDeck.side],
    ...(selectedDeck.deckMaster === undefined ? {} : { deckMaster: selectedDeck.deckMaster }) };
  return value.op === "suggestRows" ? { op: "suggestRows", deck: copiedDeck!, ...options }
    : { op: "effectSearch", text: (value.text as string).trim(), ...(copiedDeck ? { deck: copiedDeck } : {}), ...options,
      ...(value.omittedChips === undefined ? {} : { omittedChips: [...value.omittedChips as string[]] }) };
}
