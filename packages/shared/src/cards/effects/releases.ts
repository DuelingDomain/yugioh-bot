/** Release facts from YGOPRODeck via LorenzoWhite/searchygo. See data/effects/NOTICE.md. */
export interface ReleaseDates { tcgDate?: string; ocgDate?: string; prerelease?: boolean; upcomingDate?: string; setOrder?: number; dateSearchEligible?: boolean }
/** Inclusive month bounds. No region means the newest known month; explicit regions are strict. */
export interface ReleasedRange { from?: string; to?: string; region?: "tcg" | "ocg" }
export interface CardEra { medianYear: number; spread: number }
export interface CardReleaseInfo extends ReleaseDates {
  date?: string;
  region?: "tcg" | "ocg";
  upcoming: boolean;
}

/** Announced standard-game cards can carry only the engine prerelease bit. */
export const dateSearchEligible = (ot: number): boolean => (ot & 0x103) !== 0 && (ot & 0x600) === 0;
export const validReleaseMonth = (value: unknown): value is string => typeof value === "string" && /^(?:19|20|21)\d{2}-(?:0[1-9]|1[0-2])$/.test(value);
/** TCG set dates also cover legacy MFC-077 and lettered NECH-ENS10 codes. */
export const isTcgSetCode = (code?: string): boolean => !code || /-(?:(?:EN|E|NA|EU|SP|FR|DE|IT|PT)[A-Z]*)?\d+$/i.test(code);
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
  if (region) { const date = region === "ocg" ? card.ocgDate : card.tcgDate; return validReleaseMonth(date) ? date : undefined; }
  const known = [card.tcgDate, card.ocgDate].filter((date): date is string => validReleaseMonth(date)).sort().at(-1);
  return known ?? (card.prerelease && validReleaseMonth(card.upcomingDate) ? card.upcomingDate : undefined);
}
function pendingFirstPrint(card: ReleaseDates, date: string | undefined, region: ReleasedRange["region"], currentMonth: string): boolean {
  if (!date) return false;
  const first = region ? date : [card.tcgDate, card.ocgDate].filter((value): value is string => validReleaseMonth(value)).sort()[0] ?? date;
  return first > currentMonth || (!!card.prerelease && first === currentMonth);
}
export function cardReleaseInfo(card: ReleaseDates, region?: ReleasedRange["region"], now = new Date()): CardReleaseInfo {
  const date = selectedReleaseDate(card, region), currentMonth = now.toISOString().slice(0, 7);
  const source = region ?? (date && date === card.tcgDate ? "tcg" : date && date === card.ocgDate ? "ocg" : undefined);
  return {
    ...(card.tcgDate ? { tcgDate: card.tcgDate } : {}), ...(card.ocgDate ? { ocgDate: card.ocgDate } : {}),
    ...(card.prerelease ? { prerelease: true } : {}), ...(card.upcomingDate ? { upcomingDate: card.upcomingDate } : {}),
    ...(date ? { date } : {}), ...(source ? { region: source } : {}),
    upcoming: !!date && (date > currentMonth || pendingFirstPrint(card, date, region, currentMonth)),
  };
}
export function matchesReleased(card: ReleaseDates, range?: ReleasedRange): boolean {
  if (range && card.dateSearchEligible === false) return false;
  if (!range || (!range.from && !range.to)) return true;
  const date = selectedReleaseDate(card, range.region);
  return date === undefined ? false : (!range.from || date >= range.from) && (!range.to || date <= range.to);
}
/** Pending first prints lead regional imports and released cards. Each group uses
 * month, then engine set number. Unknown months stay last, without priority. */
export function compareNewest(left: ReleaseDates, right: ReleaseDates, region: ReleasedRange["region"], currentMonth: string): number {
  const a = selectedReleaseDate(left, region), b = selectedReleaseDate(right, region);
  const pending = Number(pendingFirstPrint(right, b, region, currentMonth)) - Number(pendingFirstPrint(left, a, region, currentMonth));
  const byMonth = a === b ? 0 : a === undefined ? 1 : b === undefined ? -1 : a > b ? -1 : 1;
  return pending || byMonth || (a && b ? (right.setOrder ?? 0) - (left.setOrder ?? 0) : 0);
}
/** Cube era keeps the original TCG-first convention, independent of newest search. */
export function cardEraDate(card: ReleaseDates): string | undefined {
  return validReleaseMonth(card.tcgDate) ? card.tcgDate : validReleaseMonth(card.ocgDate) ? card.ocgDate : undefined;
}
export function deriveCardEra(cards: readonly ReleaseDates[]): CardEra | undefined {
  const years = cards.map(cardEraDate).filter((date): date is string => !!date).map(date => Number(date.slice(0, 4))).sort((a, b) => a - b);
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
  const date = cardEraDate(card);
  return date && era ? 4 * Math.max(0, 1 - Math.abs(Number(date.slice(0, 4)) - era.medianYear) / Math.max(3, era.spread + 1)) : 0;
}
