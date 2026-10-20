import type Database from "better-sqlite3";
import { cleanReleaseMonth, type ReleaseDates } from "../cards/effects/releases.js";

/** Keep earlier known TCG set appearances. An undated engine pre-release card
 * may use its earliest set month, without claiming an unverified region.
 * Engine temporary passcodes encode set number followed by three card digits.
 */
export function createPrereleaseDateLookup(db: Database.Database) {
  const metadata = db.prepare<[number], { card_sets_json: string }>("SELECT card_sets_json FROM card_catalog WHERE ygoprodeck_id=?");
  const setByName = db.prepare<[string], { release_date: string | null }>("SELECT release_date FROM card_sets WHERE set_name=?");
  const setByCode = db.prepare<[string], { release_date: string | null }>("SELECT release_date FROM card_sets WHERE set_code=?");
  const catalogRevision = db.prepare<[], { revision: number }>("SELECT revision FROM card_catalog_revision WHERE id=1");
  let revision = -1;
  const cached = new Map<number, { month?: string; tcg?: string }>();
  return (code: number, dates: ReleaseDates, prerelease?: boolean): ReleaseDates => {
    const currentRevision = catalogRevision.get()!.revision;
    if (currentRevision !== revision) { cached.clear(); revision = currentRevision; }
    let sets = cached.get(code);
    if (!sets) {
      const months: string[] = [], tcg: string[] = [];
      try {
        const entries = JSON.parse(metadata.get(code)?.card_sets_json ?? "[]") as { set_name?: string; set_code?: string }[];
        if (Array.isArray(entries)) for (const entry of entries) {
          const rows = entry.set_name ? setByName.all(entry.set_name) : setByCode.all(entry.set_code?.split("-")[0] ?? "");
          // Product codes repeat across promos and special editions. They are not identities.
          if (!entry.set_name && rows.length !== 1) continue;
          for (const row of rows) {
            const month = cleanReleaseMonth(row.release_date, "tcg");
            if (month) {
              months.push(month);
              if (/-(?:EN|E|NA|EU|AE|SP|FR|DE|IT|PT)\d/i.test(entry.set_code ?? "")) tcg.push(month);
            }
          }
        }
      } catch { /* Invalid optional cache data leaves known release facts intact. */ }
      sets = { month: months.sort()[0], tcg: tcg.sort()[0] };
      cached.set(code, sets);
    }
    const tcgDate = sets.tcg && dates.tcgDate && sets.tcg < dates.tcgDate ? sets.tcg : dates.tcgDate;
    const result = { ...dates, ...(tcgDate ? { tcgDate } : {}) };
    if (!prerelease) return result;
    const setOrder = code >= 100_000_000 && code < 200_000_000 ? Math.floor(code / 1000) : undefined;
    return { ...result, prerelease: true, setOrder, ...(!result.tcgDate && !result.ocgDate ? { upcomingDate: sets.month } : {}) };
  };
}
