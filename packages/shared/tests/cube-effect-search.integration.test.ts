import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "../src/db/schema.js";
import { createCardCatalogService } from "../src/services/card-catalog.js";
import { createCubeService } from "../src/services/cubes.js";
import { seedUser } from "./helpers/identity.js";
import { importCardEffectArtifact } from "../src/cards/effects/artifact.js";

let db: Database.Database;
let cubes: ReturnType<typeof createCubeService>;
let cubeId: number;
beforeEach(() => {
  vi.stubEnv("DUEL_DATA_DIR", "/tmp/cube-effects-no-engine");
  db = new Database(":memory:");
  migrate(db);
  const insert = db.prepare(`INSERT INTO card_catalog(ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at)
    VALUES(?,?,'Effect Monster','effect','image','small','[]',CURRENT_TIMESTAMP)`);
  for (const id of [1, 2, 3, 4]) insert.run(id, id === 4 ? "Card 1" : `Card ${id}`);
  db.prepare("INSERT INTO card_artworks(card_id,artwork_id,image_url,image_url_small,is_main) VALUES(1,4,'i','i',0)").run();
  const engine = new Map([[1, { code: 1, name: "Card 1", type: 33 }], [2, { code: 2, name: "Card 2", type: 8193 }]]);
  cubes = createCubeService(db, createCardCatalogService(db, { identityCatalog: engine }), engine);
  cubeId = cubes.createBlank("g", "Effects", seedUser(db, "owner").userId).id;
});

describe("phrase cube previews over the pinned artifact", () => {
  const seedCatalog = () => {
    const insert = db.prepare(`INSERT INTO card_catalog(ygoprodeck_id,name,type,frame_type,effect_text,attribute,level,archetype,image_url,image_url_small,card_sets_json,cached_at)
      VALUES(?,?,?,?,?,?,?,?,'image','small','[]',CURRENT_TIMESTAMP)`);
    insert.run(46986414, "Dark Magician", "Spellcaster / Normal Monster", "normal", "The ultimate wizard.", "DARK", 7, "Dark Magician");
    insert.run(7084129, "Magician's Rod", "Spellcaster / Effect Monster", "effect", 'Add a card that mentions "Dark Magician".', "DARK", 3, "Dark Magician");
    insert.run(47222536, "Dark Magical Circle", "Spell Card", "spell", 'Banish a card when "Dark Magician" is summoned.', null, null, "Dark Magician");
    insert.run(97631303, "Magicians' Souls", "Spellcaster / Effect Monster", "effect", "Send a Level 6 or higher Spellcaster from Deck to GY; Special Summon this card.", "DARK", 1, null);
    insert.run(97268402, "Effect Veiler", "Spellcaster / Tuner Effect Monster", "effect", "Negate a monster effect.", "LIGHT", 1, null);
    insert.run(14558127, "Ash Blossom & Joyous Spring", "Zombie / Tuner Effect Monster", "effect", "Negate an effect.", "FIRE", 3, null);
    insert.run(12580477, "Raigeki", "Spell Card", "spell", "Destroy all monsters your opponent controls.", null, null, null);
    insert.run(83764719, "Monster Reborn", "Spell Card", "spell", "Special Summon a monster from the GY.", null, null, null);
    importCardEffectArtifact(db);
  };

  it("previews members, mechanical partners and role staples without writing, with bounded target and reasons", () => {
    seedCatalog();
    const before = db.prepare("SELECT * FROM cubes").all();
    const preview = cubes.previewSeed(cubeId, { phrase: "dark magician", targetCount: 6, maxCopies: 2 });
    expect(preview.rows).toHaveLength(6);
    expect(new Set(preview.rows.map(row => row.id)).size).toBe(6);
    expect(preview.rows).toContainEqual(expect.objectContaining({ id: 46986414, category: "archetype", copies: 2, pool: "main" }));
    expect(preview.rows.some(row => row.category === "partner")).toBe(true);
    expect(preview.rows.some(row => row.category === "staple")).toBe(true);
    expect(preview.rows.every(row => row.reason.length > 0)).toBe(true);
    expect(cubes.getCubePools(cubeId)).toEqual({ main: [], extra: [] });
    expect(db.prepare("SELECT * FROM cubes").all()).toEqual(before);
    expect(cubes.previewSeed(cubeId, { phrase: "dark magician", targetCount: 6, maxCopies: 2 })).toEqual(preview);
  });

  it("excludes existing identities, reports shortages and does not fill an unknown phrase with staples", () => {
    seedCatalog();
    cubes.addBatch(cubeId, [{ id: 46986414, copies: 1 }]);
    const preview = cubes.previewSeed(cubeId, { phrase: "dark magician", targetCount: 20 });
    expect(preview.rows.every(row => row.id !== 46986414)).toBe(true);
    expect(preview.rows.length).toBeLessThan(20);
    expect(preview.warnings).toContainEqual(expect.stringMatching(/Only .*20/));
    expect(cubes.previewSeed(cubeId, { phrase: "bananas", targetCount: 10 })).toMatchObject({ rows: [], warnings: expect.any(Array) });
  });

  it("validates phrases, copy bounds and target bounds", () => {
    for (const input of [{ phrase: "" }, { phrase: "x".repeat(513) }, { phrase: "searchers", targetCount: 501 }, { phrase: "searchers", targetCount: 0 }, { phrase: "searchers", maxCopies: 100 }]) {
      expect(() => cubes.previewSeed(cubeId, input)).toThrow();
    }
  });
});
afterEach(() => { db.close(); vi.unstubAllEnvs(); });

describe("cube batch writes with real SQLite", () => {
  it("routes by engine type, keeps authored copies, and reports existing and repeated identities", () => {
    cubes.addCard(cubeId, 1, "main", 7);
    const result = cubes.addBatch(cubeId, [
      { id: 1, copies: 2 }, { id: 4, copies: 3 },
      { id: 2, copies: 5, pool: "main" }, { id: 2, copies: 9 }, { id: 3, copies: 99, pool: "extra" },
    ]);
    expect(result).toMatchObject({ added: 2, copies: 104, duplicates: [1, 4, 2] });
    expect(cubes.getCubePools(cubeId)).toMatchObject({
      main: [{ catalogCardId: 1, maxCopies: 7 }, { catalogCardId: 3, maxCopies: 99 }],
      extra: [{ catalogCardId: 2, maxCopies: 5 }],
    });
  });

  it("treats config-backed cards as duplicates and leaves their copies intact", () => {
    db.prepare("UPDATE cubes SET config_json=? WHERE id=?").run(JSON.stringify({ customCardIds: [1, 1], customExtraCardIds: [2] }), cubeId);
    expect(cubes.addBatch(cubeId, [{ id: 1, copies: 5 }, { id: 2, copies: 5 }])).toMatchObject({ added: 0, copies: 0, duplicates: [1, 2] });
    expect(cubes.getCubePools(cubeId)).toEqual({ main: [], extra: [] });
    expect(cubes.findCube(cubeId).config.customCardIds).toEqual([1, 1]);
  });

  it("rejects unknown cards and bad copies without a partial write", () => {
    for (const entries of [[{ id: 1, copies: 2 }, { id: 999, copies: 1 }], [{ id: 1, copies: 100 }]]) {
      expect(() => cubes.addBatch(cubeId, entries)).toThrow();
      expect(cubes.getCubePools(cubeId)).toEqual({ main: [], extra: [] });
    }
  });

  it("rolls back all rows when a later insert fails", () => {
    const before = db.prepare("SELECT updated_at FROM cubes WHERE id=?").get(cubeId);
    db.exec("CREATE TRIGGER fail_batch BEFORE INSERT ON cube_cards WHEN NEW.catalog_card_id=2 BEGIN SELECT RAISE(ABORT,'batch failed'); END");
    expect(() => cubes.addBatch(cubeId, [{ id: 1, copies: 1 }, { id: 2, copies: 2 }])).toThrow("batch failed");
    expect(cubes.getCubePools(cubeId)).toEqual({ main: [], extra: [] });
    expect(db.prepare("SELECT updated_at FROM cubes WHERE id=?").get(cubeId)).toEqual(before);
  });
});
