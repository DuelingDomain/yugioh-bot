import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../../src/db/schema.js";
import { createCardCatalogService } from "../../src/services/card-catalog.js";
import { createCubeService } from "../../src/services/cubes.js";

let db: Database.Database;
let cubes: ReturnType<typeof createCubeService>;
let cubeId: number;
beforeEach(() => {
  db = new Database(":memory:"); migrate(db);
  const insert = db.prepare(`insert into card_catalog (ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at)
    values (?,?,?,?, 'i','i','[]','t')`);
  insert.run(1, "Dark Hole", "Spell Card", "spell");
  insert.run(2, "Shooting Star Dragon", "Synchro Monster", "synchro");
  insert.run(3, "Maxx C", "Effect Monster", "effect");
  cubes = createCubeService(db, createCardCatalogService(db, { identityCatalog: new Map() }));
  cubeId = cubes.createBlank("g", "Cube", "owner").id;
});
afterEach(() => db.close());

describe("transactional resolved list writes", () => {
  it("rejects over-cap legacy copies rather than removing existing copies or returning a negative gain", () => {
    const config = { customCardIds: Array<number>(100).fill(1), draftType: "booster" };
    db.prepare("update cubes set config_json = ? where id = ?").run(JSON.stringify(config), cubeId);
    expect(() => cubes.importResolvedCards(cubeId, [{ id: 1, copies: 1 }])).toThrow(/Copies/);
    expect(cubes.getCubePools(cubeId)).toEqual({ main: [], extra: [] });
    expect(cubes.findCube(cubeId).config).toEqual(config);
  });
  it("adds to legacy config copies and materializes the affected cards so draft configs use the new totals", () => {
    db.prepare("update cubes set config_json = ? where id = ?").run(JSON.stringify({ customCardIds: [1, 1, 3], setNames: ["S"], draftType: "booster" }), cubeId);
    expect(cubes.importResolvedCards(cubeId, [{ id: 1, copies: 3 }])).toEqual({ added: 1, copies: 3 });
    expect(cubes.getCubePools(cubeId).main).toMatchObject([{ catalogCardId: 1, maxCopies: 5 }]);
    expect(cubes.findCube(cubeId).config).toEqual({ customCardIds: [3], setNames: ["S"], draftType: "booster" });
    expect(cubes.applyCubeToConfig(cubeId).customCardIds).toEqual([3, 1, 1, 1, 1, 1]);
  });

  it("adds copies, merges repeated entries across pools, caps at 99 and sends Extra Deck frames to extra", () => {
    cubes.addCard(cubeId, 1, "main", 97);
    const result = cubes.importResolvedCards(cubeId, [
      { id: 1, copies: 3, pool: "main" }, { id: 1, copies: 2, pool: "extra" },
      { id: 2, copies: 2, pool: "main" }, { id: 3, copies: 1 },
    ]);
    expect(result).toEqual({ added: 3, copies: 5 });
    expect(cubes.getCubePools(cubeId)).toMatchObject({ main: [{ catalogCardId: 3, maxCopies: 1 }], extra: [
      { catalogCardId: 1, maxCopies: 99 }, { catalogCardId: 2, maxCopies: 2 },
    ] });
    expect(cubes.importResolvedCards(cubeId, [{ id: 1, copies: 2, pool: "extra" }])).toEqual({ added: 1, copies: 0 });
  });

  it("creates from resolved entries in both pools, with frame placement overriding explicit main", () => {
    const cube = cubes.createWithCards("g", "Imported", "owner", [{ id: 1, copies: 3, pool: "extra" }, { id: 2, copies: 1, pool: "main" }]);
    expect(cubes.getCubePools(cube.id).main).toEqual([]);
    expect(cubes.getCubePools(cube.id).extra.map((c) => [c.catalogCardId, c.maxCopies])).toEqual([[1, 3], [2, 1]]);
  });

  it("rolls back every row and timestamp when a later write fails", () => {
    const before = db.prepare("select updated_at from cubes where id = ?").get(cubeId);
    db.exec("create trigger fail_card before insert on cube_cards when NEW.catalog_card_id = 3 begin select raise(ABORT, 'write failed'); end;");
    expect(() => cubes.importResolvedCards(cubeId, [{ id: 1, copies: 2 }, { id: 3, copies: 1 }])).toThrow("write failed");
    expect(cubes.getCubePools(cubeId)).toEqual({ main: [], extra: [] });
    expect(db.prepare("select updated_at from cubes where id = ?").get(cubeId)).toEqual(before);
  });

  it("validates every resolved entry before writing and does not touch an empty import", () => {
    const before = db.prepare("select updated_at from cubes where id = ?").get(cubeId);
    expect(cubes.importResolvedCards(cubeId, [])).toEqual({ added: 0, copies: 0 });
    expect(() => cubes.importResolvedCards(cubeId, [{ id: 1, copies: 2 }, { id: 999, copies: 1 }])).toThrow(/catalog/i);
    expect(() => cubes.importResolvedCards(cubeId, [{ id: 1, copies: 0 }])).toThrow(/Copies/);
    expect(cubes.getCubePools(cubeId)).toEqual({ main: [], extra: [] });
    expect(db.prepare("select updated_at from cubes where id = ?").get(cubeId)).toEqual(before);
  });
});
