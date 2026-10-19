import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import { expect, it } from "vitest";
import { describeWithCores, needs } from "./support/cores.js";
import { openDatabase, applyEngineCardRemaps } from "@yugidraft/shared/db";
import { createCardCatalogService, createCubeService, createDraftService, createPlayerService } from "@yugidraft/shared/services";
import { CARD_TYPE_BITS as T } from "@yugidraft/shared/duels";

function seedIdentity(db: Database.Database) {
  const { count } = db.prepare("select count(*) as count from players").get() as { count: number };
  const userId = String(900000000000000000n + BigInt(count + 1));
  return { userId, playerId: createPlayerService(db).findOrCreate("g", userId, "Integration player").id };
}

// External-resource integration suite: pass DUEL_DATA_DIR to a prepared real bundle.
const directory = resolve(process.env.DUEL_DATA_DIR ?? "data/duel-engine");
const integration = it;
const missing = async () => ({ ok: false, status: 400,
  json: async () => ({ error: "No card matching your query was found in the database." }) });

async function withDatabase(run: (db: Database.Database, engine: Database.Database) => Promise<void>) {
  const root = mkdtempSync(join(tmpdir(), "prerelease-catalog-"));
  const engine = new Database(join(directory, "cards.cdb"), { readonly: true });
  const previous = process.env.DUEL_DATA_DIR;
  process.env.DUEL_DATA_DIR = directory;
  const db = openDatabase(join(root, "app.sqlite"));
  try { await run(db, engine); expect(db.pragma("foreign_key_check")).toEqual([]); }
  finally {
    db.close(); engine.close(); rmSync(root, { recursive: true, force: true });
    if (previous === undefined) delete process.env.DUEL_DATA_DIR; else process.env.DUEL_DATA_DIR = previous;
  }
}

describeWithCores("pre-release catalog", [needs.cards(directory)], () => {

integration("resolves real previews by passcode, name and search, imports cubes and deals both draft pools", async () => withDatabase(async (db, engine) => {
  const previews = engine.prepare(`select d.id,t.name,t.desc,d.type,d.level,d.atk,d.def from datas d join texts t using(id)
    where (d.ot & 256) != 0 and d.alias=0 and (d.type & ${T.token})=0 order by d.id`).all() as Array<{
      id: number; name: string; desc: string; type: number; level: number; atk: number; def: number;
    }>;
  expect(previews.length, "the real bundle must contain previews").toBeGreaterThan(0);
  const main = previews.filter(card => !(card.type & (T.fusion | T.synchro | T.xyz | T.link))).slice(0, 6);
  const extra = previews.find(card => card.type & (T.fusion | T.synchro | T.xyz | T.link))!;
  expect(extra).toBeDefined();
  const catalog = createCardCatalogService(db, { fetch: missing });
  for (const preview of [...main, extra]) {
    const card = await catalog.syncCardById(preview.id);
    expect(card).toMatchObject({ name: preview.name, effectText: preview.desc, prerelease: true,
      catalogSource: "engine", imageUrl: `/api/cards/${preview.id}/image` });
    expect(card?.isExtraDeck).toBe(!!(preview.type & (T.fusion | T.synchro | T.xyz | T.link)));
    if (preview.type & T.monster) expect(card?.level).toBe(preview.level & 0xff);
  }
  expect((await catalog.syncCardsByFuzzyName(String(main[0].id), { includeExtra: true })).map(card => card.ygoprodeckId)).toContain(main[0].id);
  expect((await catalog.syncCardsByFuzzyName(extra.name)).map(card => card.ygoprodeckId)).not.toContain(extra.id);
  expect((await catalog.syncCardsByFuzzyName(extra.name, { includeExtra: true })).map(card => card.ygoprodeckId)).toContain(extra.id);
  expect((await catalog.resolveCardNames([main[0].name, extra.name])).map(result => result.card?.ygoprodeckId)).toEqual([main[0].id, extra.id]);
  const art = engine.prepare(`select id from datas where (ot & 256)!=0 and alias>0 and (type & ${T.token})=0 limit 1`).get() as { id: number } | undefined;
  if (art) {
    const found = await catalog.syncCardsByFuzzyName(String(art.id), { includeExtra: true });
    expect(found.map(card => card.ygoprodeckId)).toContain(art.id);
    expect(found.find(card => card.ygoprodeckId === art.id)?.prerelease).toBe(true);
  }
  await catalog.syncDraftPool({ setNames: [], customCardIds: main.map(card => card.id), includeNames: [], excludeNames: [] });
  const owner = seedIdentity(db), second = seedIdentity(db);
  const cubes = createCubeService(db, catalog);
  const cube = cubes.createBlank("g", "Preview cube", owner.userId);
  await cubes.importPasscodes(cube.id, [...main.map(card => card.id), extra.id]);
  expect(cubes.getCubePools(cube.id).extra.map(card => card.catalogCardId)).toEqual([extra.id]);
  const drafts = createDraftService(db);
  const draft = drafts.create("g", "integration-channel", "Preview draft", { customCardIds: main.map(card => card.id),
    customExtraCardIds: [extra.id, extra.id], packsPerPlayer: 1, packSize: 2, cardsPerPlayer: 2,
    extraDeckEnabled: true, extraDeckSize: 1 }, owner.userId, owner.playerId);
  drafts.join(draft.id, second.playerId);
  drafts.start(draft.id);
  const cards = drafts.currentPackOptions(draft.id, owner.playerId);
  expect(cards.length).toBe(2);
  expect(cards.every(card => main.some(preview => preview.id === card.catalogCardId))).toBe(true);
  expect(db.prepare("select count(*) as n from draft_deal where draft_id=? and catalog_card_id=?").get(draft.id, extra.id)).toEqual({ n: 2 });
  for (let step = 0; step < 2; step++) for (const player of [owner, second]) {
    drafts.pickCard(draft.id, player.playerId, drafts.currentPackOptions(draft.id, player.playerId)[0].id);
  }
  expect(drafts.currentPackOptions(draft.id, owner.playerId).map(card => card.catalogCardId)).toEqual([extra.id]);
  const offline = createCardCatalogService(db, { fetch: async () => { throw new TypeError("offline"); } });
  // Exercise a cold name lookup during an outage.
  const fresh = previews.find(card => !catalog.hasCatalogRow(card.id) && !(card.type & (T.fusion | T.synchro | T.xyz | T.link)))!;
  expect(fresh).toBeDefined();
  expect((await offline.syncDraftPool({ setNames: [], includeNames: [fresh.name], excludeNames: [] })).map(card => card.ygoprodeckId)).toContain(fresh.id);
}), 30_000);

integration.each([false, true])("preserves previews and graduates real references; official row already exists=%s", async (alreadyPublished) => withDatabase(async (db, engine) => {
  const remaps = JSON.parse(readFileSync(join(directory, "card-remaps.json"), "utf8")).remaps as Record<string, number>;
  const [oldText, officialId] = Object.entries(remaps)[0];
  const oldId = Number(oldText);
  const official = engine.prepare("select t.name,d.type from datas d join texts t using(id) where id=?").get(officialId) as { name: string; type: number };
  expect(official).toBeDefined();
  expect(official.type & T.monster).toBeTruthy();
  let published = false;
  const apiCard = { id: officialId, name: `${official.name} (official API)`, type: "Effect Monster", frameType: "effect",
    desc: "Official English card text", race: "Warrior", card_images: [{ id: officialId,
      image_url: `https://images.ygoprodeck.com/images/cards/${officialId}.jpg`, image_url_small: `https://images.ygoprodeck.com/images/cards_small/${officialId}.jpg` }],
    card_sets: [{ set_name: "Released set" }] };
  const catalog = createCardCatalogService(db, { fetch: async () => published ? { ok: true, status: 200, json: async () => ({ data: [apiCard] }) } : missing() });
  const preview = engine.prepare(`select id from datas where (ot & 256)!=0 and alias=0 and (type & ${T.token})=0 order by id limit 1`).get() as { id: number };
  await catalog.syncCardById(preview.id);
  if (alreadyPublished) {
    published = true;
    await catalog.syncDraftPool({ setNames: ["Released set"], includeNames: [], excludeNames: [] });
    published = false;
  }
  const owner = seedIdentity(db);
  db.prepare(`insert into card_catalog(ygoprodeck_id,name,type,frame_type,effect_text,image_url,image_url_small,card_sets_json,cached_at,catalog_source,is_prerelease)
    values(?,?,?,?,? ,?,?,'[]','preview','engine',1)`).run(oldId, "Preview name", apiCard.type, apiCard.frameType, "Preview text", `/api/cards/${oldId}/image`, `/api/cards/${oldId}/image?size=small`);
  const cube = createCubeService(db, catalog).createWithCards("g", "Graduating cube", owner.userId, [{ id: oldId, copies: 3 }, ...(alreadyPublished ? [{ id: officialId, copies: 2 }] : [])]);
  const draft = createDraftService(db).create("g", "integration-channel", "Graduating draft", { customCardIds: [oldId] }, owner.userId, owner.playerId);
  db.prepare("insert into draft_cards(id,draft_id,wave_number,catalog_card_id) values(1,?,1,?)").run(draft.id, oldId);
  db.prepare("insert into draft_deal(draft_id,position,catalog_card_id) values(?,1,?)").run(draft.id, oldId);
  db.prepare("insert into draft_undealt(draft_id,position,catalog_card_id) values(?,2,?)").run(draft.id, oldId);
  expect(applyEngineCardRemaps(db, directory).skipped).toBe(false);
  expect(catalog.hasCatalogRow(oldId)).toBe(false);
  expect(catalog.findByIds([officialId])[0]).toMatchObject({ name: alreadyPublished ? apiCard.name : official.name, prerelease: false, catalogSource: alreadyPublished ? "api" : "engine" });
  for (const table of ["cube_cards", "draft_cards", "draft_deal", "draft_undealt"]) {
    expect(db.prepare(`select catalog_card_id from ${table}`).get()).toEqual({ catalog_card_id: officialId });
  }
  published = true;
  await catalog.syncDraftPool({ setNames: [], customCardIds: [officialId], includeNames: [], excludeNames: [] });
  for (let i = 0; i < 2; i++) await catalog.syncDraftPool({ setNames: ["Released set"], includeNames: [], excludeNames: [] });
  expect(catalog.findByIds([officialId])[0]).toMatchObject({ name: apiCard.name, effectText: apiCard.desc, prerelease: false, catalogSource: "api", imageUrl: apiCard.card_images[0].image_url });
  expect(catalog.findByIds([preview.id])[0].prerelease).toBe(true);
  expect(db.prepare("select count(*) as n,sum(max_copies) as copies from cube_cards where cube_id=?").get(cube.id)).toEqual({ n: 1, copies: alreadyPublished ? 5 : 3 });
  expect(applyEngineCardRemaps(db, directory).skipped).toBe(true);
}));

});
