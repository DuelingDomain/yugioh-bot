import type Database from "better-sqlite3";
import type { CardArtworkFamily } from "@yugidraft/shared/duels";

/** Family must come from the authenticated duel host. Keep cube membership and authored copies. */
export function swapCubeArtwork(db: Database.Database, cubeId: number, from: number, to: number, family: CardArtworkFamily): void {
  if (![from, to].every(code => family.artworks.some(art => art.passcode === code))) {
    throw new Error("Artwork must be an engine-known member of the same card family");
  }
  db.transaction(() => {
    if (!db.prepare("select 1 from cube_cards where cube_id = ? and catalog_card_id = ?").get(cubeId, from)) {
      throw new Error("Cube card not found");
    }
    if (from === to) return;
    if (db.prepare("select 1 from cube_cards where cube_id = ? and catalog_card_id = ?").get(cubeId, to)) {
      throw new Error("That artwork is already in this cube");
    }
    // An engine-only art may not exist in YGOPRODeck. Materialize the FK targets from this
    // proven family, without fetching guessed metadata or requiring cards.cdb on the web host.
    for (const code of new Set([family.passcode, to])) {
      db.prepare(`insert or ignore into card_catalog
        (ygoprodeck_id,name,type,frame_type,effect_text,atk,def,attribute,level,image_url,image_url_small,card_sets_json,cached_at,archetype)
        select ?,name,type,frame_type,effect_text,atk,def,attribute,level,?,?,card_sets_json,cached_at,archetype
        from card_catalog where ygoprodeck_id = ?`).run(code,
          `https://images.ygoprodeck.com/images/cards/${code}.jpg`, `https://images.ygoprodeck.com/images/cards_small/${code}.jpg`, from);
      db.prepare(`insert or ignore into card_artworks
        (card_id,artwork_id,image_url,image_url_small,is_main,source) values (?,?,?,?,?,'engine')`).run(
          family.passcode, code, `https://images.ygoprodeck.com/images/cards/${code}.jpg`,
          `https://images.ygoprodeck.com/images/cards_small/${code}.jpg`, Number(code === family.passcode));
    }
    db.prepare("update cube_cards set catalog_card_id = ? where cube_id = ? and catalog_card_id = ?").run(to, cubeId, from);
    db.prepare("update cubes set updated_at = ? where id = ?").run(new Date().toISOString(), cubeId);
  })();
}
