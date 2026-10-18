import type Database from "better-sqlite3";
import { canonicalCardCode } from "../duels/pool.js";
import { loadCardPasscodeRemaps } from "../db/card-passcode-remaps.js";
import { deckEngineDataDirectory, loadArtworkIdentityCatalog } from "./card-artworks.js";
import { deriveCardEra, selectedReleaseDate, type CardEra, type ReleaseDates } from "../cards/effects/releases.js";

/** Release dates only: no tags, synergy analysis, catalog parsing, or sampling. */
export function cubeEra(db: Database.Database, cubeId: number): { era?: CardEra; newerCount: number } {
  const directory = deckEngineDataDirectory(db.name);
  const engine = loadArtworkIdentityCatalog(directory), remaps = loadCardPasscodeRemaps(directory);
  const artwork = db.prepare<[number], { card_id: number }>("SELECT card_id FROM card_artworks WHERE artwork_id=?");
  const canonical = (code: number) => {
    const seen = new Set<number>();
    let current = code;
    while (!seen.has(current)) {
      seen.add(current);
      const known = artwork.get(current)?.card_id;
      const next = known !== undefined && known !== current ? known : remaps.get(current) ?? canonicalCardCode(current, engine);
      if (next === current) return current;
      current = next;
    }
    return code;
  };
  const codes = new Set(db.prepare<[number], { catalog_card_id: number }>("SELECT catalog_card_id FROM cube_cards WHERE cube_id=?").all(cubeId).map(row => canonical(row.catalog_card_id)));
  const release = db.prepare<[number], { tcg_date: string | null; ocg_date: string | null }>("SELECT tcg_date,ocg_date FROM card_release WHERE passcode=?");
  const dates = [...codes].map((code): ReleaseDates => {
    const row = release.get(code);
    return { tcgDate: row?.tcg_date ?? undefined, ocgDate: row?.ocg_date ?? undefined };
  });
  const era = deriveCardEra(dates);
  const threshold = era ? era.medianYear + Math.max(5, era.spread * 2) : Infinity;
  const newerCount = dates.filter(card => {
    const date = selectedReleaseDate(card);
    return date && Number(date.slice(0, 4)) > threshold;
  }).length;
  return { ...(era ? { era } : {}), newerCount };
}
