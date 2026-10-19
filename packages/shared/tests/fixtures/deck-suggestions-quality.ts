import Database from "better-sqlite3";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { migrate } from "../../src/db/schema.js";
import { importCardEffectArtifact } from "../../src/cards/effects/artifact.js";
import { createInsightCatalog } from "../../src/services/card-insight-catalog.js";

/** Real engine metadata and the repository pin; writes only the caller's disposable database. */
export function loadDeckSuggestionQualityCatalog(engineDirectory: string, databasePath = ":memory:") {
  const db = new Database(databasePath);
  const engine = new Database(join(engineDirectory, "cards.cdb"), { readonly: true, fileMustExist: true });
  try {
    migrate(db);
    const insert = db.prepare(`INSERT INTO card_catalog
      (ygoprodeck_id,name,type,frame_type,effect_text,image_url,image_url_small,card_sets_json,cached_at)
      VALUES(@id,@name,'','',@desc,'fixture','fixture','[]','2026-10-07T00:00:00Z')`);
    // The service's real engine adapter supplies types, stats, setcodes and artwork identity.
    // Neither expected IDs nor recommendation output influence this candidate universe.
    db.transaction(() => {
      for (const row of engine.prepare("SELECT d.id,t.name,t.desc FROM datas d JOIN texts t USING(id)").iterate()) insert.run(row);
    })();
    // These source-deck cards have a real API cache entry in the web editor. Preserve
    // that API archetype instead of selecting the first packed engine setcode.
    const metadata = JSON.parse(readFileSync(new URL("./deck-suggestions-card-metadata.json", import.meta.url), "utf8")) as {
      cards: Array<{ id: number; name: string; type: string; frameType: string; desc: string; archetype?: string; attribute?: string; level?: number; atk?: number; def?: number; artworkPasscodes: number[] }>;
    };
    const update = db.prepare(`UPDATE card_catalog SET name=?,type=?,frame_type=?,effect_text=?,archetype=?,attribute=?,level=?,atk=?,def=? WHERE ygoprodeck_id=?`);
    db.transaction(() => {
      for (const card of metadata.cards) for (const code of new Set([card.id, ...card.artworkPasscodes])) update.run(card.name, card.type, card.frameType, card.desc, card.archetype ?? null, card.attribute ?? null, card.level ?? null, card.atk ?? null, card.def ?? null, code);
    })();
    const catalog = createInsightCatalog(db, engineDirectory);
    try {
      const imported = importCardEffectArtifact(db, { canonicalize: code => catalog.canonical(code) });
      return { db, cards: (db.prepare("SELECT count(*) AS n FROM card_catalog").get() as { n: number }).n, imported };
    } finally { catalog.close(); }
  } catch (error) { db.close(); throw error; }
  finally { engine.close(); }
}
