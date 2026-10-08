import type Database from "better-sqlite3";
import type { DraftConfig } from "@yugidraft/shared/types";
import type { CardArtworkFamily } from "@yugidraft/shared/duels";
import { findDraftReadAccess } from "@yugidraft/shared/services";

export class CubeArtworkConflict extends Error {}

/** Family must come from the authenticated duel host. Keep cube membership and authored copies. */
export function swapCubeArtwork(db: Database.Database, cubeId: number, from: number, to: number, family: CardArtworkFamily, userId: number): void {
  if (![from, to].every(code => family.artworks.some(art => art.passcode === code))) {
    throw new Error("Artwork must be an engine-known member of the same card family");
  }
  db.transaction(() => {
    if (!db.prepare("select 1 from cube_cards where cube_id = ? and catalog_card_id = ?").get(cubeId, from)) {
      throw new Error("Cube card not found");
    }
    const blocking = db.prepare(`select d.id, d.guild_id as guildId, d.name, d.web_slug as slug, d.status from drafts d where d.guild_id = (select guild_id from cubes where id = ?) and d.status in ('pending', 'active') and (
      exists (select 1 from draft_player_cube pc where pc.draft_id = d.id and pc.cube_id = ?)
      or exists (select 1 from json_each(d.config_json, '$.allowedCubeIds') allowed where allowed.value = ?)
    ) order by d.id limit 1`).get(cubeId, cubeId, cubeId) as { id: number; guildId: string; name: string; slug: string | null; status: string } | undefined;
    if (blocking) {
      if (!findDraftReadAccess(db, blocking.id, blocking.guildId, userId)?.canRead) {
        throw new CubeArtworkConflict("Artwork cannot change while this cube is used by a pending or active draft. Finish or cancel that draft first.");
      }
      const label = blocking.slug ? `"${blocking.name}" (${blocking.slug})` : `"${blocking.name}"`;
      throw new CubeArtworkConflict(`Artwork cannot change while this cube is used by the ${blocking.status} draft ${label}. Finish or cancel that draft first.`);
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
    const cube = db.prepare("select config_json from cubes where id = ?").get(cubeId) as { config_json: string | null };
    const config = JSON.parse(cube.config_json ?? "{}") as DraftConfig;
    // Legacy cubes can list the family in config as well as in authored rows. Config entries are additive and
    // hide the pool row, so fold them into one block of copies of the new art: the family keeps the copy count
    // it had (listed copies, plus the pool row's copies when only the swapped art was not listed).
    const listed = config.customCardIds?.filter(code => code === from || code === to).length ?? 0;
    if (config.customCardIds && listed > 0) {
      const poolCopies = (db.prepare("select max_copies from cube_cards where cube_id = ? and catalog_card_id = ?").get(cubeId, to) as { max_copies: number }).max_copies;
      const copies = listed + (config.customCardIds.includes(from) ? 0 : poolCopies);
      let placed = false;
      config.customCardIds = config.customCardIds.flatMap(code => {
        if (code !== from && code !== to) return [code];
        if (placed) return [];
        placed = true;
        return Array<number>(copies).fill(to);
      });
    }
    db.prepare("update cubes set config_json = ?, updated_at = ? where id = ?")
      .run(JSON.stringify(config), new Date().toISOString(), cubeId);
  })();
}
