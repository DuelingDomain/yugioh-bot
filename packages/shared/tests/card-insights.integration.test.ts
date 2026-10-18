import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../src/db/schema.js";
import { importCardEffectArtifact } from "../src/cards/effects/artifact.js";
import { createCardInsightService } from "../src/services/card-insights.js";

const db = new Database(":memory:");
const directory = mkdtempSync(join(tmpdir(), "yugioh-insight-catalog-"));
const rows: Array<[number, string, string, string, string | null, number | null, string | null]> = [
  [46986414, "Dark Magician", "Spellcaster / Normal Monster", "normal", "DARK", 7, "Dark Magician"],
  [7084129, "Magician's Rod", "Effect Monster", "effect", "DARK", 3, "Dark Magician"],
  [47222536, "Dark Magical Circle", "Spell Card", "spell", null, null, "Dark Magician"],
  [89631139, "Blue-Eyes White Dragon", "Normal Monster", "normal", "LIGHT", 8, "Blue-Eyes"],
  [71039903, "The White Stone of Ancients", "Tuner Effect Monster", "effect", "LIGHT", 1, "Blue-Eyes"],
  [97268402, "Effect Veiler", "Tuner Effect Monster", "effect", "LIGHT", 1, null],
  [14558127, "Ash Blossom & Joyous Spring", "Tuner Effect Monster", "effect", "FIRE", 3, null],
  [83764719, "Monster Reborn", "Spell Card", "spell", null, null, null],
  [44508094, "Stardust Dragon", "Synchro Effect Monster", "synchro", "WIND", 8, "Stardust"],
  [63977008, "Junk Synchron", "Tuner Effect Monster", "effect", "DARK", 3, "Junk"],
  [24094653, "Polymerization", "Spell Card", "spell", null, null, null],
  [990001, "Unknown effect monster", "Effect Monster", "effect", "WATER", 4, null],
  [990002, "Link fixture", "Link Effect Monster", "link", "DARK", 2, null],
  [990003, "Pendulum fixture", "Pendulum Effect Monster", "effect_pendulum", "DARK", 4, null],
];
let service: ReturnType<typeof createCardInsightService>;

beforeAll(() => {
  migrate(db);
  const insert = db.prepare(`INSERT INTO card_catalog
    (ygoprodeck_id,name,type,frame_type,effect_text,attribute,level,archetype,image_url,image_url_small,card_sets_json,cached_at,genesys_points,genesys_revision)
    VALUES(?,?,?,?,?,?,?,?, 'image','small','[]',CURRENT_TIMESTAMP,0,'test')`);
  for (const [code, name, type, frame, attribute, level, archetype] of rows) {
    insert.run(code, name, type, frame, `Printed text for ${name}`, attribute, level, archetype);
  }
  insert.run(7084130, "Magician's Rod", "Effect Monster", "effect", "Printed text", "DARK", 3, "Dark Magician");
  db.prepare(`INSERT INTO card_artworks(card_id,artwork_id,image_url,image_url_small,is_main) VALUES(7084129,7084130,'image','small',0)`).run();
  db.prepare(`INSERT INTO genesys_points_meta(id,revision,effective_date,source_url,synced_at) VALUES(1,'test','2026-01-01','test',CURRENT_TIMESTAMP)`).run();
  db.prepare("UPDATE card_catalog SET genesys_points=20 WHERE ygoprodeck_id=14558127").run();
  db.prepare("UPDATE card_catalog SET genesys_revision='stale' WHERE ygoprodeck_id=990001").run();
  importCardEffectArtifact(db);
  const engine = new Database(join(directory, "cards.cdb"));
  engine.exec(`CREATE TABLE datas(id INTEGER PRIMARY KEY,alias INTEGER,type INTEGER,atk INTEGER,def INTEGER,level INTEGER,race INTEGER,attribute INTEGER);
    CREATE TABLE texts(id INTEGER PRIMARY KEY,name TEXT,desc TEXT);`);
  engine.prepare("INSERT INTO datas VALUES(97268402,0,4129,0,0,1,2,16)").run();
  engine.prepare("INSERT INTO texts VALUES(97268402,'Effect Veiler','Printed effect')").run();
  engine.close();
  service = createCardInsightService(db, { dataDirectory: directory });
});

afterAll(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });

describe("SQL insights over the real pinned artifact", () => {
  it("returns a canonical summary with attribution provenance and unknown absence", () => {
    expect(service.summary(7084130)).toMatchObject({ passcode: 7084129, roles: ["searcher", "recursion"], source: expect.stringContaining("searchygo-artifact:"), textHash: expect.any(String), taggedAt: expect.any(String) });
    expect(service.summary(990001)).toBeNull();
  });

  it("reads and ranks effects using individual engine metadata, canonical pools and exact text", () => {
    expect(service.readQuery("blueeyes support")?.query.supports?.archetypes).toEqual(["Blue-Eyes"]);
    const result = service.effectSearch("cards that negate quick effects and are spellcasters", [97268402, 14558127]);
    expect(result.cards.map(card => card.passcode)).toEqual([97268402]);
    expect(result.total).toBe(1);
    expect(result.cards[0]?.reason).toContain("Spellcaster");
    expect(service.effectSearch("spellcaster monsters", [46986414]).cards.map(card => card.passcode)).toEqual([46986414]);
    expect(service.effectSearch("searchers", [7084130, 7084129]).cards.map(card => card.passcode)).toEqual([7084129]);
    expect(service.effectSearch("hand traps", []).cards).toEqual([]);
    expect(service.effectSearch("bananas").cards).toEqual([]);
    expect(service.effectSearch("Printed text for Effect Veiler", [97268402], { exact: true })).toMatchObject({ reading: null, total: 1, cards: [{ passcode: 97268402 }] });
    expect(service.effectSearch("hand traps", [97268402], { exact: true })).toMatchObject({ reading: null, total: 0, cards: [] });
  });

  it("preserves catalog level, Attribute and Type when optional engine columns are absent", () => {
    const minimalDirectory = mkdtempSync(join(directory, "minimal-"));
    const engine = new Database(join(minimalDirectory, "cards.cdb"));
    engine.exec(`CREATE TABLE datas(id INTEGER PRIMARY KEY,type INTEGER);
      CREATE TABLE texts(id INTEGER PRIMARY KEY,name TEXT);
      INSERT INTO datas VALUES(46986414,17);
      INSERT INTO texts VALUES(46986414,'Dark Magician');`);
    engine.close();
    const fallback = createCardInsightService(db, { dataDirectory: minimalDirectory });
    const result = fallback.effectSearch("level 7 DARK Spellcaster monsters", [46986414]);
    expect(result.cards.map(card => card.passcode)).toEqual([46986414]);
    expect(fallback.effectSearch("Printed text for Dark Magician", [46986414], { exact: true }).total).toBe(1);
  });

  it("finds mechanical links, prioritizes linked deck cards and annotates Domain fit", () => {
    const partners = service.worksWith(46986414, [7084130, 47222536, 71039903]);
    expect(partners.map(card => card.passcode)).toContain(7084129);
    expect(partners[0]?.reason).toContain("Dark Magician");
    expect(partners.map(card => card.passcode)).not.toContain(71039903);
    const suggestions = service.suggestForDeck({ main: [46986414], extra: [], side: [] }, { pool: [7084130, 47222536, 71039903], format: "domain", deckMaster: 46986414 });
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.every(card => card.deckMasterFit === true)).toBe(true);
    expect(service.suggestForDeck([46986414], { pool: [], format: "normal" })).toEqual([]);
    expect(service.pickScore(7084129, [46986414])).toBeGreaterThan(service.pickScore(71039903, [46986414]));
    expect(service.effectSearch("works with Dark Magician", [7084129, 71039903]).cards.map(card => card.passcode)).toEqual([7084129]);
    expect(service.effectSearch("searchers", [7084129], { format: "domain", deckMaster: 46986414 }).cards[0]?.deckMasterFit).toBe(true);
    expect(service.suggestForDeck({ main: [7084129], extra: [], side: [], deckMaster: 46986414 }, { pool: [46986414], format: "domain" })).toEqual([]);
    const single = service.suggestForDeck([46986414], { pool: [7084129, 47222536], format: "normal" });
    const duplicates = service.suggestForDeck([46986414, 46986414], { pool: [7084129, 47222536], format: "normal" });
    expect(duplicates).toEqual(single);
    expect(duplicates.every(card => card.linkedCards === 1)).toBe(true);
  });

  it("breaks equal effect scores by snapshot popularity while keeping the full total", () => {
    const find = db.prepare("SELECT popularity FROM card_tags WHERE passcode=?");
    const update = db.prepare("UPDATE card_tags SET popularity=? WHERE passcode=?");
    const ash = (find.get(14558127) as { popularity: number }).popularity;
    const veiler = (find.get(97268402) as { popularity: number }).popularity;
    try {
      update.run(10, 14558127); update.run(100, 97268402);
      const result = service.effectSearch("hand traps", [14558127, 97268402], { limit: 1 });
      expect(result.total).toBe(2);
      expect(result.cards.map(card => card.passcode)).toEqual([97268402]);
    } finally { update.run(ash, 14558127); update.run(veiler, 97268402); }
  });

  it("applies Genesys exclusions, current points and remaining budget", () => {
    const pool = [97268402, 14558127, 990001, 990002, 990003];
    expect(service.effectSearch("monsters", pool, { format: "genesys", genesysRemaining: 0 }).cards.map(card => card.passcode)).toEqual([97268402]);
    expect(service.effectSearch("monsters", pool, { format: "genesys-domain", genesysRemaining: 20 }).cards.map(card => card.passcode).sort()).toEqual([14558127, 97268402].sort());
  });

  it("reports role counts, missing tags, unlinked cards and missing Synchro supply", () => {
    const health = service.poolHealth([7084130, 7084129, 47222536, 44508094, 990001]);
    expect(health.roles).toMatchObject({ searchers: 2, extenders: 0, removal: 1, handTraps: 0 });
    expect(health.extraDeck).toMatchObject({ synchro: 1, tuners: 0, nonTuners: 2, fusion: 0, xyz: 0, link: 0 });
    expect(health.untaggedPasscodes).toEqual([990001]);
    expect(health.unlinkedPasscodes).toContain(990001);
    expect(health.warnings.join(" ")).toContain("Tuner");
    expect(service.poolHealth([])).toMatchObject({ cards: 0, untaggedPasscodes: [], unlinkedPasscodes: [], warnings: [] });
  });
});
