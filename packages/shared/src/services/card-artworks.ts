import Database from "better-sqlite3";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { canonicalCardCode, type CardIdentityCatalog } from "../duels/pool.js";

export interface CardArtwork {
  cardId: number;
  artworkId: number;
  imageUrl: string;
  imageUrlSmall: string;
  imageUrlCropped?: string;
  isMain: boolean;
}

const engineCache = new Map<string, { mtime: number; cards: CardIdentityCatalog }>();
let warnedMissingIdentity = false;

/** Share the engine's artwork identity rule without opening its database for writes. */
export function loadArtworkIdentityCatalog(): CardIdentityCatalog {
  const path = resolve(process.cwd(), process.env.DUEL_DATA_DIR ?? "data/duel-engine", "cards.cdb");
  if (!existsSync(path)) {
    if (!warnedMissingIdentity) {
      console.warn(`[card-artworks] Engine identity is missing at ${path}; artwork sync will preserve known mains or use the lowest passcode.`);
      warnedMissingIdentity = true;
    }
    return new Map();
  }
  const mtime = statSync(path).mtimeMs;
  const cached = engineCache.get(path);
  if (cached?.mtime === mtime) return cached.cards;
  const engine = new Database(path, { readonly: true, fileMustExist: true });
  try {
    const rows = engine.prepare("select d.id, d.alias, d.type, t.name from datas d join texts t on t.id = d.id")
      .all() as Array<{ id: number; alias: number; type: number; name: string }>;
    const cards: CardIdentityCatalog = new Map(rows.map((row) => [row.id, row]));
    engineCache.set(path, { mtime, cards });
    return cards;
  } finally { engine.close(); }
}

/** The API can call its newest art the card ID. Prefer a proven engine original. */
export function mainArtworkId(card: { id: number; name: string; card_images: Array<{ id?: number }> }, identity: CardIdentityCatalog): number | undefined {
  const name = card.name.trim().toLowerCase();
  const roots = new Set([card.id, ...card.card_images.flatMap((image) => image.id === undefined ? [] : [image.id])]
    .filter((id) => identity.get(id)?.name.trim().toLowerCase() === name)
    .map((id) => canonicalCardCode(id, identity)));
  // Ambiguous or absent engine evidence must not merge unrelated cards.
  return roots.size === 1 ? [...roots][0] : undefined;
}

/** Preserve legacy game-card membership when only an engine alternate was stored.
 * Artwork metadata remains incomplete until sync; no images or API data are fetched.
 */
export function backfillMainArtworkRows(db: Database.Database): void {
  const identity = loadArtworkIdentityCatalog();
  if (identity.size === 0) return;
  const rows = db.prepare("select ygoprodeck_id, name from card_catalog").all() as Array<{ ygoprodeck_id: number; name: string }>;
  const insert = db.prepare(`insert or ignore into card_catalog
    (ygoprodeck_id,name,type,frame_type,effect_text,atk,def,attribute,level,image_url,image_url_small,card_sets_json,cached_at,archetype)
    select ?,name,type,frame_type,effect_text,atk,def,attribute,level,?,?,card_sets_json,cached_at,archetype
    from card_catalog where ygoprodeck_id = ?`);
  db.transaction(() => {
    for (const row of rows) {
      const original = canonicalCardCode(row.ygoprodeck_id, identity);
      if (original === row.ygoprodeck_id || identity.get(original)?.name.trim().toLowerCase() !== row.name.trim().toLowerCase()) continue;
      insert.run(original, `https://images.ygoprodeck.com/images/cards/${original}.jpg`,
        `https://images.ygoprodeck.com/images/cards_small/${original}.jpg`, row.ygoprodeck_id);
    }
  })();
}
