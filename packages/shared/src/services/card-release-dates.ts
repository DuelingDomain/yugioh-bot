import type Database from "better-sqlite3";
import { cleanReleaseMonth, isTcgSetCode, type ReleaseDates } from "../cards/effects/releases.js";
import { loadCardPasscodeRemaps } from "../db/card-passcode-remaps.js";

type SetMonths = { input: string; month?: string; tcg?: string };
type Lookup = (code: number, dates: ReleaseDates, prerelease?: boolean) => ReleaseDates;
interface Snapshot { revision: number; setsIdentity: string; metadata: Map<number, SetMonths>; firstSets: Map<number, number>; lookup: Lookup }
const snapshots = new WeakMap<Database.Database, Map<string, Snapshot>>();
const temporarySet = (code: number) => code >= 100_000_000 && code < 200_000_000 ? Math.floor(code / 1000) : undefined;

/** One revision read per operation. The returned lookup is a pure snapshot:
 * no SQL or JSON parsing occurs while filtering, scoring or sorting cards.
 * Unchanged card metadata survives catalog-only revisions without reparsing.
 */
export function createPrereleaseDateLookup(db: Database.Database, dataDirectory?: string, currentRevision?: number): Lookup {
  const revision = currentRevision ?? (db.prepare("SELECT revision FROM card_catalog_revision WHERE id=1").get() as { revision: number }).revision;
  let directories = snapshots.get(db);
  if (!directories) snapshots.set(db, directories = new Map());
  const key = dataDirectory ?? "", previous = directories.get(key);
  if (previous?.revision === revision) return previous.lookup;
  const firstSets = previous?.firstSets ?? new Map<number, number>();
  if (!previous && dataDirectory) for (const [old, code] of loadCardPasscodeRemaps(dataDirectory)) {
    const set = temporarySet(old);
    if (set !== undefined) firstSets.set(code, Math.min(firstSets.get(code) ?? set, set));
  }
  const rows = db.prepare<[], { set_name: string; set_code: string; release_date: string | null }>("SELECT set_name,set_code,release_date FROM card_sets ORDER BY set_name,set_code").all();
  const setsIdentity = JSON.stringify(rows), byName = new Map<string, typeof rows>(), byCode = new Map<string, typeof rows>();
  for (const row of rows) {
    if (!byName.has(row.set_name)) byName.set(row.set_name, []);
    byName.get(row.set_name)!.push(row);
    if (!byCode.has(row.set_code)) byCode.set(row.set_code, []);
    byCode.get(row.set_code)!.push(row);
  }
  const metadata = new Map<number, SetMonths>();
  for (const row of db.prepare<[], { ygoprodeck_id: number; card_sets_json: string }>("SELECT ygoprodeck_id,card_sets_json FROM card_catalog").iterate()) {
    const known = previous?.metadata.get(row.ygoprodeck_id);
    if (known?.input === row.card_sets_json && previous!.setsIdentity === setsIdentity) { metadata.set(row.ygoprodeck_id, known); continue; }
    const months: string[] = [], tcg: string[] = [];
    try {
      const entries = JSON.parse(row.card_sets_json) as { set_name?: string; set_code?: string }[];
      if (Array.isArray(entries)) for (const entry of entries) {
        const sets = (entry.set_name ? byName.get(entry.set_name) : byCode.get(entry.set_code?.split("-")[0] ?? "")) ?? [];
        // Product codes repeat across promos and special editions. They are not identities.
        if (!entry.set_name && sets.length !== 1) continue;
        for (const set of sets) {
          const month = cleanReleaseMonth(set.release_date, "tcg");
          if (month) { months.push(month); if (isTcgSetCode(entry.set_code)) tcg.push(month); }
        }
      }
    } catch { /* Invalid optional cache data leaves known release facts intact. */ }
    metadata.set(row.ygoprodeck_id, { input: row.card_sets_json, month: months.sort()[0], tcg: tcg.sort()[0] });
  }
  const lookup: Lookup = (code, dates, prerelease) => {
    const sets = metadata.get(code);
    const tcgDate = sets?.tcg && dates.tcgDate && sets.tcg < dates.tcgDate ? sets.tcg : dates.tcgDate;
    // Graduation to a random official passcode must retain earliest set order.
    const setOrder = firstSets.get(code) ?? temporarySet(code);
    const result = { ...dates, ...(tcgDate ? { tcgDate } : {}), ...(setOrder !== undefined ? { setOrder } : {}) };
    return !prerelease ? result : { ...result, prerelease: true, ...(!result.tcgDate && !result.ocgDate ? { upcomingDate: sets?.month } : {}) };
  };
  directories.set(key, { revision, setsIdentity, metadata, firstSets, lookup });
  return lookup;
}
