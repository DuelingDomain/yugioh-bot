import Database from "better-sqlite3";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { migrate } from "../src/db/schema.js";
import { importCardEffectArtifact } from "../src/cards/effects/artifact.js";
import { createCardInsightService } from "../src/services/card-insights.js";
import { createInsightCatalog } from "../src/services/card-insight-catalog.js";

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
  [4474060, "SPYRAL GEAR - Drone", "Machine / Effect Monster", "effect", "WIND", 1, "SPYRAL"],
  [27096833, "Borreload Liberator Dragon", "Dragon / Effect Monster", "effect", "DARK", 8, null],
  [483, "Parallel Teleport", "Spell Card", "spell", null, null, null],
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
  engine.exec(`CREATE TABLE datas(id INTEGER PRIMARY KEY,alias INTEGER,type INTEGER,atk INTEGER,def INTEGER,level INTEGER,race INTEGER,attribute INTEGER,setcode INTEGER DEFAULT 0);
    CREATE TABLE texts(id INTEGER PRIMARY KEY,name TEXT,desc TEXT);`);
  const engineData = engine.prepare("INSERT INTO datas(id,alias,type,atk,def,level,race,attribute,setcode) VALUES(?,?,?,?,?,?,?,?,?)");
  engineData.run(97268402, 0, 4129, 0, 0, 1, 2, 16, 0);
  engine.prepare("INSERT INTO texts VALUES(97268402,'Effect Veiler','Printed effect')").run();
  engineData.run(46986414, 0, 17, 2500, 2100, 7, 2, 32, 0x123);
  engine.prepare("INSERT INTO texts VALUES(46986414,'Dark Magician','The ultimate wizard.')").run();
  for (const id of [7084129, 7084131]) {
    engineData.run(id, id === 7084131 ? 7084129 : 0, 33, 1600, 100, 3, 2, 32, 0x123);
    engine.prepare("INSERT INTO texts VALUES(?,'Magician''s Rod','Add a card that mentions \"Dark Magician\".')").run(id);
  }
  for (const id of [990010, 990011, 990012]) {
    engineData.run(id, 0, 17, 1000, 1000, 4, 2, 32, id === 990011 ? 0x1240123 : id === 990012 ? 0x124 : 0x123);
    engine.prepare("INSERT INTO texts VALUES(?,?,'Normal Monster text')").run(id, `Engine-only archetype monster ${id}`);
  }
  engine.close();
  writeFileSync(join(directory, "strings.conf"), "!setname 0x123 Dark Magician\n!setname 0x124 Second setcode\n");
  service = createCardInsightService(db, { dataDirectory: directory });
});

afterAll(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });

describe("SQL insights over the real pinned artifact", () => {
  it("preserves cached alias metadata when the canonical engine card has no display row", () => {
    const aliases = new Database(join(directory, "alias-cache.sqlite"));
    migrate(aliases);
    aliases.prepare(`INSERT INTO card_catalog
      (ygoprodeck_id,name,type,frame_type,effect_text,attribute,level,archetype,image_url,image_url_small,card_sets_json,cached_at,genesys_points,genesys_revision)
      VALUES(7084131,'Magician''s Rod','Spellcaster / Effect Monster','effect','Cached alias printed text','DARK',3,'Dark Magician','image','small','[]',CURRENT_TIMESTAMP,7,'test')`).run();
    aliases.prepare("INSERT INTO genesys_points_meta(id,revision,effective_date,source_url,synced_at) VALUES(1,'test','2026-01-01','test',CURRENT_TIMESTAMP)").run();
    const tagged = db.prepare("SELECT tags_json FROM card_tags WHERE passcode=7084129").get() as { tags_json: string };
    aliases.prepare("INSERT INTO card_tags(passcode,summary,roles_json,tags_json,popularity,source,schema_version) VALUES(7084129,'','[]',?,99,'integration',1)").run(tagged.tags_json);
    aliases.prepare("INSERT INTO card_release(passcode,tcg_date,ocg_date,quality,source_version) VALUES(7084129,'2020-01','2019-12','ok','integration')").run();
    const catalog = createInsightCatalog(aliases, directory);
    try {
      const original = [...catalog.candidates()][0]!;
      expect(original.card).toMatchObject({ id: 7084129, text: "Cached alias printed text", genesysPoints: 7, views: 99, tcgDate: "2020-01", ocgDate: "2019-12" });
      expect([...catalog.suggestionCandidates()].find(candidate => candidate.card.id === 7084129)).toEqual(original);
      expect(aliases.prepare("SELECT 1 FROM card_catalog WHERE ygoprodeck_id=7084129").get()).toBeUndefined();
    } finally { catalog.close(); aliases.close(); }
  });

  it("uses one read snapshot for file-backed streaming and sees uncommitted transaction changes", async () => {
    const path = join(directory, "snapshot-cache.sqlite");
    await db.backup(path);
    const application = new Database(path);
    application.pragma("journal_mode=WAL");
    const reader = createInsightCatalog(application, directory);
    const original = createInsightCatalog(db, directory);
    try {
      expect([...reader.suggestionCandidates()]).toEqual([...original.suggestionCandidates()]);
      const stream = reader.suggestionCandidates();
      const first = stream.next();
      expect(first.done).toBe(false);
      application.prepare("UPDATE card_catalog SET name='Committed snapshot update' WHERE ygoprodeck_id=7084129").run();
      const heldSnapshot = [first.value!, ...stream];
      expect(heldSnapshot.find(candidate => candidate.card.id === 7084129)?.card.name).toBe("Magician's Rod");
      expect([...reader.suggestionCandidates()].find(candidate => candidate.card.id === 7084129)?.card.name).toBe("Committed snapshot update");
      application.exec("BEGIN");
      try {
        application.prepare("UPDATE card_catalog SET name='Uncommitted update' WHERE ygoprodeck_id=7084129").run();
        application.prepare("UPDATE card_tags SET popularity=777 WHERE passcode=7084129").run();
        const uncommitted = [...reader.suggestionCandidates()].find(candidate => candidate.card.id === 7084129)!;
        expect(uncommitted.card).toMatchObject({ name: "Uncommitted update", views: 777 });
      } finally { application.exec("ROLLBACK"); }
      const partial = reader.suggestionCandidates();
      expect(partial.next().done).toBe(false);
      partial.return(undefined);
      expect([...reader.suggestionCandidates()].find(candidate => candidate.card.id === 7084129)?.card.name).toBe("Committed snapshot update");
    } finally { reader.close(); original.close(); application.close(); }
  });

  it("streams identical catalog metadata with cached artworks and release-only engine records", () => {
    db.prepare("INSERT INTO card_release(passcode,tcg_date,ocg_date,quality,source_version) VALUES(990010,'2020-01','2019-12','ok','integration')").run();
    const catalog = createInsightCatalog(db, directory);
    try {
      const expected = new Map([...catalog.candidates()].map(candidate => [candidate.card.id, candidate]));
      for (const code of [97268402, 46986414, 7084129, 7084131, 990010, 990011, 990012]) {
        const candidate = catalog.candidate(code)!;
        if (!expected.has(candidate.card.id)) expected.set(candidate.card.id, candidate);
      }
      const order = (candidates: Iterable<{ card: { id: number } }>) => [...candidates].sort((a, b) => a.card.id - b.card.id);
      expect(order(catalog.suggestionCandidates())).toEqual(order(expected.values()));
      expect(catalog.suggestionCount()).toBe(expected.size);
      expect([...catalog.suggestionCandidates([7084131, 7084129, 990011])]).toEqual([...catalog.candidates([7084131, 7084129, 990011])]);
      expect(catalog.candidate(990010)?.card).toMatchObject({ tcgDate: "2020-01", ocgDate: "2019-12", archetype: "Dark Magician" });
      expect(catalog.candidate(990011)?.card.archetypes).toEqual(["Dark Magician", "Second setcode"]);
      const partial = catalog.suggestionCandidates();
      expect(partial.next().done).toBe(false);
      partial.return(undefined);
      expect(order(catalog.suggestionCandidates())).toEqual(order(expected.values()));
    } finally {
      catalog.close();
      db.prepare("DELETE FROM card_release WHERE passcode=990010").run();
    }
  });

  it("returns four exclusive suggestion rows, a complete-deck hint and server copy/pool limits", () => {
    const legality = { allowed: rows.map(row => row[0]), limits: { 83764719: 0 }, version: "integration-1" };
    const deck = { main: [89631139, 89631139, 89631139, 71039903], extra: [], side: [] };
    const result = service.suggestRows(deck, { format: "normal", legality });
    expect(result.rows.map(row => row.id)).toEqual(["archetype", "outside", "extra", "staples"]);
    expect(result.rows[2]).toMatchObject({ cards: [], state: "hint", minimumMainCards: 40, mainCards: 4 });
    const cards = result.rows.flatMap(row => row.cards);
    expect(new Set(cards.map(card => card.passcode)).size).toBe(cards.length);
    expect(cards.every(card => card.reason.length > 0 && !/[\r\n]/.test(card.reason))).toBe(true);
    expect(cards.map(card => card.passcode)).not.toContain(83764719);
    expect(cards.map(card => card.passcode)).not.toContain(89631139);
    expect(result.rows[3]!.cards.length).toBeLessThanOrEqual(6);
    expect(service.suggestRows(deck, { format: "normal", legality, pool: [] }).rows.every(row => !row.cards.length)).toBe(true);
    expect(service.suggestRows(deck, { format: "normal" }).rows.every(row => !row.cards.length)).toBe(true);
  });

  it("invalidates cached rows on catalog changes and applies canonical exclusions across service instances", () => {
    const legality = { allowed: rows.map(row => row[0]), limits: {}, version: "integration-cache" };
    const deck = { main: [46986414], extra: [], side: [] };
    const first = service.suggestRows(deck, { format: "normal", legality });
    const second = createCardInsightService(db, { dataDirectory: directory }).suggestRows(deck, { format: "normal", legality });
    expect(second).toEqual(first);
    db.prepare("UPDATE card_catalog SET name='Updated Magician Rod' WHERE ygoprodeck_id=7084129").run();
    try {
      const refreshed = service.suggestRows(deck, { format: "normal", legality });
      expect(refreshed.version).not.toBe(first.version);
      expect(refreshed.rows.flatMap(row => row.cards).find(card => card.passcode === 7084129)?.name).toBe("Updated Magician Rod");
    } finally { db.prepare("UPDATE card_catalog SET name=? WHERE ygoprodeck_id=7084129").run("Magician's Rod"); }
    const limited = service.suggestRows(deck, { format: "normal", legality, exclude: [7084130] });
    expect(limited.rows.flatMap(row => row.cards).map(card => card.passcode)).not.toContain(7084129);
    const held = service.suggestRows({ ...deck, side: [7084130] }, { format: "normal", legality });
    expect(held.rows.flatMap(row => row.cards).map(card => card.passcode)).not.toContain(7084129);
  });

  it("suggests admitted engine cards before the lazy display cache has a row", () => {
    const result = service.suggestRows({ main: [46986414], extra: [], side: [] }, {
      format: "normal", legality: { allowed: [990010], limits: {}, version: "engine-only" },
    });
    expect(result.rows[0]!.cards.map(card => card.passcode)).toEqual([990010]);
    expect(db.prepare("SELECT 1 FROM card_catalog WHERE ygoprodeck_id=990010").get()).toBeUndefined();
    const secondary = service.suggestRows({ main: [990011, 990011], extra: [], side: [] }, {
      format: "normal", legality: { allowed: [990012], limits: {}, version: "secondary-setcode" },
    });
    expect(secondary.rows[0]!.cards.map(card => card.passcode)).toEqual([990012]);
  });

  it("batches pack fit scores and reasons without changing the pickScore contract", () => {
    const codes = [7084129, 7084130, 46986414, 990001];
    const pool = [46986414];
    const batch = service.pickScores(codes, pool);
    expect(batch.map(card => card.score)).toEqual(codes.map(code => service.pickScore(code, pool)));
    expect(batch[0]?.reason).toMatch(/Dark Magician/);
    expect(batch[1]?.score).toBe(batch[0]?.score);
    expect(batch[2]).toEqual({ passcode: 46986414, score: 0 });
    expect(batch[3]).toEqual({ passcode: 990001, score: 0 });
  });

  it("returns a canonical summary with attribution provenance and unknown absence", () => {
    expect(service.summary(7084130)).toMatchObject({ passcode: 7084129, roles: ["searcher", "recursion"], source: expect.stringContaining("searchygo-artifact:"), textHash: expect.any(String), taggedAt: expect.any(String) });
    expect(service.summary(990001)).toBeNull();
  });

  it("reads and ranks effects using individual engine metadata, canonical pools and exact text", () => {
    expect(service.readQuery("blueeyes support")?.query.supports?.archetypes).toEqual(["Blue-Eyes"]);
    const result = service.effectSearch("cards that negate quick effects and are spellcasters", [97268402, 14558127]);
    expect(result.cards.map(card => card.passcode)).toEqual([97268402]);
    expect(result.total).toBe(1);
    expect(result.cards[0]?.release).toEqual({ tcgDate: "2010-08", ocgDate: "2010-04", date: "2010-08", region: "tcg", upcoming: false });
    expect(result.cards[0]?.reason).toBe("Negates the effects of a face-up Effect monster this turn");
    expect(service.effectSearch("hand traps that negate", [97268402, 14558127]).cards.map(card => card.reason).sort()).toEqual([
      "Negates an effect that adds a card from the Deck to the hand",
      "Negates the effects of a face-up Effect monster this turn",
    ]);
    expect(service.effectSearch("spellcaster monsters", [46986414]).cards.map(card => card.passcode)).toEqual([46986414]);
    expect(service.effectSearch("searchers", [7084130, 7084129]).cards.map(card => card.passcode)).toEqual([7084129]);
    expect(service.effectSearch("hand traps", []).cards).toEqual([]);
    expect(service.effectSearch("bananas").cards).toEqual([]);
    expect(service.effectSearch("Printed text for Effect Veiler", [97268402], { exact: true })).toMatchObject({ reading: null, total: 1, cards: [{ passcode: 97268402 }] });
    expect(service.effectSearch("hand traps", [97268402], { exact: true })).toMatchObject({ reading: null, total: 0, cards: [] });
  });

  it("adds the How it plays profile to an archetype reading and searches one of its hooks", () => {
    const guide = service.effectSearch("blueeyes support", [89631139, 71039903, 97268402]).guide;
    expect(guide).toMatchObject({ archetype: "Blue-Eyes", plan: expect.any(String), hooks: expect.any(Array) });
    expect(guide?.plan.length).toBeGreaterThan(20);
    expect(guide?.hooks.length).toBeGreaterThan(0);
    expect(JSON.stringify(guide)).not.toMatch(/\bAI\b/);
    expect(service.effectSearch("hand traps", [97268402]).guide).toBeUndefined();
    expect(service.effectSearch("Printed text for Effect Veiler", [97268402], { exact: true }).guide).toBeUndefined();
    const hook = guide!.hooks.findIndex(item => item.searchable);
    expect(hook).toBeGreaterThanOrEqual(0);
    const cards = service.hookSearch("Blue-Eyes", hook, [89631139, 71039903, 97268402, 14558127]);
    // A card of the archetype itself is never a hook match.
    expect(cards.map(card => card.passcode)).not.toContain(89631139);
    expect(cards.every(card => card.reason === guide!.hooks[hook]!.label)).toBe(true);
    expect(service.hookSearch("Blue-Eyes", 99)).toEqual([]);
    expect(service.hookSearch("No Such Archetype", 0)).toEqual([]);
    expect(service.hookSearch("Blue-Eyes", hook, [])).toEqual([]);
  });

  it("filters release readings and sorts newest cards through the SQL catalog", () => {
    expect(service.effectSearch("hand traps before 2015", [97268402, 14558127])).toMatchObject({
      total: 1, cards: [{ passcode: 97268402 }], reading: { chips: expect.arrayContaining(["Released: before 2015"]) },
    });
    expect(service.effectSearch("newest spells", [83764719, 47222536]).cards.map(card => card.passcode)).toEqual([47222536, 83764719]);
    expect(service.effectSearch("hand traps", [97268402, 14558127], { released: { to: "2014-12" } }).cards.map(card => card.passcode)).toEqual([97268402]);
    expect(service.effectSearch("hand traps before 2015", [97268402, 14558127], { omittedChips: ["Released: before 2015"] }).total).toBe(2);
    expect(service.effectSearch("hand traps", [97268402, 14558127], { sort: "newest", limit: 1 })).toMatchObject({ total: 2, cards: [{ passcode: 14558127 }] });
    expect(service.effectSearch("monsters", [97268402, 14558127], { released: { to: "2014-12" }, format: "genesys", genesysRemaining: 0 }).cards.map(card => card.passcode)).toEqual([97268402]);
    expect(service.effectSearch("Printed text", [97268402, 14558127], { exact: true, released: { to: "2014-12" } }).cards.map(card => card.passcode)).toEqual([97268402]);
  });

  it("orders new cards and newest spells by month, score, then popularity", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-20T00:00:00Z"));
    db.exec("SAVEPOINT release_order");
    try {
      const pool = [83764719, 47222536, 24094653];
      for (const id of pool) db.prepare("UPDATE card_release SET tcg_date='2026-09' WHERE passcode=?").run(id);
      db.prepare("UPDATE card_release SET tcg_date='2026-10' WHERE passcode=24094653").run();
      db.prepare("UPDATE card_tags SET popularity=CASE passcode WHEN 83764719 THEN 1 WHEN 47222536 THEN 999999 ELSE 0 END WHERE passcode IN (83764719,47222536,24094653)").run();
      db.prepare("UPDATE card_catalog SET effect_text=effect_text || ' blorptastic' WHERE ygoprodeck_id=83764719").run();
      for (const text of ["new cards", "newest spells", "newest spells blorptastic"]) {
        const hits = service.effectSearch(text, pool).cards;
        expect(hits).toHaveLength(3);
        expect(hits[0].passcode).toBe(24094653); // date before score and popularity
        for (let i = 1; i < hits.length; i++) {
          const a = hits[i - 1], b = hits[i];
          const popularity = (id: number) => id === 47222536 ? 999999 : id === 83764719 ? 1 : 0;
          expect((b.release!.date!.localeCompare(a.release!.date!)) || b.score - a.score || popularity(b.passcode) - popularity(a.passcode)).toBeLessThanOrEqual(0);
        }
      }
      expect(service.effectSearch("newest spells", pool).cards.map(card => card.passcode)).toEqual([24094653, 47222536, 83764719]);
      const scored = service.effectSearch("newest spells blorptastic", pool).cards;
      expect(scored[1].passcode).toBe(83764719);
      expect(scored[1].score).toBeGreaterThan(scored[2].score);
    } finally { db.exec("ROLLBACK TO release_order; RELEASE release_order"); vi.useRealTimers(); }
  });

  it("uses regional dates for newest and keeps upcoming and OCG-only releases", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-17T00:00:00Z"));
    try {
      const pool = [4474060, 14558127];
      expect(service.effectSearch("newest monsters", pool).cards[0]?.passcode).toBe(14558127);
      const ocg = service.effectSearch("newest OCG monsters", pool);
      expect(ocg.cards[0]).toMatchObject({ passcode: 4474060, release: { date: "2017-09", region: "ocg" } });
      expect(service.effectSearch("spells before 2026", [483]).cards).toMatchObject([{ passcode: 483, release: { date: "2025-04", region: "ocg" } }]);
      expect(service.effectSearch("spells TCG before 2026", [483]).cards).toEqual([]);
      expect(service.effectSearch("newest monsters", [27096833]).cards[0]?.release).toMatchObject({ date: "2026-11", upcoming: true });
      expect(service.effectSearch("last 3 months", [97268402, 27096833]).total).toBe(0);
      expect(service.effectSearch("new cards", [97268402, 27096833]).total).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it("uses a soft cube era preference and reports much newer cards", () => {
    const pool = [7084129, 47222536];
    const plain = service.worksWith(46986414, pool);
    const era = { medianYear: 2016, spread: 2 };
    const preferred = service.worksWith(46986414, pool, { era });
    expect(preferred.map(card => card.passcode).sort()).toEqual(plain.map(card => card.passcode).sort());
    expect(preferred[0]!.score).toBeGreaterThan(plain.find(card => card.passcode === preferred[0]!.passcode)!.score);
    expect(service.effectSearch("Dark Magician support", pool, { era, released: { to: "2005-12" } }).cards).toEqual([]);
    const cube = [46986414, 89631139, 83764719, 24094653, 97268402, 7084129, 47222536];
    const health = service.poolHealth(cube);
    expect(health.era).toMatchObject({ medianYear: 2002, spread: 0 });
    expect(health.warnings).toContain("3 cards are much newer than the rest of this cube.");
    expect(service.poolHealth(cube, { era: { medianYear: 2002, spread: 1 } }).warnings).toContain("3 cards are much newer than the rest of this cube.");
    const seed = service.effectSearch("spell cards", [83764719, 47222536], { era: { medianYear: 2002, spread: 1 } });
    expect(seed.cards[0]?.passcode).toBe(83764719);
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
    const minimalCatalog = new Database(":memory:");
    try {
      migrate(minimalCatalog);
      const uncached = createCardInsightService(minimalCatalog, { dataDirectory: minimalDirectory });
      expect(uncached.effectSearch("normal monsters", [46986414]).cards.map(card => card.passcode)).toEqual([46986414]);
      expect(uncached.effectSearch("level 4 or lower normal monsters", [46986414]).cards).toEqual([]);
    } finally { minimalCatalog.close(); }
  });

  it("uses uncached engine cards in explicit pools and anchors without expanding the default cached universe", () => {
    const emptyCatalog = new Database(":memory:");
    try {
      migrate(emptyCatalog);
      importCardEffectArtifact(emptyCatalog);
      const engineOnly = createCardInsightService(emptyCatalog, { dataDirectory: directory });
      expect(engineOnly.worksWith(46986414, [7084129]).map(card => card.passcode)).toEqual([7084129]);
      expect(engineOnly.worksWith(7084129, [46986414]).map(card => card.passcode)).toEqual([46986414]);
      expect(engineOnly.suggestForDeck([46986414], { pool: [7084129, 7084131], format: "normal" }).map(card => card.passcode)).toEqual([7084129]);
      expect(engineOnly.effectSearch("searchers", [7084129, 7084131])).toMatchObject({ total: 1, cards: [{ passcode: 7084129 }] });
      expect(engineOnly.effectSearch('mentions "Dark Magician"', [7084129], { exact: true }).total).toBe(1);
      expect(engineOnly.summary(7084131)).toMatchObject({ passcode: 7084129, roles: ["searcher", "recursion"], source: expect.stringContaining("searchygo-artifact:"), textHash: expect.stringMatching(/^[a-f0-9]{64}$/) });
      expect(engineOnly.summary(7084131)?.textHash).toBe(engineOnly.summary(7084129)?.textHash);
      expect(engineOnly.effectSearch("searchers").cards).toEqual([]);
      expect(engineOnly.effectSearch("searchers", []).cards).toEqual([]);
      expect(engineOnly.effectSearch("searchers", [7084129], { format: "genesys", genesysRemaining: 1000 }).cards).toEqual([]);
      expect(engineOnly.suggestForDeck([46986414], { pool: [7084129], format: "genesys-domain" })).toEqual([]);
      expect(engineOnly.worksWith(46986414, [7084129], { format: "genesys" })).toEqual([]);
      expect(engineOnly.worksWith(990010, [990011])[0]?.reason).toBe("Shares Dark Magician");
      expect(emptyCatalog.prepare("SELECT COUNT(*) AS count FROM card_catalog").get()).toEqual({ count: 0 });
    } finally { emptyCatalog.close(); }
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
    const fits = service.packFits([7084129, 71039903, 46986414], [46986414]);
    expect(fits.get(7084129)).toContain("Dark Magician");
    // A pack can also help by supplying a missing role, through the same policy as bots.
    expect(fits.get(71039903)).toBe("Adds searcher and extender to your pool");
    expect(service.pickScore(71039903, [46986414])).toBeGreaterThan(0);
    expect(fits.has(46986414)).toBe(false);
    expect(service.packFits([7084129], []).size).toBe(0);
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


it('honors a cached hard reading before the legacy works-with anchor shortcut', async () => {
  const { interpret } = await import('../src/cards/effects/query.js');
  const reading = interpret('hand traps that negate')!;
  const phrase = 'works with Dark Magician';
  db.prepare("INSERT INTO effect_readings VALUES(?,'done',?,0)").run(phrase.toLowerCase(), JSON.stringify(reading.query));
  const service = createCardInsightService(db, { dataDirectory: directory });
  expect(service.readQuery(phrase)).toEqual(reading);
  expect(service.effectSearch(phrase, [7084129,97268402]).cards.map(card => card.passcode)).toEqual([97268402]);
});
