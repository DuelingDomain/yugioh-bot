import Database from "better-sqlite3";
import { afterEach, expect, it, vi } from "vitest";
import { migrate } from "../../src/db/schema.js";
import { createCardCatalogService } from "../../src/services/card-catalog.js";
const databases: Database.Database[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
const apiCard = (id: number, name: string) => ({ id, name, type: "Normal Monster", frameType: "normal", card_images: [id, id + 1].map(id => ({
  id, image_url: `https://images.ygoprodeck.com/images/cards/${id}.jpg`, image_url_small: `https://images.ygoprodeck.com/images/cards_small/${id}.jpg`,
})) });
function setup() {
  const db = new Database(":memory:"); databases.push(db); migrate(db);
  db.exec(`insert into card_catalog (ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at) values
    (10,'Dragon','Normal Monster','normal','old','old','[]','old'),(20,'Wizard','Normal Monster','normal','old','old','[]','old'),
    (40,'Local Only','Normal Monster','normal','old','old','[]','old');`);
  const fetch = vi.fn(async (_input: unknown) => ({ ok: true, json: async () => ({ data: [apiCard(20,"Wizard"),apiCard(10,"Dragon"),apiCard(30,"Not Cached")] }) }));
  const catalog = createCardCatalogService(db, { fetch, identityCatalog: new Map() });
  return { db, fetch, catalog };
}
it("uses a single full dump and only syncs families already in the catalog", async () => {
  const { db, fetch, catalog } = setup();
  expect(await catalog.backfillExistingArtworks()).toEqual({ synced: 2, unmatched: [40] });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(String(fetch.mock.calls[0][0])).toBe("https://db.ygoprodeck.com/api/v7/cardinfo.php");
  expect(catalog.listArtworks(10).map(a => a.artworkId)).toEqual([10,11]);
  expect(catalog.listArtworks(20).map(a => a.artworkId)).toEqual([20,21]);
  expect(db.prepare("select 1 from card_catalog where ygoprodeck_id = 30").get()).toBeUndefined();
  await catalog.backfillExistingArtworks();
  expect(db.prepare("select count(*) as n from card_artworks").get()).toEqual({ n: 4 });
});
it("resumes after an interrupted committed family and preserves one main", async () => {
  const { db, catalog } = setup(); let checkpoint = 0;
  await expect(catalog.backfillExistingArtworks({ onProgress: id => { checkpoint = id; throw new Error("interrupted"); } })).rejects.toThrow("interrupted");
  expect(checkpoint).toBe(10);
  expect(await catalog.backfillExistingArtworks({ afterId: checkpoint })).toEqual({ synced: 1, unmatched: [40] });
  expect(db.prepare("select card_id, sum(is_main) as n from card_artworks group by card_id order by card_id").all()).toEqual([{ card_id: 10, n: 1 }, { card_id: 20, n: 1 }]);
});

it("does not label a synthesized engine main as known API image metadata", async () => {
  const { db } = setup();
  const catalog = createCardCatalogService(db, { identityCatalog: new Map([
    [10, { name: "Dragon", type: 17, alias: 0 }], [11, { name: "Dragon", type: 17, alias: 10 }],
  ]), fetch: async () => ({ ok: true, json: async () => ({ data: [{ ...apiCard(11, "Dragon"), card_images: apiCard(11, "Dragon").card_images.slice(0, 1) }] }) }) });
  await catalog.backfillExistingArtworks();
  expect(db.prepare("select source from card_artworks where artwork_id = 10").get()).toEqual({ source: "engine" });
  expect(catalog.listArtworks(10).map(art => art.artworkId)).toEqual([11]);
});
