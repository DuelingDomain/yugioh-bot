/** Release facts from YGOPRODeck via LorenzoWhite/searchygo. See data/effects/NOTICE.md. */
export interface ReleaseDates { tcgDate?: string; ocgDate?: string }
/** Inclusive month bounds. No region means TCG with OCG fallback; explicit regions are strict. */
export interface ReleasedRange { from?: string; to?: string; region?: "tcg" | "ocg" }
export interface CardEra { medianYear: number; spread: number }
export interface CardReleaseInfo extends ReleaseDates {
  date?: string;
  region?: "tcg" | "ocg";
  upcoming: boolean;
}

export const validReleaseMonth = (value: unknown): value is string => typeof value === "string" && /^(?:19|20|21)\d{2}-(?:0[1-9]|1[0-2])$/.test(value);
export function cleanReleaseMonth(value: unknown, region: "tcg" | "ocg"): string | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}(?:-\d{2})?$/.test(value)) return undefined;
  const month = value.slice(0, 7);
  if (!validReleaseMonth(month) || Number(value.slice(0, 4)) < (region === "tcg" ? 2002 : 1999)) return undefined;
  if (value.length === 10) {
    const day = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== value) return undefined;
  }
  return month;
}
export function isReleasedRange(value: unknown): value is ReleasedRange {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const range = value as Record<string, unknown>;
  return Object.keys(range).every(key => ["from", "to", "region"].includes(key)) &&
    (range.from === undefined || validReleaseMonth(range.from)) && (range.to === undefined || validReleaseMonth(range.to)) &&
    (range.region === undefined || range.region === "tcg" || range.region === "ocg") &&
    !(typeof range.from === "string" && typeof range.to === "string" && range.from > range.to);
}
export function isCardEra(value: unknown): value is CardEra {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const era = value as Record<string, unknown>;
  return Object.keys(era).every(key => ["medianYear", "spread"].includes(key)) && typeof era.medianYear === "number" && Number.isFinite(era.medianYear) && era.medianYear >= 1999 && era.medianYear <= 2199 &&
    typeof era.spread === "number" && Number.isFinite(era.spread) && era.spread >= 0 && era.spread <= 200;
}
export function selectedReleaseDate(card: ReleaseDates, region?: ReleasedRange["region"]): string | undefined {
  return region === "ocg" ? card.ocgDate : region === "tcg" ? card.tcgDate : card.tcgDate ?? card.ocgDate;
}
export function cardReleaseInfo(card: ReleaseDates, region?: ReleasedRange["region"], now = new Date()): CardReleaseInfo {
  const date = selectedReleaseDate(card, region);
  return { ...(card.tcgDate ? { tcgDate: card.tcgDate } : {}), ...(card.ocgDate ? { ocgDate: card.ocgDate } : {}), ...(date ? { date, region: region ?? (card.tcgDate ? "tcg" : "ocg") } : {}), upcoming: !!date && date > now.toISOString().slice(0, 7) };
}
export function matchesReleased(card: ReleaseDates, range?: ReleasedRange): boolean {
  if (!range || (!range.from && !range.to)) return true;
  const date = selectedReleaseDate(card, range.region);
  return date !== undefined && (!range.from || date >= range.from) && (!range.to || date <= range.to);
}
/** Known months first, then unknowns. Always newest first. */
export function compareNewest(left: ReleaseDates, right: ReleaseDates, region?: ReleasedRange["region"]): number {
  const a = selectedReleaseDate(left, region), b = selectedReleaseDate(right, region);
  return a === b ? 0 : a === undefined ? 1 : b === undefined ? -1 : a > b ? -1 : 1;
}
export function deriveCardEra(cards: readonly ReleaseDates[]): CardEra | undefined {
  const years = cards.map(card => selectedReleaseDate(card)).filter((date): date is string => !!date).map(date => Number(date.slice(0, 4))).sort((a, b) => a - b);
  if (!years.length) return undefined;
  const median = (values: readonly number[]) => {
    const middle = Math.floor(values.length / 2);
    return values.length % 2 ? values[middle]! : (values[middle - 1]! + values[middle]!) / 2;
  };
  const medianYear = median(years);
  // Median absolute deviation keeps a few modern additions from widening an old cube's era.
  return { medianYear, spread: median(years.map(year => Math.abs(year - medianYear)).sort((a, b) => a - b)) };
}
/** A soft score bonus. Unknown dates receive no bonus. */
export function cardEraBoost(card: ReleaseDates, era?: CardEra): number {
  const date = selectedReleaseDate(card);
  return date && era ? 4 * Math.max(0, 1 - Math.abs(Number(date.slice(0, 4)) - era.medianYear) / Math.max(3, era.spread + 1)) : 0;
}
