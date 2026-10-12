import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../../src/db/index.js";
import { createCubeService } from "../../src/services/cubes.js";
import { createCardCatalogService } from "../../src/services/card-catalog.js";
import { buildDraftDeck } from "../../src/services/draft-decks.js";
let db: Database.Database;
let cubes: ReturnType<typeof createCubeService>;
beforeEach(() => {
  db = new Database(":memory:"); migrate(db);
  db.prepare("insert into users(id,username,display_name) values (1,'test-owner','Test Owner')").run();
  for (const [id, type] of [[901, "Spell Card"], [902, "Trap Card"], [903, "Fusion Monster"], [904, "Pendulum Effect Monster"]] as const) {
    db.prepare("insert into card_catalog(ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at) values (?,?,?,'test','','','[]','test')").run(id, `Test ${id}`, type);
  }
  cubes = createCubeService(db, createCardCatalogService(db, { fetch: async () => { throw new Error("No network"); } }));
});
afterEach(() => db.close());
const entries = [{ id: 901, copies: 2, pool: "extra" as const }, { id: 902, copies: 1, pool: "extra" as const },
  { id: 904, copies: 1, pool: "extra" as const }, { id: 903, copies: 1, pool: "main" as const }];
function check(id: number) {
  const pools = cubes.getCubePools(id);
  expect(pools.main.map(card => card.catalogCardId)).toEqual([901, 902, 904]);
  expect(pools.extra.map(card => card.catalogCardId)).toEqual([903]);
}
describe("cube and draft Extra type safety", () => {
  it("routes explicit passcode groups by real type", async () => {
    const cube = cubes.createBlank("test-g", "Test cube", 1);
    const result = await cubes.importPasscodeGroups(cube.id, [{ codes: [901, 901, 902, 904], pool: "extra" }, { codes: [903], pool: "main" }]);
    expect(result.moves).toHaveLength(5);
    expect(result.messages).toContain("4 cards moved from Extra Deck to Main Deck: Test 901, Test 901, Test 902, Test 904.");
    check(cube.id);
  });
  it("routes resolved name entries by real type", () => {
    const cube = cubes.createBlank("test-g", "Test cube", 1);
    expect(cubes.importResolvedCards(cube.id, entries).movedToMain).toBe(3);
    check(cube.id);
  });
  it("routes cube creation and copied Extra pools by real type", () => {
    const source = cubes.createWithCards("test-g", "Source", 1, entries);
    check(source.id);
    db.prepare("update cube_cards set pool='extra' where cube_id=? and catalog_card_id=901").run(source.id);
    const target = cubes.createWithCards("test-g", "Target", 1, [], { copyExtraFromCubeId: source.id });
    expect(cubes.getCubePools(target.id).main.map(card => card.catalogCardId)).toEqual([901]);
    expect(cubes.getCubePools(target.id).extra.map(card => card.catalogCardId)).toEqual([903]);
  });
  it("uses engine bits for writes and reports when catalog text is stale", async () => {
    db.prepare("update card_catalog set type='Fusion Monster' where ygoprodeck_id=901").run();
    const authoritative = createCubeService(db, createCardCatalogService(db), new Map([[901, { name: "Test Spell", type: 0x2 }]]));
    const cube = authoritative.createBlank("test-g", "Test cube", 1);
    const result = await authoritative.importPasscodeGroups(cube.id, [{ codes: [901], pool: "extra" }]);
    expect(result.messages).toContain("1 card moved from Extra Deck to Main Deck: Test Spell.");
    // Check the stored row before any read repair can hide a wrong write.
    expect(db.prepare("select pool from cube_cards where cube_id=?").get(cube.id)).toEqual({ pool: "main" });
  });
  it("repairs legacy cube pool labels on read without changing copies, source or time", () => {
    const cube = cubes.createBlank("test-g", "Test cube", 1);
    cubes.addCard(cube.id, 901, "main", 5, "test-source");
    db.prepare("update cube_cards set pool='extra' where cube_id=?").run(cube.id);
    const before = db.prepare("select updated_at from cubes where id=?").get(cube.id);
    const pools = cubes.getCubePools(cube.id);
    expect(pools.main).toEqual([{ catalogCardId: 901, maxCopies: 5, pool: "main", source: "test-source" }]);
    expect(pools.extra).toEqual([]);
    expect(db.prepare("select pool from cube_cards where cube_id=?").get(cube.id)).toEqual({ pool: "main" });
    expect(db.prepare("select updated_at from cubes where id=?").get(cube.id)).toEqual(before);
  });
  it("repairs legacy labels before replacing Main, so replacement counts and removals take effect", () => {
    const cube = cubes.createBlank("test-g", "Test cube", 1);
    cubes.addCard(cube.id, 901, "main", 5);
    cubes.addCard(cube.id, 902, "main", 3);
    cubes.addCard(cube.id, 903, "extra", 2);
    db.prepare("update cube_cards set pool=case when catalog_card_id=903 then 'main' else 'extra' end where cube_id=?").run(cube.id);
    cubes.replaceMain(cube.id, [{ id: 901, copies: 1 }]);
    expect(cubes.getCubePools(cube.id).main.map(card => [card.catalogCardId, card.maxCopies])).toEqual([[901, 1]]);
    expect(cubes.getCubePools(cube.id).extra.map(card => [card.catalogCardId, card.maxCopies])).toEqual([[903, 2]]);
  });
  it("routes direct cube additions by type even if the supplied pool is wrong", () => {
    const cube = cubes.createBlank("test-g", "Test cube", 1);
    cubes.addCard(cube.id, 901, "extra");
    cubes.addCard(cube.id, 902, "extra");
    cubes.addCard(cube.id, 904, "extra");
    cubes.addCard(cube.id, 903, "main");
    check(cube.id);
  });
  it("draft building ignores a false Extra flag and follows actual card types", () => {
    expect(buildDraftDeck([
      { catalogId: 901, type: "Spell Card", extra: true },
      { catalogId: 902, type: "Trap Card", extra: true },
      { catalogId: 904, type: "Pendulum Effect Monster", extra: true },
      { catalogId: 903, type: "Fusion Monster", extra: false },
    ])).toEqual({ main: [901, 902, 904], extra: [903], side: [] });
  });
});
