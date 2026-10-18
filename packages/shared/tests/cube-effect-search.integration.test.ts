import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "../src/db/schema.js";
import { createCardCatalogService } from "../src/services/card-catalog.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createCardInsightService } from "../src/services/card-insights.js";
import { previewCubeSeed } from "../src/services/cube-seed.js";
import { createCubeService } from "../src/services/cubes.js";
import * as insightCatalog from "../src/services/card-insight-catalog.js";
import { seedUser } from "./helpers/identity.js";
import { importCardEffectArtifact } from "../src/cards/effects/artifact.js";
import { CardTags, fillDefaults } from "../src/cards/effects/tags.js";

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

  it.each(["broken", "{}", "null"])("skips an unreadable profile (%s) in previews and foundation suggestions", hooks => {
    seedCatalog();
    db.prepare("UPDATE card_tag_profiles SET hooks_json=? WHERE archetype='Dark Magician'").run(hooks);
    const preview = cubes.previewSeed(cubeId, { phrase: "dark magician", targetCount: 6 });
    expect(preview.rows).toHaveLength(6);
    expect(preview.warnings).toContainEqual(expect.stringMatching(/skipped.*profile.*Dark Magician/i));
    expect(createCardInsightService(db).worksWith(46986414, [7084129]).map(card => card.passcode)).toContain(7084129);
  });

  it.skipIf(!process.env.CUBE_SEED_BENCHMARK_DB)("times a preview over the real full-size catalog without modifying source data", async () => {
    const sourcePath = process.env.CUBE_SEED_BENCHMARK_DB!;
    const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
    const directory = mkdtempSync(join(tmpdir(), "cube-seed-benchmark-"));
    const backup = join(directory, "bot.sqlite");
    try { await source.backup(backup); } finally { source.close(); }
    const benchmark = new Database(backup);
    try {
      migrate(benchmark);
      importCardEffectArtifact(benchmark);
      vi.stubEnv("DUEL_DATA_DIR", join(dirname(sourcePath), "duel-engine"));
      // The lazy display cache can be sparse. Expand only the temporary copy
      // with real, tagged engine cards before measuring the request operation.
      const catalog = insightCatalog.createInsightCatalog(benchmark);
      const insert = benchmark.prepare(`INSERT OR IGNORE INTO card_catalog
        (ygoprodeck_id,name,type,frame_type,effect_text,attribute,level,archetype,image_url,image_url_small,card_sets_json,cached_at)
        VALUES(?,?,?,?,?,?,?,?,'image','small','[]',CURRENT_TIMESTAMP)`);
      try {
        for (const { passcode } of benchmark.prepare<[], { passcode: number }>("SELECT passcode FROM card_tags").all()) {
          const candidate = catalog.candidate(passcode);
          if (!candidate) continue;
          const { card } = candidate;
          insert.run(card.id, card.name, card.typeLine || (card.kind === "monster" ? "Effect Monster" : `${card.kind} Card`),
            card.kind === "monster" ? "effect" : card.kind, card.text, card.attribute ?? null,
            card.level ?? card.rank ?? card.linkRating ?? null, card.archetype ?? null);
        }
      } finally { catalog.close(); }
      const { cards } = benchmark.prepare<[], { cards: number }>("SELECT count(*) AS cards FROM card_catalog").get()!;
      expect(cards).toBeGreaterThanOrEqual(13_000);
      console.info(`Seed preview catalog: ${cards} real cards`);
      console.time("previewCubeSeed real catalog");
      let preview;
      try { preview = previewCubeSeed(benchmark, { phrase: "dark magician", targetCount: 180 }, []); }
      finally { console.timeEnd("previewCubeSeed real catalog"); }
      expect(preview.rows).toHaveLength(180);
    } finally { benchmark.close(); rmSync(directory, { recursive: true, force: true }); }
  }, 30_000);

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

  it.each([false, true])("reserves all available role quotas before filling a large core (member roles=%s)", memberRoles => {
    const card = db.prepare(`INSERT INTO card_catalog(ygoprodeck_id,name,type,frame_type,archetype,image_url,image_url_small,card_sets_json,cached_at)
      VALUES(?,?,'Normal Monster','normal',?,'i','s','[]',CURRENT_TIMESTAMP)`);
    for (let id = 2000; id < (memberRoles ? 2160 : 2060); id++) card.run(id, `Roleless member ${id}`, "Roleless");
    const tag = db.prepare("INSERT INTO card_tags(passcode,summary,roles_json,tags_json,source,schema_version) VALUES(?,'Fixture',?,?,'fixture',1)");
    let nextId = 3000;
    for (const [role, count] of [["searcher", 12], ["extender", 18], ["removal", 12], ["hand_trap", 8]] as const) {
      for (let n = 0; n < count; n++) {
        card.run(nextId, `${role} staple ${n}`, memberRoles && (role === "searcher" || role === "hand_trap") ? "Roleless" : null);
        tag.run(nextId++, JSON.stringify([role]), JSON.stringify(CardTags.parse(fillDefaults({ summary: "Fixture", roles: [role] }))));
      }
    }
    const preview = cubes.previewSeed(cubeId, { phrase: "Roleless", targetCount: 100 });
    expect(preview.rows).toHaveLength(100);
    for (const quota of Object.values(preview.roleQuotas)) expect(quota.selected).toBeGreaterThanOrEqual(quota.target);
    if (memberRoles) {
      const members = preview.rows.filter(row => row.roles.includes("searcher") || row.roles.includes("hand_trap"));
      expect(members.every(row => row.category === "archetype" && row.reason === "Archetype: Roleless")).toBe(true);
    }
    expect(preview.warnings).toEqual([]);
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

describe("warning-only cube pool health", () => {
  it("does not open the insight catalog unless health is explicitly requested", () => {
    vi.stubEnv("EFFECT_SEARCH", "1");
    cubes.addBatch(cubeId, [{ id: 1, copies: 3 }]);
    const open = vi.spyOn(insightCatalog, "createInsightCatalog");
    try {
      const config = { themePackSize: 1, cardsPerPlayer: 2, extraDeckSize: 0, burnUnpicked: false, extraDeckEnabled: false };
      expect(cubes.analyzeCubePools(cubeId, config)).toEqual({ ok: true, errors: [], warnings: [] });
      expect(cubes.analyzeCubePools(cubeId, { ...config, includeHealth: false })).toEqual({ ok: true, errors: [], warnings: [] });
      expect(open).not.toHaveBeenCalled();
    } finally { open.mockRestore(); }
  });

  it("adds role warnings without changing supply errors or readiness", () => {
    vi.stubEnv("EFFECT_SEARCH", "1");
    cubes.addBatch(cubeId, [{ id: 1, copies: 3 }, { id: 2, copies: 3 }]);
    const config = { themePackSize: 1, cardsPerPlayer: 2, extraDeckSize: 0, burnUnpicked: false, extraDeckEnabled: false, includeHealth: true };
    const analysis = cubes.analyzeCubePools(cubeId, config);
    expect(analysis).toMatchObject({ ok: true, errors: [], poolHealth: { cards: 1, roles: { removal: 0 }, warnings: expect.arrayContaining([expect.stringMatching(/removal/)]) } });
    expect(analysis.warnings).toEqual([]);
    vi.stubEnv("EFFECT_SEARCH", "0");
    const disabled = cubes.analyzeCubePools(cubeId, config);
    expect(disabled).toEqual({ ok: true, errors: [], warnings: [] });
  });

  it("includes enabled Extra cards, deduplicates identities, and does not mutate stale pool labels", () => {
    vi.stubEnv("EFFECT_SEARCH", "1");
    cubes.addCard(cubeId, 1, "main", 3);
    db.prepare("INSERT INTO cube_cards(cube_id,catalog_card_id,pool,max_copies) VALUES(?,2,'main',2),(?,4,'extra',1)").run(cubeId, cubeId);
    const before = db.prepare("SELECT * FROM cube_cards").all();
    const analysis = cubes.analyzeCubePools(cubeId, { themePackSize: 1, cardsPerPlayer: 1, extraDeckSize: 0, burnUnpicked: false, extraDeckEnabled: true, includeHealth: true });
    expect(analysis.poolHealth?.cards).toBe(2);
    expect(db.prepare("SELECT * FROM cube_cards").all()).toEqual(before);
  });

  it("keeps the draft ready when health data cannot be read", () => {
    vi.stubEnv("EFFECT_SEARCH", "1");
    cubes.addBatch(cubeId, [{ id: 1, copies: 3 }]);
    db.prepare("INSERT INTO card_tags(passcode,summary,roles_json,tags_json,source,schema_version) VALUES(1,'','[]','broken','fixture',1)").run();
    const analysis = cubes.analyzeCubePools(cubeId, { themePackSize: 1, cardsPerPlayer: 1, extraDeckSize: 0, burnUnpicked: false, extraDeckEnabled: false, includeHealth: true });
    expect(analysis).toMatchObject({ ok: true, errors: [], poolHealth: null, warnings: [] });
  });
});
