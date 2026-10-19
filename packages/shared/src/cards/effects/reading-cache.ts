import type Database from "better-sqlite3";
import { validateEffectReading } from "./query-schema.js";
import type { Interpretation } from "./query.js";

export const normalizeEffectPhrase = (text: string): string => text.normalize("NFKC").toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim();

/** Optional reading I/O must never inherit the application's 5s writer wait. */
export function optionalReadingSql<T>(db: Database.Database, action: () => T): T {
  const timeout = db.pragma("busy_timeout", { simple: true }) as number;
  db.pragma("busy_timeout=0");
  try { return action(); } finally { db.pragma(`busy_timeout=${timeout}`); }
}

export function effectArchetypes(db: Database.Database): Set<string> {
  return optionalReadingSql(db, () => new Set(db.prepare<[], { name: string }>(`SELECT name FROM archetypes UNION SELECT archetype AS name FROM card_tag_profiles UNION SELECT DISTINCT archetype AS name FROM card_catalog WHERE archetype IS NOT NULL`).all().map(row => row.name)));
}

/** Cached replies are revalidated against the current vocabulary, never trusted as raw queries. */
export function cachedEffectReading(db: Database.Database, text: string, archetypes?: ReadonlySet<string>): Interpretation | null {
  try {
    const row = optionalReadingSql(db, () => db.prepare<[string], { query_json: string | null }>("SELECT query_json FROM effect_readings WHERE phrase=? AND state='done'").get(normalizeEffectPhrase(text)));
    if (!row?.query_json) return null;
    return validateEffectReading(JSON.parse(row.query_json), archetypes ?? effectArchetypes(db));
  }
  catch { return null; }
}

/** Most content words were not understood; dates and filler do not inflate confidence. */
export function lowConfidenceReading(text: string, reading: Interpretation | null): boolean {
  if (reading?.query.intent) return false;
  if (!reading) return true;
  const words = (value: string) => value.toLowerCase().match(/[a-z0-9]+/g)?.filter(word => !new Set(["a", "an", "and", "that", "the", "to", "of", "for", "with", "cards", "card", "are", "is", "can", "from", "in"]).has(word)) ?? [];
  return words(reading.query.text).length > words(text).length / 2;
}
