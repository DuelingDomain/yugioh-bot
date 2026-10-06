import type Database from "better-sqlite3";
import type { CardArtworkFamily } from "@yugidraft/shared/duels";

export class CubeArtworkConflict extends Error {}

/** Family must come from the authenticated duel host. Keep cube membership and authored copies. */
export function swapCubeArtwork(db: Database.Database, cubeId: number, from: number, to: number, family: CardArtworkFamily): void {
  if (![from, to].every(code => family.artworks.some(art => art.passcode === code))) {
    throw new Error("Artwork must be an engine-known member of the same card family");
  }
  db.transaction(() => {
    if (!db.prepare("select 1 from cube_cards where cube_id = ? and catalog_card_id = ?").get(cubeId, from)) {
      throw new Error("Cube card not found");
    }
    if (db.prepare(`select 1 from drafts d where d.status in ('pending', 'active') and (
      exists (select 1 from draft_player_cube pc where pc.draft_id = d.id and pc.cube_id = ?)
      or exists (select 1 from json_each(d.config_json, '$.allowedCubeIds') allowed where allowed.value = ?)
    ) limit 1`).get(cubeId, cubeId)) {
      throw new CubeArtworkConflict("Artwork cannot change while this cube is used by a pending or active draft");
    }
    if (from === to) return;
    if (db.prepare("select 1 from cube_cards where cube_id = ? and catalog_card_id = ?").get(cubeId, to)) {
      throw new Error("That artwork is already in this cube");
    }
    // An engine-only art may not exist in YGOPRODeck. Materialize the FK targets from this
    // proven family, without fetching guessed metadata or requiring cards.cdb on the web host.
    const localMain = (db.prepare("select card_id from card_artworks where artwork_id = ?").get(family.passcode)
      ?? db.prepare("select card_id from card_artworks where artwork_id = ?").get(from)) as { card_id: number } | undefined;
    const cardId = localMain?.card_id ?? family.passcode;
    for (const code of new Set([family.passcode, to])) {
      db.prepare(`insert or ignore into card_catalog
        (ygoprodeck_id,name,type,frame_type,effect_text,atk,def,attribute,level,image_url,image_url_small,card_sets_json,cached_at,archetype)
        select ?,name,type,frame_type,effect_text,atk,def,attribute,level,?,?,card_sets_json,cached_at,archetype
        from card_catalog where ygoprodeck_id = ?`).run(code,
          `https://images.ygoprodeck.com/images/cards/${code}.jpg`, `https://images.ygoprodeck.com/images/cards_small/${code}.jpg`, from);
      db.prepare(`insert or ignore into card_artworks
        (card_id,artwork_id,image_url,image_url_small,is_main,source) values (?,?,?,?,?,'engine')`).run(
          cardId, code, `https://images.ygoprodeck.com/images/cards/${code}.jpg`,
          `https://images.ygoprodeck.com/images/cards_small/${code}.jpg`, Number(code === cardId));
    }
    db.prepare("update cube_cards set catalog_card_id = ? where cube_id = ? and catalog_card_id = ?").run(to, cubeId, from);
    db.prepare("update cubes set updated_at = ? where id = ?").run(new Date().toISOString(), cubeId);
  })();
}
