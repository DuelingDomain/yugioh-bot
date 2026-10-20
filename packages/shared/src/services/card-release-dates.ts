import type Database from "better-sqlite3";
import { cleanReleaseMonth, type ReleaseDates } from "../cards/effects/releases.js";

/** A known printing's set date is a fallback only for undated engine pre-release cards.
 * Set dates have no reliable region here, so never present one as a TCG/OCG fact.
 */
export function createPrereleaseDateLookup(db: Database.Database) {
  const metadata = db.prepare<[number], { card_sets_json: string }>("SELECT card_sets_json FROM card_catalog WHERE ygoprodeck_id=?");
  const setDate = db.prepare<[string, string], { release_date: string | null }>("SELECT release_date FROM card_sets WHERE set_name=? OR set_code=?");
  const catalogRevision = db.prepare<[], { revision: number }>("SELECT revision FROM card_catalog_revision WHERE id=1");
  let revision = -1, cachedMonth = "";
  const cached = new Map<number, string | undefined>();
  return (code: number, dates: ReleaseDates, prerelease?: boolean): ReleaseDates => {
    if (!prerelease) return dates;
    if (dates.tcgDate || dates.ocgDate) return { ...dates, prerelease: true };
    const currentRevision = catalogRevision.get()!.revision, currentMonth = new Date().toISOString().slice(0, 7);
    if (currentRevision !== revision || currentMonth !== cachedMonth) { cached.clear(); revision = currentRevision; cachedMonth = currentMonth; }
    if (cached.has(code)) return { ...dates, prerelease: true, upcomingDate: cached.get(code) };
    const months: string[] = [];
    try {
      const sets = JSON.parse(metadata.get(code)?.card_sets_json ?? "[]") as { set_name?: string; set_code?: string }[];
      if (Array.isArray(sets)) for (const set of sets) {
        for (const row of setDate.all(set.set_name ?? "", set.set_code?.split("-")[0] ?? "")) {
          const month = cleanReleaseMonth(row.release_date, "tcg");
          if (month && month >= currentMonth) months.push(month);
        }
      }
    } catch { /* Invalid optional cache data leaves this card Upcoming without a month. */ }
    const upcomingDate = months.sort().at(-1);
    cached.set(code, upcomingDate);
    return { ...dates, prerelease: true, upcomingDate };
  };
}
