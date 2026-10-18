import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "../src/db/schema.js";
import { createCardCatalogService } from "../src/services/card-catalog.js";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createCardInsightService } from "../src/services/card-insights.js";
import { previewCubeSeed } from "../src/services/cube-seed.js";
import { getCubeSeedIndex, initializeCubeSeedIndex, prepareCubeSeedIndex } from "../src/services/cube-seed-index.js";
import { createCubeService } from "../src/services/cubes.js";
import * as insightCatalog from "../src/services/card-insight-catalog.js";
import { seedUser } from "./helpers/identity.js";
import { importCardEffectArtifact } from "../src/cards/effects/artifact.js";
import { CardTags, fillDefaults } from "../src/cards/effects/tags.js";
import { readInsightProfiles } from "../src/services/card-insight-profiles.js";
import { scoreForDeck } from "../src/cards/effects/synergy.js";

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

  it("matches unprepared Synchron scoring when real Roid/roid profiles share a NOCASE lookup", () => {
    seedCatalog();
    const insert = db.prepare(`INSERT INTO card_catalog
      (ygoprodeck_id,name,type,frame_type,effect_text,attribute,level,archetype,image_url,image_url_small,card_sets_json,cached_at)
      VALUES(?,?,?,?,?,?,?,?,'image','small','[]',CURRENT_TIMESTAMP)`);
    insert.run(2254222, "Speedroid Wing Synchron", "Machine / Pendulum / Tuner / Effect Monster", "effect", 'Send 1 "Speedroid" Spell/Trap from your Deck to the GY.', "WIND", 5, "roid");
    insert.run(9742784, "Jet Synchron", "Machine / Tuner / Effect Monster", "effect", 'If this card is sent to the GY as Synchro Material: You can add 1 "Junk" monster from your Deck to your hand.', "FIRE", 1, "Synchro");
    insert.run(572850, "Tearlaments Scheiren", "Aqua / Effect Monster", "effect", "Send the top 3 cards of your Deck to the GY.", "DARK", 4, "Tearlaments");
    insert.run(7236721, "Scareclaw Defanging", "Continuous Spell Card", "spell", 'Banish any monster destroyed by battle with a "Scareclaw" Link Monster.', null, null, "Scareclaw");
    expect(db.prepare("SELECT archetype FROM card_tag_profiles WHERE archetype='roid' COLLATE NOCASE").all()).toHaveLength(2);
    const index = prepareCubeSeedIndex(db);
    const unprepared = structuredClone(index.candidates);
    const anchors = unprepared.filter(({ card }) => card.name.includes("Synchron"));
    const profiles = readInsightProfiles(db, anchors);
    const ranked = index.rankPartners(anchors);
    for (const candidate of unprepared) {
      const expected = scoreForDeck(candidate, anchors, profiles);
      if (expected.score > 0) expect(ranked.get(candidate.card.id)).toEqual(expected);
      else expect(ranked.has(candidate.card.id)).toBe(false);
    }
    expect(ranked.has(7236721)).toBe(false);
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
      const memoryBefore = process.memoryUsage();
      const coldStart = performance.now();
      const index = await initializeCubeSeedIndex(benchmark);
      console.info(`Seed preparation: ${index.preparationMs.toFixed(1)} ms`);
      console.time("previewCubeSeed real catalog");
      let preview;
      try { preview = previewCubeSeed(benchmark, { phrase: "dark magician", targetCount: 180 }, []); }
      finally { console.timeEnd("previewCubeSeed real catalog"); }
      const coldMs = performance.now() - coldStart;
      const memoryAfter = process.memoryUsage();
      expect(preview.rows).toHaveLength(180);
      const samples: number[] = [], cached: number[] = [];
      const phrases = ["dark magician", "blue eyes", "red eyes", "hand traps", "searchers", "draw cards", "spells that destroy", "revive monsters"];
      for (let n = 0; n < 40; n++) {
        const input = { phrase: phrases[n % phrases.length]!, targetCount: 180, era: { medianYear: 2000 + n / 2, spread: n % 4 } };
        const start = performance.now();
        previewCubeSeed(benchmark, input, []);
        samples.push(performance.now() - start);
        const repeated = performance.now();
        previewCubeSeed(benchmark, input, []);
        cached.push(performance.now() - repeated);
      }
      const stats = (values: number[]) => {
        values.sort((a, b) => a - b);
        return { samples: values.length, medianMs: values[Math.floor(values.length / 2)]!, p95Ms: values[Math.ceil(values.length * 0.95) - 1]! };
      };
      benchmark.prepare("UPDATE card_catalog SET cached_at=CURRENT_TIMESTAMP WHERE ygoprodeck_id=46986414").run();
      const afterCatalogStart = performance.now();
      previewCubeSeed(benchmark, { phrase: "dark magician", targetCount: 180, era: { medianYear: 2005, spread: 1 } }, []);
      const afterCatalogWriteMs = performance.now() - afterCatalogStart;
      expect(getCubeSeedIndex(benchmark)).toBe(index);
      const refreshStart = performance.now();
      const refreshed = await initializeCubeSeedIndex(benchmark);
      const catalogRefreshMs = performance.now() - refreshStart;
      expect(refreshed).not.toBe(index);
      benchmark.prepare("UPDATE card_release SET tcg_date=tcg_date WHERE passcode=46986414").run();
      const effectStart = performance.now();
      await initializeCubeSeedIndex(benchmark);
      previewCubeSeed(benchmark, { phrase: "dark magician", targetCount: 180 }, []);
      const afterEffectRevisionMs = performance.now() - effectStart;
      const report = { cards, preparationMs: index.preparationMs, coldMs, afterCatalogWriteMs, catalogRefreshMs, afterEffectRevisionMs,
        memoryBefore, memoryAfter, webRssGrowthMiB: (memoryAfter.rss - memoryBefore.rss) / 1048576, uncached: stats(samples), cached: stats(cached) };
      console.info(`SEED_BENCHMARK ${JSON.stringify(report)}`);
      const output = process.env.CUBE_SEED_BENCHMARK_OUTPUT;
      if (output) { mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`); }
      expect(report.uncached.p95Ms).toBeLessThanOrEqual(300);
    } finally { benchmark.close(); rmSync(directory, { recursive: true, force: true }); }
  }, 120_000);

  it("excludes existing identities, reports shortages and does not fill an unknown phrase with staples", () => {
    seedCatalog();
    cubes.addBatch(cubeId, [{ id: 46986414, copies: 1 }]);
    const preview = cubes.previewSeed(cubeId, { phrase: "dark magician", targetCount: 20 });
    expect(preview.rows.every(row => row.id !== 46986414)).toBe(true);
    expect(preview.rows.length).toBeLessThan(20);
    expect(preview.warnings).toContainEqual(expect.stringMatching(/Only .*20/));
    expect(cubes.previewSeed(cubeId, { phrase: "bananas", targetCount: 10 })).toMatchObject({ rows: [], warnings: expect.any(Array) });
  });

  it("reuses a bounded preview cache, isolates returned rows and excludes current cube identities", () => {
    seedCatalog();
    const index = prepareCubeSeedIndex(db);
    const rank = vi.spyOn(index, "rankPartners");
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    try {
      const input = { phrase: "dark magician", targetCount: 6, era: { medianYear: 2005, spread: 1 } };
      const first = cubes.previewSeed(cubeId, input);
      const original = structuredClone(first);
      first.rows[0]!.roles.push("mutated");
      first.warnings.push("mutated");
      expect(cubes.previewSeed(cubeId, input)).toEqual(original);
      expect(rank).toHaveBeenCalledTimes(1);
      const selected = original.rows[0]!.id;
      cubes.addBatch(cubeId, [{ id: selected, copies: 1 }]);
      expect(getCubeSeedIndex(db)).toBe(index);
      expect(cubes.previewSeed(cubeId, input).rows.every(row => row.id !== selected)).toBe(true);
      expect(rank).toHaveBeenCalledTimes(2);
      clock.mockReturnValue(1_300_001);
      cubes.previewSeed(cubeId, input);
      expect(rank).toHaveBeenCalledTimes(3);
    } finally { clock.mockRestore(); rank.mockRestore(); }
  });

  it("uses era as a soft preference, derives cube era and keeps date chips as hard filters", () => {
    seedCatalog();
    const insert = db.prepare(`INSERT INTO card_catalog(ygoprodeck_id,name,type,frame_type,archetype,image_url,image_url_small,card_sets_json,cached_at)
      VALUES(?,?,'Normal Monster','normal','Era Family','i','s','[]',CURRENT_TIMESTAMP)`);
    insert.run(901, "Early member"); insert.run(902, "Late member");
    const release = db.prepare("INSERT INTO card_release(passcode,tcg_date,quality,source_version) VALUES(?,?,'ok','fixture') ON CONFLICT(passcode) DO UPDATE SET tcg_date=excluded.tcg_date");
    release.run(901, "2005-01"); release.run(902, "2020-01");
    const input = { phrase: "Era Family", targetCount: 1 };
    expect(cubes.previewSeed(cubeId, { ...input, era: { medianYear: 2005, spread: 0 } }).rows[0]!.id).toBe(901);
    expect(cubes.previewSeed(cubeId, { ...input, era: { medianYear: 2020, spread: 0 } }).rows[0]!.id).toBe(902);
    const bounded = cubes.previewSeed(cubeId, { ...input, phrase: "Era Family before 2010", era: { medianYear: 2020, spread: 0 } });
    expect(bounded.rows.map(row => row.id)).toEqual([901]);
    cubes.addBatch(cubeId, [{ id: 901, copies: 1 }]);
    expect(cubes.previewSeed(cubeId, input)).toMatchObject({ era: { medianYear: 2005, spread: 0 }, rows: [{ id: 902 }] });
    expect(() => cubes.previewSeed(cubeId, { ...input, era: { medianYear: 1900, spread: 0 } })).toThrow(/era/);
    const before = getCubeSeedIndex(db);
    release.run(902, "2008-01");
    expect(getCubeSeedIndex(db)).not.toBe(before);
    expect(cubes.previewSeed(cubeId, { ...input, phrase: "Era Family before 2010" }).rows.map(row => row.id)).toEqual([902]);
  });

  it("refreshes public metadata across connections while retaining preparation through unrelated writes", async () => {
    const directory = mkdtempSync(join(tmpdir(), "seed-revision-")), path = join(directory, "cards.sqlite");
    await db.backup(path);
    const reader = new Database(path), writer = new Database(path);
    try {
      const first = prepareCubeSeedIndex(reader);
      writer.prepare("UPDATE cubes SET name='Changed title' WHERE id=?").run(cubeId);
      expect(getCubeSeedIndex(reader)).toBe(first);
      writer.prepare("UPDATE card_catalog SET effect_text='Changed printed text' WHERE ygoprodeck_id=1").run();
      expect(getCubeSeedIndex(reader)).toBe(first);
      const refresh = initializeCubeSeedIndex(reader);
      expect(initializeCubeSeedIndex(reader)).toBe(refresh);
      await refresh;
      const updated = getCubeSeedIndex(reader);
      expect(updated).not.toBe(first);
      expect(updated.candidates.find(candidate => candidate.card.id === 1)?.card.text).toBe("Changed printed text");
      writer.prepare("UPDATE card_release SET tcg_date='2001-01' WHERE passcode=1").run();
      writer.prepare("INSERT OR REPLACE INTO archetypes(name,synced_at) VALUES('Revision fixture',CURRENT_TIMESTAMP)").run();
      expect(await initializeCubeSeedIndex(reader)).not.toBe(updated);
    } finally { reader.close(); writer.close(); rmSync(directory, { recursive: true, force: true }); }
  });

  it("applies current artwork exclusions and deduplicates identities while serving a catalog snapshot", async () => {
    const directory = mkdtempSync(join(tmpdir(), "seed-artwork-refresh-")), path = join(directory, "cards.sqlite");
    await db.backup(path);
    const disk = new Database(path);
    try {
      const first = prepareCubeSeedIndex(disk);
      previewCubeSeed(disk, { phrase: "monsters", targetCount: 10 }, []);
      disk.prepare("INSERT INTO card_artworks(card_id,artwork_id,image_url,image_url_small,is_main) VALUES(2,1,'i','s',0) ON CONFLICT(artwork_id) DO UPDATE SET card_id=excluded.card_id").run();
      expect(getCubeSeedIndex(disk)).toBe(first);
      const excluding = previewCubeSeed(disk, { phrase: "monsters", targetCount: 10 }, [2]);
      expect(excluding.rows.map(row => row.id)).not.toContain(1);
      expect(excluding.rows.map(row => row.id)).not.toContain(2);
      const all = previewCubeSeed(disk, { phrase: "monsters", targetCount: 10 }, []);
      expect(all.rows.map(row => row.id)).not.toContain(1);
      expect(all.rows.filter(row => row.id === 2)).toHaveLength(1);
      await initializeCubeSeedIndex(disk);
    } finally { disk.close(); rmSync(directory, { recursive: true, force: true }); }
  });

  it("excludes legacy config identities stored only as uncached engine artworks", () => {
    const directory = mkdtempSync(join(tmpdir(), "seed-engine-artwork-"));
    const engine = new Database(join(directory, "cards.cdb"));
    engine.exec(`CREATE TABLE datas(id INTEGER PRIMARY KEY,alias INTEGER,type INTEGER);
      CREATE TABLE texts(id INTEGER PRIMARY KEY,name TEXT);
      INSERT INTO datas VALUES(1,0,33),(100001,1,33);
      INSERT INTO texts VALUES(1,'Card 1'),(100001,'Card 1');`);
    engine.close();
    vi.stubEnv("DUEL_DATA_DIR", directory);
    try {
      const index = prepareCubeSeedIndex(db);
      expect(index.canonical(100001)).toBe(1);
      const preview = previewCubeSeed(db, { phrase: "monsters", targetCount: 10 }, [100001]);
      expect(preview.rows.length).toBeGreaterThan(0);
      expect(preview.rows.every(row => row.id !== 1 && row.id !== 100001)).toBe(true);
      db.prepare(`INSERT INTO card_catalog(ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at)
        VALUES(100001,'Card 1','Effect Monster','effect','i','s','[]',CURRENT_TIMESTAMP)`).run();
      db.prepare("INSERT INTO card_artworks(card_id,artwork_id,image_url,image_url_small,is_main) VALUES(100001,100001,'i','s',1)").run();
      const selfArtwork = previewCubeSeed(db, { phrase: "monsters", targetCount: 10 }, [100001]);
      expect(selfArtwork.rows.every(row => row.id !== 1 && row.id !== 100001)).toBe(true);
    } finally { rmSync(directory, { recursive: true, force: true }); }
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
    expect(cubes.poolHealth(cubeId, { extraDeckEnabled: false })).toBeUndefined();
  });

  it("includes enabled Extra cards, deduplicates identities, and does not mutate stale pool labels", () => {
    vi.stubEnv("EFFECT_SEARCH", "1");
    cubes.addCard(cubeId, 1, "main", 3);
    db.prepare("INSERT INTO cube_cards(cube_id,catalog_card_id,pool,max_copies) VALUES(?,2,'main',2),(?,4,'extra',1)").run(cubeId, cubeId);
    const before = db.prepare("SELECT * FROM cube_cards").all();
    const analysis = cubes.analyzeCubePools(cubeId, { themePackSize: 1, cardsPerPlayer: 1, extraDeckSize: 0, burnUnpicked: false, extraDeckEnabled: true, includeHealth: true });
    expect(cubes.poolHealth(cubeId, { extraDeckEnabled: true })?.health?.cards).toBe(2);
    expect(analysis.poolHealth?.cards).toBe(2);
    expect(db.prepare("SELECT * FROM cube_cards").all()).toEqual(before);
  });

  it("reuses one result until the cube changes", () => {
    vi.stubEnv("EFFECT_SEARCH", "1");
    cubes.addBatch(cubeId, [{ id: 1, copies: 3 }]);
    const first = cubes.poolHealth(cubeId, { extraDeckEnabled: false });
    expect(cubes.poolHealth(cubeId, { extraDeckEnabled: false })).toBe(first);
    db.prepare("UPDATE cubes SET updated_at='2099-01-01T00:00:00.000Z' WHERE id=?").run(cubeId);
    expect(cubes.poolHealth(cubeId, { extraDeckEnabled: false })).not.toBe(first);
  });

  it("keys pool health by the explicit era and refreshes when release facts change", () => {
    vi.stubEnv("EFFECT_SEARCH", "1");
    cubes.addBatch(cubeId, [{ id: 1, copies: 3 }]);
    const input = { extraDeckEnabled: false, era: { medianYear: 2005, spread: 1 } };
    db.prepare("INSERT INTO card_release(passcode,tcg_date,quality,source_version) VALUES(1,'2020-01','ok','fixture')").run();
    const first = cubes.poolHealth(cubeId, input);
    expect(first?.health?.era).toEqual(input.era);
    expect(first?.health?.warnings).toContain("1 card is much newer than the rest of this cube.");
    expect(cubes.poolHealth(cubeId, input)).toBe(first);
    const modern = cubes.poolHealth(cubeId, { ...input, era: { medianYear: 2020, spread: 1 } });
    expect(modern?.health?.warnings.join(" ")).not.toContain("much newer");
    db.prepare("UPDATE card_release SET tcg_date='2006-01' WHERE passcode=1").run();
    const refreshed = cubes.poolHealth(cubeId, input);
    expect(refreshed).not.toBe(first);
    expect(refreshed?.health?.warnings.join(" ")).not.toContain("much newer");
  });

  it("reports null health when data cannot be read", () => {
    vi.stubEnv("EFFECT_SEARCH", "1");
    cubes.addBatch(cubeId, [{ id: 1, copies: 3 }]);
    db.prepare("INSERT INTO card_tags(passcode,summary,roles_json,tags_json,source,schema_version) VALUES(1,'','[]','broken','fixture',1)").run();
    const analysis = cubes.analyzeCubePools(cubeId, { themePackSize: 1, cardsPerPlayer: 1, extraDeckSize: 0, burnUnpicked: false, extraDeckEnabled: false, includeHealth: true });
    expect(analysis).toMatchObject({ ok: true, errors: [], poolHealth: null, warnings: [] });
    expect(cubes.poolHealth(cubeId, { extraDeckEnabled: false })).toMatchObject({ health: null, warnings: [expect.stringMatching(/health is unavailable/i)] });
  });
});
