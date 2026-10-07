import { seedUser } from "../helpers/identity.js";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { migrate } from "../../src/db/index.js";
import { CubeNameTakenError, createCubeService } from "../../src/services/cubes.js";
import { createCardCatalogService } from "../../src/services/card-catalog.js";

function setup() {
  const db = new Database(":memory:");
  migrate(db);
  const ins = db.prepare(
    `insert into card_catalog (ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at)
     values (?,?,?,?,?,?,?,?)`,
  );
  ins.run(1, "A", "Normal Monster", "normal", "i", "i", "[]", "t");
  ins.run(2, "B", "Effect Monster", "effect", "i", "i", "[]", "t");
  ins.run(3, "X", "XYZ Monster", "xyz", "i", "i", "[]", "t");
  ins.run(4, "P", "Synchro Pendulum Effect Monster", "synchro_pendulum", "i", "i", "[]", "t");
  const catalog = createCardCatalogService(db, {
    fetch: async () => ({ ok: true, async json() { return { data: [] }; } }) as Response,
  });
  return { db, cubes: createCubeService(db, catalog) };
}

const pools = (db: Database.Database, id: number) =>
  db.prepare("select catalog_card_id id, pool, max_copies copies from cube_cards where cube_id = ? order by catalog_card_id").all(id);

describe("replaceMain", () => {
  it("replaces main rows, keeps extra rows, strips customCardIds and setNames and keeps other config", () => {
    const { db, cubes } = setup();
    const cube = cubes.save("g", "C", { setNames: ["S"], customCardIds: [1, 1], draftType: "booster" } as any, seedUser(db, "u").userId);
    cubes.addCard(cube.id, 1, "main", 2);
    cubes.addCard(cube.id, 3, "extra", 1);
    const result = cubes.replaceMain(cube.id, [
      { id: 2, copies: 5 },
      { id: 4, copies: 1 },
      { id: 99, copies: 1 },
    ]);
    expect(result).toEqual({ skippedExtra: 1, unknownIds: [99] });
    expect(pools(db, cube.id)).toEqual([
      { id: 2, pool: "main", copies: 5 },
      { id: 3, pool: "extra", copies: 1 },
    ]);
    expect(cubes.findCube(cube.id).config).toEqual({ draftType: "booster" });
  });

  it("drops setNames from a config that has only setNames, so removed set cards stay removed", () => {
    const { db, cubes } = setup();
    const cube = cubes.save("g", "C", { setNames: ["S"] } as any, seedUser(db, "u").userId);
    cubes.replaceMain(cube.id, [{ id: 2, copies: 1 }]);
    expect(cubes.findCube(cube.id).config).toEqual({});
    expect(pools(db, cube.id)).toEqual([{ id: 2, pool: "main", copies: 1 }]);
  });

  it("rejects bad copies without changing anything", () => {
    const { db, cubes } = setup();
    const cube = cubes.createBlank("g", "C", seedUser(db, "u").userId);
    cubes.addCard(cube.id, 1, "main", 2);
    expect(() => cubes.replaceMain(cube.id, [{ id: 2, copies: 100 }])).toThrow();
    expect(pools(db, cube.id)).toEqual([{ id: 1, pool: "main", copies: 2 }]);
  });
});

describe("createWithCards", () => {
  it("splits main/extra and copies the extra pool of another cube in the guild", () => {
    const { db, cubes } = setup();
    const src = cubes.createBlank("g", "Src", seedUser(db, "u").userId);
    cubes.addCard(src.id, 3, "extra", 2);
    const other = cubes.createBlank("other", "Other", seedUser(db, "u").userId);
    cubes.addCard(other.id, 4, "extra", 1);
    const made = cubes.createWithCards("g", "New", seedUser(db, "u").userId, [{ id: 1, copies: 3 }, { id: 4, copies: 1 }], { copyExtraFromCubeId: src.id });
    expect(pools(db, made.id)).toEqual([
      { id: 1, pool: "main", copies: 3 },
      { id: 3, pool: "extra", copies: 2 },
      { id: 4, pool: "extra", copies: 1 },
    ]);
    const foreign = cubes.createWithCards("g", "New2", seedUser(db, "u").userId, [], { copyExtraFromCubeId: other.id });
    expect(pools(db, foreign.id)).toEqual([]);
  });

  it("refuses a name that another cube in the guild already has, ignoring case, and leaves no cube behind", () => {
    const { db, cubes } = setup();
    cubes.createBlank("g", "Goat", seedUser(db, "u").userId);
    expect(() => cubes.createWithCards("g", "goat", seedUser(db, "u").userId, [{ id: 1, copies: 1 }])).toThrow(CubeNameTakenError);
    expect(db.prepare("select count(*) n from cubes").get()).toEqual({ n: 1 });
    // Another guild may reuse it.
    expect(() => cubes.createWithCards("other", "goat", seedUser(db, "u").userId, [])).not.toThrow();
  });
});

describe("config pool migration", () => {
  it("moves customCardIds into cube_cards, keeps unknown ids, leaves sets-only cubes, and is idempotent", () => {
    const { db, cubes } = setup();
    const a = cubes.save("g", "Legacy", { setNames: ["S"], customCardIds: [1, 1, 1, 3, 77] }, seedUser(db, "u").userId);
    const sets = cubes.save("g", "Sets", { setNames: ["S"] }, seedUser(db, "u").userId);
    const filled = cubes.createBlank("g", "Filled", seedUser(db, "u").userId);
    cubes.addCard(filled.id, 2, "main", 1);
    db.prepare("update cubes set config_json = ? where id = ?").run(JSON.stringify({ customCardIds: [1] }), filled.id);
    const many = cubes.save("g", "Many", { customCardIds: Array.from({ length: 120 }, () => 2) }, seedUser(db, "u").userId);

    migrate(db);
    migrate(db);

    expect(pools(db, a.id)).toEqual([
      { id: 1, pool: "main", copies: 3 },
      { id: 3, pool: "extra", copies: 1 },
    ]);
    expect(cubes.findCube(a.id).config).toEqual({ setNames: ["S"], customCardIds: [77] });
    expect(cubes.findCube(sets.id).config).toEqual({ setNames: ["S"] });
    expect(pools(db, sets.id)).toEqual([]);
    expect(cubes.findCube(filled.id).config).toEqual({ customCardIds: [1] });
    // 120 copies of one card cannot fit a cube_cards row: the cube is left as it was.
    expect(pools(db, many.id)).toEqual([]);
    expect(cubes.findCube(many.id).config).toEqual({ customCardIds: Array.from({ length: 120 }, () => 2) });
  });
});
