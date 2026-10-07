import Database from "better-sqlite3";
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { migrate } from "../../src/db/schema.js";
import { createCardCatalogService } from "../../src/services/card-catalog.js";
import { readEngineCardInfo } from "../../src/services/engine-card-info.js";

const fixture = JSON.parse(readFileSync(new URL("../../../duel-server/tests/support/fixtures/red-eyes-exceed-cards.json", import.meta.url), "utf8")) as {
  datas: number[][]; texts: Array<[number, string, string, ...string[]]>;
};
const roots: string[] = [];
const databases: Database.Database[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const db of databases.splice(0)) db.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function directory() {
  const root = mkdtempSync(join(tmpdir(), "engine-card-info-")); roots.push(root); return root;
}

function bundle(root = directory(), file = "cards.cdb") {
  const db = new Database(join(root, file));
  db.exec(`create table datas (id integer primary key, ot integer, alias integer, setcode integer, type integer,
    atk integer, def integer, level integer, race integer, attribute integer, category integer);
    create table texts (id integer primary key, name text, desc text);`);
  const data = db.prepare("insert into datas values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  const text = db.prepare("insert into texts values (?, ?, ?)");
  for (const row of fixture.datas) data.run(...row);
  for (const row of fixture.texts) text.run(...row.slice(0, 3));
  db.close(); return root;
}

describe("prepared engine card metadata", () => {
  it("returns the complete release-betb names and multiline text without a catalog row or network", () => {
    const root = bundle();
    vi.stubEnv("DUEL_DATA_DIR", root);
    const db = new Database(":memory:"); databases.push(db); migrate(db);
    const fetch = vi.fn().mockRejectedValue(new Error("YGOPRODeck offline"));
    const catalog = createCardCatalogService(db, { fetch, identityCatalog: new Map() });
    const result = readEngineCardInfo([17242022, 40235813], root, catalog)!;
    expect(result.missing).toEqual([]);
    for (const [code, name, description] of fixture.texts) {
      expect(result.cards.find(card => card.code === code)).toMatchObject({ code, name, description, ot: 1 });
    }
    expect(result.cards[0]).toMatchObject({ type: 97, attack: 3400, defense: 3000, level: 9, race: "Dragon", attribute: 32 });
    expect(fetch).not.toHaveBeenCalled();
    expect(db.prepare("select count(*) as n from card_catalog").get()).toEqual({ n: 0 });
  });

  it("prefers cached catalog text, falling back separately for blank or placeholder fields", () => {
    const root = bundle();
    vi.stubEnv("DUEL_DATA_DIR", root);
    const db = new Database(":memory:"); databases.push(db); migrate(db);
    const insert = db.prepare(`insert into card_catalog
      (ygoprodeck_id, name, type, frame_type, effect_text, image_url, image_url_small, card_sets_json, cached_at)
      values (?, ?, 'Spell Card', 'spell', ?, '', '', '[]', 'now')`);
    insert.run(17242022, "Catalog name", "Catalog full text");
    insert.run(40235813, "Card 40235813", "  ");
    const catalog = createCardCatalogService(db, { identityCatalog: new Map() });
    const result = readEngineCardInfo([17242022, 40235813], root, catalog)!;
    expect(result.cards[0]).toMatchObject({ name: "Catalog name", description: "Catalog full text", type: 97 });
    expect(result.cards[1]).toMatchObject({ name: fixture.texts[1][1], description: fixture.texts[1][2] });
  });

  it("deduplicates passcodes and reports genuinely unknown cards", () => {
    const result = readEngineCardInfo([17242022, 99999999, 17242022, 99999999], bundle())!;
    expect(result.cards.map(card => card.code)).toEqual([17242022]);
    expect(result.missing).toEqual([99999999]);
  });

  it("does not create or cache a missing bundle", () => {
    const root = directory();
    expect(readEngineCardInfo([17242022], root)).toBeNull();
    expect(existsSync(join(root, "cards.cdb"))).toBe(false);
    bundle(root);
    expect(readEngineCardInfo([17242022], root)?.cards[0].name).toBe(fixture.texts[0][1]);
  });

  it("reloads card text after an atomic prepared-bundle replacement", () => {
    const root = bundle();
    expect(readEngineCardInfo([17242022], root)?.cards[0].description).toBe(fixture.texts[0][2]);
    bundle(root, "replacement.cdb");
    const replacement = new Database(join(root, "replacement.cdb"));
    replacement.prepare("update texts set desc = ? where id = ?").run("Updated full text\nSecond paragraph.", 17242022);
    replacement.close();
    renameSync(join(root, "replacement.cdb"), join(root, "cards.cdb"));
    expect(readEngineCardInfo([17242022], root)?.cards[0].description).toBe("Updated full text\nSecond paragraph.");
  });

  it("preserves 64-bit setcodes, packed scales, Link arrows and artwork identity", () => {
    const root = bundle();
    const db = new Database(join(root, "cards.cdb"));
    db.exec(`insert into datas values (10,3,0,0x123456789abcdef0,0x4000001,2000,0x101,0x05060003,0x1000000,0x10,0),
      (11,3,10,0x123456789abcdef0,0x4000001,2000,0x101,0x05060003,0x1000000,0x10,0);
      insert into texts values (10,'Link','Full text'), (11,'Link','Full text');`);
    db.close();
    expect(readEngineCardInfo([11], root)?.cards[0]).toMatchObject({
      code: 11, canonicalPasscode: 10, alias: 10, altArtCount: 1, setcodes: [0xdef0, 0x9abc, 0x5678, 0x1234],
      level: 3, lscale: 5, rscale: 6, defense: 0, arrows: 0x101, race: "Cyberse",
    });
  });
});
