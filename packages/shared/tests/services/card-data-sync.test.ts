import Database from "better-sqlite3";
import { afterEach, expect, it, vi } from "vitest";
import { migrate } from "../../src/db/schema.js";
import { createCardCatalogService } from "../../src/services/card-catalog.js";

const databases: Database.Database[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); vi.restoreAllMocks(); });
function setup() { const db = new Database(":memory:"); databases.push(db); migrate(db); return db; }

it("preserves TCG release dates and only advances successful set sync time on success", async () => {
  const db = setup();
  const fetch = vi.fn().mockResolvedValueOnce(Response.json([
    { set_name: "New", set_code: "NEW", num_of_cards: 2, tcg_date: "2026-09-30" },
    { set_name: "Undated", set_code: "OLD", num_of_cards: 1 },
  ])).mockResolvedValueOnce(new Response("offline", { status: 503 }));
  const cards = createCardCatalogService(db, { fetch, identityCatalog: new Map() });
  await cards.syncSets();
  const before = db.prepare("select set_name, release_date, synced_at from card_sets order by set_name").all();
  expect(before).toEqual([
    { set_name: "New", release_date: "2026-09-30", synced_at: expect.any(String) },
    { set_name: "Undated", release_date: null, synced_at: expect.any(String) },
  ]);
  await cards.syncSets();
  expect(db.prepare("select set_name, release_date, synced_at from card_sets order by set_name").all()).toEqual(before);
});

it("migrates existing set data idempotently and tracks catalog changes without unrelated writes", () => {
  const db = new Database(":memory:"); databases.push(db);
  db.exec("create table card_sets (set_name text primary key, synced_at text not null); insert into card_sets values ('Old', '2025-01-01')");
  migrate(db); migrate(db);
  expect(db.prepare("select release_date from card_sets").get()).toEqual({ release_date: null });
  const revision = () => (db.prepare("select revision from card_catalog_revision where id = 1").get() as {revision: number}).revision;
  const before = revision();
  db.prepare("update card_sets set release_date = '2025-02-01'").run();
  expect(revision()).toBe(before + 1);
  db.prepare("insert into users (id, username, display_name) values (1, 'u', 'U')").run();
  db.prepare("insert into players (guild_id, user_id, discord_user_id, display_name) values ('g', 1, 'u', 'U')").run();
  expect(revision()).toBe(before + 1);
});

it("retains release dates when later set responses omit or corrupt them", async () => {
  const db = setup();
  const fetch = vi.fn().mockResolvedValueOnce(Response.json([
    { set_name: "New", set_code: "NEW", num_of_cards: 2, tcg_date: "2026-09-30" },
  ])).mockResolvedValueOnce(Response.json([
    { set_name: "New", set_code: "UPD", num_of_cards: 3 },
  ])).mockResolvedValueOnce(Response.json([
    { set_name: "New", set_code: "UPD", num_of_cards: 3, tcg_date: "invalid" },
  ])).mockResolvedValueOnce(Response.json([
    { set_name: "New", set_code: "UPD", num_of_cards: 3, tcg_date: "2026-02-31" },
  ]));
  const cards = createCardCatalogService(db, { fetch, identityCatalog: new Map() });
  await cards.syncSets(); await cards.syncSets(); await cards.syncSets(); await cards.syncSets();
  expect(db.prepare("select release_date, set_code, card_count from card_sets").get())
    .toEqual({ release_date: "2026-09-30", set_code: "UPD", card_count: 3 });
});

it("tracks inserts, updates and deletes for catalog and artwork rows", () => {
  const db = setup();
  const revision = () => (db.prepare("select revision from card_catalog_revision where id=1").get() as { revision: number }).revision;
  const before = revision();
  db.exec(`insert into card_catalog (ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at)
    values (1,'Card','Normal Monster','normal','','','[]','2026-01-01');
    update card_catalog set name='Updated' where ygoprodeck_id=1;
    insert into card_artworks (card_id,artwork_id,image_url,image_url_small,is_main,source) values (1,1,'','',1,'api');
    update card_artworks set image_url='changed' where artwork_id=1;
    delete from card_artworks; delete from card_catalog;`);
  expect(revision()).toBe(before + 6);
  expect(db.prepare("select name from sqlite_master where name='card_data_set_cache'").get()).toBeDefined();
});
