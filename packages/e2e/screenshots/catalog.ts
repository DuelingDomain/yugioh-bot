import type Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cardCode } from "../helpers/cards";

export type ShotCard = { id: number; name: string; type: string; frame: string; atk: number | null; def_: number | null; level: number | null; attribute: string | null; pts: number; race: string | null };

/** 38 well-known cards with their public points (names, stats and points only; no art). */
// The public list sometimes gives an alternate-art id, so the passcode comes from the engine card database by name.
const listed: ShotCard[] = JSON.parse(readFileSync(fileURLToPath(new URL("./cards.json", import.meta.url)), "utf8"));
export const cards: ShotCard[] = listed.map((card) => ({ ...card, id: cardCode(card.name) }));

/**
 * Puts the cards in the stack's card catalog (the stack serves stub art unless E2E_REAL_CARD_ART=1) with the points of the list
 * that the stack's worker published (scripts/site-screenshots.sh pins its revision). Without a published list it falls back to a
 * private "screenshots" list, so a spec that is run by hand still works; its search results then show "? pts".
 */
export async function seedCatalog(db: Database.Database): Promise<void> {
  let revision = "";
  for (let attempt = 0; attempt < 40 && !revision; attempt += 1) {
    revision = (db.prepare("SELECT revision FROM genesys_points_meta WHERE id=1").get() as { revision: string } | undefined)?.revision ?? "";
    if (!revision && process.env.GENESYS_LIST_REVISION) await new Promise((resolve) => setTimeout(resolve, 1500));
    else break;
  }
  const own = !revision;
  if (own) revision = "screenshots";
  const insert = db.prepare(`INSERT OR REPLACE INTO card_catalog(ygoprodeck_id,name,type,frame_type,atk,def,level,attribute,image_url,image_url_small,card_sets_json,cached_at,genesys_points,genesys_revision)
    VALUES(@id,@name,@type,@frame,@atk,@def_,@level,@attribute,@img,@small,'[]',CURRENT_TIMESTAMP,@pts,@revision)`);
  db.transaction(() => {
    for (const card of cards) {
      insert.run({ ...card, revision, img: `https://images.ygoprodeck.com/images/cards/${card.id}.jpg`, small: `https://images.ygoprodeck.com/images/cards_small/${card.id}.jpg` });
    }
    if (own) db.prepare(`INSERT OR REPLACE INTO genesys_points_meta(id,revision,effective_date,source_url,synced_at) VALUES(1,'screenshots','2026-11-01','https://db.ygoprodeck.com/',CURRENT_TIMESTAMP)`).run();
  })();
}
