import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { migrate } from "../../src/db/index.js";
import { createCubeService } from "../../src/services/cubes.js";
import { createCardCatalogService } from "../../src/services/card-catalog.js";
import { MAX_CUBE_COPIES } from "../../src/services/constants.js";
import { prepareBoosterPool } from "../../src/services/deal.js";
import { createDraftService } from "../../src/services/drafts.js";

function emptyCatalog(db: Database.Database) {
  return createCardCatalogService(db, {
    fetch: async () => ({ ok: true, async json() { return { data: [] }; } }) as Response,
  });
}

function seedCard(
  db: Database.Database,
  id: number,
  name: string,
  type: string,
  frameType: string,
) {
  db.prepare(
    `insert into card_catalog (ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at)
     values (?,?,?,?,?,?,?,?)`,
  ).run(id, name, type, frameType, "i", "i", "[]", "t");
}

function setup() {
  const db = new Database(":memory:");
  migrate(db);
  const cubes = createCubeService(db, emptyCatalog(db));
  seedCard(db, 1, "Main A", "Normal Monster", "normal");
  seedCard(db, 2, "Xyz B", "XYZ Monster", "xyz");
  return { db, cubes };
}

describe("cube service core", () => {
  it("creates a blank cube and adds/removes cards", () => {
    const { cubes } = setup();
    const cube = cubes.createBlank("g", "Stun", "u");
    cubes.addCard(cube.id, 1, "main");
    cubes.addCard(cube.id, 2, "extra", 1);
    let pools = cubes.getCubePools(cube.id);
    expect(pools.main.map((c) => c.catalogCardId)).toEqual([1]);
    expect(pools.extra).toEqual([
      { catalogCardId: 2, pool: "extra", maxCopies: 1, source: undefined },
    ]);
    cubes.removeCard(cube.id, 1);
    pools = cubes.getCubePools(cube.id);
    expect(pools.main).toEqual([]);
  });

  it("setMaxCopies updates a card's copies", () => {
    const { cubes } = setup();
    const cube = cubes.createBlank("g", "Stun", "u");
    cubes.addCard(cube.id, 1, "main");
    cubes.setMaxCopies(cube.id, 1, 2);
    expect(cubes.getCubePools(cube.id).main[0].maxCopies).toBe(2);
  });

  it("lists cubes for a guild", () => {
    const { cubes } = setup();
    cubes.createBlank("g", "Stun", "u");
    cubes.createBlank("g", "Blue-Eyes", "u");
    expect(cubes.listCubes("g").map((t) => t.name).sort()).toEqual(["Blue-Eyes", "Stun"]);
  });

  it("renameCube renames and rejects a duplicate name", () => {
    const { cubes } = setup();
    const a = cubes.createBlank("g", "Stun", "u");
    cubes.createBlank("g", "Blue-Eyes", "u");
    expect(cubes.renameCube(a.id, "Goat Stun")).toEqual({ ok: true });
    expect(cubes.findCube(a.id).name).toBe("Goat Stun");
    expect(cubes.renameCube(a.id, "Blue-Eyes")).toEqual({ error: 'A cube named "Blue-Eyes" already exists' });
  });

  it("deleteCube removes the cube and its cards", () => {
    const { db, cubes } = setup();
    const cube = cubes.createBlank("g", "Stun", "u");
    cubes.addCard(cube.id, 1, "main");
    cubes.deleteCube(cube.id);
    expect(() => cubes.findCube(cube.id)).toThrow();
    const cards = db.prepare("select count(*) as c from cube_cards where cube_id = ?").get(cube.id) as { c: number };
    expect(cards.c).toBe(0);
  });

  it("seeds a cube from an archetype without padding a thin extra deck", async () => {
    const db = new Database(":memory:");
    migrate(db);
    const archMain = { id: 10, name: "BEWD", type: "Normal Monster", frameType: "normal", archetype: "Blue-Eyes", card_images: [{ image_url: "i", image_url_small: "i" }] };
    const archExtra = { id: 11, name: "BE Twin", type: "Fusion Monster", frameType: "fusion", archetype: "Blue-Eyes", card_images: [{ image_url: "i", image_url_small: "i" }] };
    // A generic Extra-Deck card is available from the API, but must NOT be pulled
    // in to pad a thin extra deck — that top-up behaviour was removed.
    const genXyz = { id: 12, name: "Utopia", type: "XYZ Monster", frameType: "xyz", card_images: [{ image_url: "i", image_url_small: "i" }] };
    const catalog = createCardCatalogService(db, {
      fetch: async (input) => {
        const u = new URL(String(input));
        const a = u.searchParams.get("archetype");
        const ty = u.searchParams.get("type");
        const data = a === "Blue-Eyes" ? [archMain, archExtra] : ty === "XYZ Monster" ? [genXyz] : [];
        return { ok: true, async json() { return { data }; } } as Response;
      },
    });
    const cubes = createCubeService(db, catalog);
    const cube = await cubes.createFromArchetype("g", "Blue-Eyes", "u");
    const pools = cubes.getCubePools(cube.id);
    expect(pools.main.map((c) => c.catalogCardId)).toContain(10);
    // Extra pool is exactly the archetype's own extra cards — no generic top-up.
    expect(pools.extra.map((c) => c.catalogCardId)).toEqual([11]);
    expect(pools.extra.some((c) => c.source === "generic-extra")).toBe(false);
    expect(cube.archetype).toBe("Blue-Eyes");
  });

  it("imports passcodes, routing extra-deck cards to the extra pool", async () => {
    const { db, cubes } = setup(); // id 1 = normal, id 2 = xyz already in catalog
    const cube = cubes.createBlank("g", "Custom", "u");
    const res = await cubes.importPasscodes(cube.id, [1, 2]);
    expect(res.added).toBe(2);
    expect(res.unknown).toEqual([]);
    const pools = cubes.getCubePools(cube.id);
    expect(pools.main.map((c) => c.catalogCardId)).toEqual([1]);
    expect(pools.extra.map((c) => c.catalogCardId)).toEqual([2]);
    void db;
  });

  it("collapses repeated passcodes into copies, with no cap of 3", async () => {
    const { cubes } = setup();
    const cube = cubes.createBlank("g", "Custom", "u");
    await cubes.importPasscodes(cube.id, [1, 1, 1, 1, 1, 1]);
    expect(cubes.getCubePools(cube.id).main[0].maxCopies).toBe(6);
  });

  it("caps imported copies at the cube maximum", async () => {
    const { cubes } = setup();
    const cube = cubes.createBlank("g", "Custom", "u");
    await cubes.importPasscodes(cube.id, Array.from({ length: MAX_CUBE_COPIES + 20 }, () => 1));
    expect(cubes.getCubePools(cube.id).main[0].maxCopies).toBe(MAX_CUBE_COPIES);
  });

  it("holds any number of copies of a card in a cube, not just three", () => {
    const { cubes } = setup();
    const cube = cubes.createBlank("g", "Stun", "u");
    cubes.addCard(cube.id, 1, "main", 12);
    expect(cubes.getCubePools(cube.id).main[0].maxCopies).toBe(12);
    cubes.setMaxCopies(cube.id, 1, MAX_CUBE_COPIES);
    expect(cubes.getCubePools(cube.id).main[0].maxCopies).toBe(MAX_CUBE_COPIES);
  });

  it.each([0, -1, 2.5, MAX_CUBE_COPIES + 1, Number.NaN])("rejects %s copies and leaves the cube alone", (copies) => {
    const { cubes } = setup();
    const cube = cubes.createBlank("g", "Stun", "u");
    cubes.addCard(cube.id, 1, "main", 2);
    expect(() => cubes.addCard(cube.id, 2, "main", copies)).toThrow(/whole number from 1 to 99/);
    expect(() => cubes.setMaxCopies(cube.id, 1, copies)).toThrow(/whole number from 1 to 99/);
    expect(cubes.getCubePools(cube.id).main.map((c) => [c.catalogCardId, c.maxCopies])).toEqual([[1, 2]]);
  });

  it("reports unknown passcodes that cannot be synced", async () => {
    const { cubes } = setup(); // empty catalog: fetch returns []
    const cube = cubes.createBlank("g", "Custom", "u");
    const res = await cubes.importPasscodes(cube.id, [1, 9999999]);
    expect(res.added).toBe(1);
    expect(res.unknown).toEqual([9999999]);
  });

  describe("passcode lookups that fail", () => {
    /** A catalog whose card database answers HTTP 400 for an unknown id, as YGOPRODeck does. */
    function rejectingSetup(failure: "http400" | "offline" = "http400") {
      const db = new Database(":memory:");
      migrate(db);
      const calls: string[] = [];
      const catalog = createCardCatalogService(db, {
        fetch: async (input) => {
          calls.push(String(input));
          if (failure === "offline") throw new Error("fetch failed");
          return { ok: false, status: 400, async json() { return { error: "No card matching your query" }; } } as Response;
        },
      });
      seedCard(db, 1, "Main A", "Normal Monster", "normal");
      seedCard(db, 2, "Xyz B", "XYZ Monster", "xyz");
      return { db, calls, cubes: createCubeService(db, catalog) };
    }

    it("treats an HTTP 400 as an unknown passcode and still imports the rest", async () => {
      const { cubes, calls } = rejectingSetup();
      const cube = cubes.createBlank("g", "Custom", "u");
      const res = await cubes.importPasscodes(cube.id, [1, 777, 2, 1]);
      // Legacy rows refresh their artwork metadata too; a no-match keeps their cached data.
      expect(calls).toHaveLength(3);
      expect(res).toEqual({ added: 2, unknown: [777] });
      expect(cubes.getCubePools(cube.id).main.map((c) => [c.catalogCardId, c.maxCopies])).toEqual([[1, 2]]);
      expect(cubes.getCubePools(cube.id).extra.map((c) => c.catalogCardId)).toEqual([2]);
    });

    it("writes nothing when the card database cannot be reached, so a retry cannot double copies", async () => {
      const { cubes } = rejectingSetup("offline");
      const cube = cubes.createBlank("g", "Custom", "u");
      await expect(cubes.importPasscodes(cube.id, [1, 777])).rejects.toThrow(/Could not reach the card database/);
      expect(cubes.getCubePools(cube.id)).toEqual({ main: [], extra: [] });
    });

    it("looks up every group before it writes any", async () => {
      const { cubes } = rejectingSetup("offline");
      const cube = cubes.createBlank("g", "Custom", "u");
      await expect(
        cubes.importPasscodeGroups(cube.id, [{ codes: [1] }, { codes: [2, 888], pool: "extra" }]),
      ).rejects.toThrow();
      expect(cubes.getCubePools(cube.id)).toEqual({ main: [], extra: [] });

    });

    it("rolls the whole import back when a write fails half way", async () => {
      const { db, cubes } = rejectingSetup();
      const cube = cubes.createBlank("g", "Custom", "u");
      db.prepare(
        "create trigger boom before insert on cube_cards when new.catalog_card_id = 2 begin select raise(abort, 'boom'); end",
      ).run();
      await expect(
        cubes.importPasscodeGroups(cube.id, [{ codes: [1] }, { codes: [2], pool: "extra" }]),
      ).rejects.toThrow(/boom/);
      expect(cubes.getCubePools(cube.id)).toEqual({ main: [], extra: [] });
    });

    it("imports several groups at once, each into its own pool, and counts distinct cards", async () => {
      const { cubes } = rejectingSetup();
      const cube = cubes.createBlank("g", "Custom", "u");
      const res = await cubes.importPasscodeGroups(cube.id, [
        { codes: [1, 1, 1] },
        { codes: [2, 999], pool: "extra" },
      ]);
      expect(res).toEqual({ added: 2, unknown: [999] });
      const pools = cubes.getCubePools(cube.id);
      expect(pools.main.map((c) => [c.catalogCardId, c.maxCopies])).toEqual([[1, 3]]);
      expect(pools.extra.map((c) => [c.catalogCardId, c.maxCopies])).toEqual([[2, 1]]);
    });
  });

  describe("save over an existing cube", () => {
    const raw = (db: Database.Database, id: number) =>
      JSON.parse((db.prepare("select config_json from cubes where id = ?").get(id) as { config_json: string }).config_json);

    it("replaces the draft config but keeps the cube type", () => {
      const { db, cubes } = setup();
      const cube = cubes.save("g", "Pool", { customCardIds: [1, 2], packSize: 9 }, "u");
      db.prepare("update cubes set config_json = ? where id = ?").run(
        JSON.stringify({ customCardIds: [1, 2], packSize: 9, draftType: "theme" }),
        cube.id,
      );
      const again = cubes.save("g", "Pool", { setNames: ["LOB"], packSize: 12 }, "u2");
      expect(again.id).toBe(cube.id);
      expect(raw(db, cube.id)).toEqual({ setNames: ["LOB"], packSize: 12, draftType: "theme" });
    });

    it("lets a config that names a type win, and adds nothing to a cube that had none", () => {
      const { db, cubes } = setup();
      const cube = cubes.save("g", "Pool", { packSize: 9 }, "u");
      cubes.save("g", "Pool", { packSize: 10 }, "u");
      expect(raw(db, cube.id)).toEqual({ packSize: 10 });
      cubes.save("g", "Pool", { packSize: 10, draftType: "booster" }, "u");
      cubes.save("g", "Pool", { packSize: 11, draftType: "any" }, "u");
      expect(raw(db, cube.id)).toEqual({ packSize: 11, draftType: "any" });
    });

    it("survives an unreadable old config", () => {
      const { db, cubes } = setup();
      const cube = cubes.save("g", "Pool", { packSize: 9 }, "u");
      db.prepare("update cubes set config_json = 'not json' where id = ?").run(cube.id);
      cubes.save("g", "Pool", { packSize: 10 }, "u");
      expect(raw(db, cube.id)).toEqual({ packSize: 10 });
    });
  });

  it("seedArchetypeInto additively pulls an archetype into an existing cube", async () => {
    const db = new Database(":memory:");
    migrate(db);
    const archMain = { id: 10, name: "BEWD", type: "Normal Monster", frameType: "normal", archetype: "Blue-Eyes", card_images: [{ image_url: "i", image_url_small: "i" }] };
    const catalog = createCardCatalogService(db, {
      fetch: async (input) => {
        const u = new URL(String(input));
        const data = u.searchParams.get("archetype") === "Blue-Eyes" ? [archMain] : [];
        return { ok: true, async json() { return { data }; } } as Response;
      },
    });
    const cubes = createCubeService(db, catalog);
    const cube = cubes.createBlank("g", "Mixed", "u");
    const res = await cubes.seedArchetypeInto(cube.id, "Blue-Eyes");
    expect(res.added).toBe(1);
    expect(cubes.getCubePools(cube.id).main.map((c) => c.catalogCardId)).toEqual([10]);
  });

  it("flags a main-short cube as an error (burn off)", () => {
    const { cubes } = setup();
    const t = cubes.createBlank("g", "Tiny", "u");
    cubes.addCard(t.id, 1, "main", 3); // 3 main copies, far short of 42
    const a = cubes.analyzeCubePools(t.id, {
      themePackSize: 3,
      cardsPerPlayer: 40,
      extraDeckSize: 15,
      burnUnpicked: false,
      extraDeckEnabled: false,
    });
    expect(a.ok).toBe(false);
    expect(a.errors[0]).toMatch(/main/i);
  });

  it("flags a cube that is big by copies but too narrow for the three-copy limit", () => {
    const { db, cubes } = setup();
    const t = cubes.createBlank("g", "Narrow", "u");
    for (const id of [100, 101]) {
      seedCard(db, id, `C${id}`, "Normal Monster", "normal");
      cubes.addCard(t.id, id, "main", 99); // 198 cards in the cube, but a player can take only 6
    }
    const a = cubes.analyzeCubePools(t.id, {
      themePackSize: 3,
      cardsPerPlayer: 40,
      extraDeckSize: 15,
      burnUnpicked: false,
      extraDeckEnabled: false,
    });
    expect(a.ok).toBe(false);
    expect(a.errors[0]).toMatch(/at most 3 copies/);
  });

  it("makes capped main reach a warning when the pick copy limit is off", () => {
    const { db, cubes } = setup();
    const cube = cubes.createBlank("g", "Limit off", "u");
    cubes.addCard(cube.id, 1, "main", 20);
    const analysis = cubes.analyzeCubePools(cube.id, { themePackSize: 2, cardsPerPlayer: 10, extraDeckSize: 0, burnUnpicked: false, extraDeckEnabled: false, copyLimit: false });
    expect(analysis.ok).toBe(true);
    expect(analysis.warnings).toHaveLength(1);
    db.close();
  });

  it("passes a main-sufficient cube and skips extra when extra disabled", () => {
    const { db, cubes } = setup();
    const t = cubes.createBlank("g", "Big", "u");
    for (let i = 100; i < 142; i++) {
      seedCard(db, i, `C${i}`, "Normal Monster", "normal");
      cubes.addCard(t.id, i, "main", 1);
    }
    const a = cubes.analyzeCubePools(t.id, {
      themePackSize: 3,
      cardsPerPlayer: 40,
      extraDeckSize: 15,
      burnUnpicked: false,
      extraDeckEnabled: false,
    });
    expect(a.ok).toBe(true);
    expect(a.warnings).toEqual([]);
  });

  it("warns (not errors) on a thin extra pool when extra enabled", () => {
    const { db, cubes } = setup();
    const t = cubes.createBlank("g", "Big", "u");
    for (let i = 100; i < 142; i++) {
      seedCard(db, i, `C${i}`, "Normal Monster", "normal");
      cubes.addCard(t.id, i, "main", 1);
    }
    const a = cubes.analyzeCubePools(t.id, {
      themePackSize: 3,
      cardsPerPlayer: 40,
      extraDeckSize: 15,
      burnUnpicked: false,
      extraDeckEnabled: true,
    });
    expect(a.ok).toBe(true); // warnings don't fail ok
    expect(a.warnings.length).toBeGreaterThan(0);
  });

  it("warns when five Extra cards with five copies cannot fill the Extra choices", () => {
    const { db, cubes } = setup();
    const cube = cubes.createBlank("g", "Extra copies", "u");
    cubes.addCard(cube.id, 1, "main", 3);
    for (let id = 10; id < 15; id++) {
      seedCard(db, id, `Extra ${id}`, "XYZ Monster", "xyz");
      cubes.addCard(cube.id, id, "extra", 5);
    }
    const analysis = cubes.analyzeCubePools(cube.id, { themePackSize: 3, cardsPerPlayer: 1, extraDeckSize: 15, burnUnpicked: false, extraDeckEnabled: true });
    expect(analysis.ok).toBe(true);
    expect(analysis.warnings).toEqual([expect.stringMatching(/15.*17/)]);
    db.close();
  });

  it("requires more cards under burnUnpicked (multiplied requirement)", () => {
    const { db, cubes } = setup();
    const t = cubes.createBlank("g", "Big", "u");
    for (let i = 100; i < 142; i++) {
      seedCard(db, i, `C${i}`, "Normal Monster", "normal");
      cubes.addCard(t.id, i, "main", 1);
    }
    const burnOn = cubes.analyzeCubePools(t.id, {
      themePackSize: 3,
      cardsPerPlayer: 40,
      extraDeckSize: 15,
      burnUnpicked: true,
      extraDeckEnabled: false,
    });
    expect(burnOn.ok).toBe(false);
  });
});

describe("cube service Discord-template-compatible ops", () => {
  it("save round-trips the draft config, findByName/list read it back", () => {
    const { cubes } = setup();
    const config = { setNames: ["Metal Raiders"], packsPerPlayer: 5, packSize: 8 };
    const saved = cubes.save("g", "My Booster", config, "u");
    expect(saved.name).toBe("My Booster");
    expect(saved.config).toEqual(config);

    const found = cubes.findByName("g", "My Booster");
    expect(found?.config).toEqual(config);
    expect(cubes.list("g").map((c) => c.name)).toContain("My Booster");
  });

  it("save upserts on (guild, name) conflict", () => {
    const { cubes } = setup();
    cubes.save("g", "T", { packsPerPlayer: 3 }, "u");
    cubes.save("g", "T", { packsPerPlayer: 7 }, "u");
    expect(cubes.findByName("g", "T")?.config.packsPerPlayer).toBe(7);
    expect(cubes.list("g").filter((c) => c.name === "T")).toHaveLength(1);
  });

  it("delete removes a template cube by name; deleting a missing one is a no-op", () => {
    const { cubes } = setup();
    cubes.save("g", "T", {}, "u");
    cubes.delete("g", "T");
    expect(cubes.findByName("g", "T")).toBeUndefined();
    expect(() => cubes.delete("g", "Missing")).not.toThrow();
  });

  it("list is scoped to the guild and ordered by name", () => {
    const { cubes } = setup();
    cubes.save("g", "Zoo", { setNames: ["Z"] }, "u");
    cubes.save("g", "Alpha", { setNames: ["A"] }, "u");
    cubes.save("other", "Modern", { setNames: ["M"] }, "u");
    expect(cubes.list("g").map((c) => c.name)).toEqual(["Alpha", "Zoo"]);
    expect(cubes.findByName("other", "Modern")?.config).toEqual({ setNames: ["M"] });
    expect(cubes.findByName("g", "Modern")).toBeUndefined();
  });

  it("applyCubeToConfig expands each main-pool copy", () => {
    const { cubes } = setup();
    const cube = cubes.createBlank("g", "Three copies", "u");
    cubes.addCard(cube.id, 1, "main", 3);
    cubes.addCard(cube.id, 2, "extra", 3);
    expect(cubes.applyCubeToConfig(cube.id).customCardIds).toEqual([1, 1, 1]);
  });

  it("keeps saved cube quantities when its config also selects catalog cards", () => {
    const { db, cubes } = setup();
    try {
      const cube = cubes.save("g", "Authored hybrid", { includeNames: ["Main A"] }, "u");
      cubes.addCard(cube.id, 1, "main", 3);
      const config = cubes.applyCubeToConfig(cube.id);
      const ids = createDraftService(db).resolveCubeCardIds(config);
      expect(ids).toEqual([1, 1, 1, 1]);
      expect(prepareBoosterPool(ids, config, 120)).toEqual(ids);
    } finally { db.close(); }
  });

  it("applyCubeToConfig keeps config copies and excludes the Extra pool", () => {
    const { cubes } = setup(); // catalog cards 1 (main/normal) and 2 (extra/xyz)
    const cube = cubes.save("g", "Hybrid", { setNames: ["Metal Raiders"], customCardIds: [1] }, "u");
    cubes.addCard(cube.id, 2, "extra"); // explicit extra-pool card
    const out = cubes.applyCubeToConfig(cube.id, { customCardIds: [3] });
    expect(out.setNames).toEqual(["Metal Raiders"]);
    expect([...out.customCardIds!].sort((a, b) => a - b)).toEqual([1, 3]);
  });
  it("applyCubeToConfig keeps listed quantities when the same card has a pool row", () => {
    const { cubes } = setup();
    const cube = cubes.save("g", "Listed copies", { customCardIds: [1, 1] }, "u");
    cubes.addCard(cube.id, 1, "main", 3);
    expect(cubes.applyCubeToConfig(cube.id, { customCardIds: [3, 3] }).customCardIds).toEqual([3, 3, 1, 1]);
  });
});
