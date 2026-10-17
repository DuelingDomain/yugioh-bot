import { useRecordingObservability } from "../helpers/recording-observability.mjs";
import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "../../src/db/index.js";
import { assertExtraDeckCards } from "../../src/duels/extra-deck.js";
import { canonicalCardCode } from "../../src/duels/pool.js";
import { loadArtworkIdentityCatalog } from "../../src/services/card-artworks.js";
import { createDeckTypeLookup } from "../../src/services/deck-sections.js";
import { createSavedDeckService } from "../../src/services/saved-decks.js";

const recording = useRecordingObservability();
let directory: string;
let db: Database.Database;
let engineDirectory: string;
const MAGIA = 12381100;
const FAIRY = 43321985;
const PRE_RELEASE = 100459004;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "deck-type-lookup-"));
  const data = join(directory, "data");
  engineDirectory = join(data, "duel-engine");
  mkdirSync(engineDirectory, { recursive: true });
  db = new Database(join(data, "bot.sqlite"));
  migrate(db);
  db.prepare("insert into users(id,username,display_name) values (1,'owner','Owner')").run();
  const engine = new Database(join(engineDirectory, "cards.cdb"));
  engine.exec("create table datas(id integer primary key, alias integer, type integer); create table texts(id integer primary key, name text);");
  for (const [id, alias, type, name] of [
    [MAGIA, 0, 97, "Dragon Master Magia"], [FAIRY, 0, 8225, "Ancient Fairy Life Dragon"],
    [1546123, 0, 97, "Cyber End Dragon"], [1546124, 1546123, 97, "Cyber End Dragon"],
    [PRE_RELEASE, 0, 97, "Blue-Eyes Ultimate Dragon, the God-Surpassing Servant"],
    [55144522, 0, 2, "Pot of Greed"],
  ] as const) {
    engine.prepare("insert into datas values (?,?,?)").run(id, alias, type);
    engine.prepare("insert into texts values (?,?)").run(id, name);
  }
  engine.close();
  // npm workspace / Next dev can start with a package directory as cwd.
  vi.spyOn(process, "cwd").mockReturnValue(join(directory, "packages", "web"));
  vi.stubEnv("DATABASE_PATH", db.name);
  vi.stubEnv("DUEL_DATA_DIR", undefined);
});
afterEach(() => {
  vi.restoreAllMocks(); vi.unstubAllEnvs(); db.close();
  rmSync(directory, { recursive: true, force: true });
});

describe("deck type lookup uses the engine bundle outside the repository cwd", () => {
  it("reports once and keeps imports available when remaps are missing or invalid, then recovers", () => {
    const bytes = JSON.stringify({ version: 1, remaps: { 100000001: MAGIA } });
    writeFileSync(join(engineDirectory, "manifest.json"), JSON.stringify({
      sources: { databaseFormat: "official-releases-prerelease-v4" },
      integrity: { cardRemaps: createHash("sha256").update(bytes).digest("hex") },
    }));
    const errors: unknown[] = [];
    recording.report.mockImplementation(error => { errors.push(error); });
    const find = createDeckTypeLookup(db);
    expect(find(MAGIA)?.type).toBe(97);
    expect(find.snapshot()(100000001)).toBeUndefined();
    writeFileSync(join(engineDirectory, "card-remaps.json"), "{}");
    expect(createDeckTypeLookup(db).snapshot()(MAGIA)?.type).toBe(97);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(Error);
    writeFileSync(join(engineDirectory, "card-remaps.json"), bytes);
    expect(find.snapshot()(100000001)?.type).toBe(97);
  });
  it("saves Magia and Ancient Fairy Life Dragon with no catalog rows", () => {
    const decks = createSavedDeckService(db);
    const saved = decks.create("g", 1, { name: "Domain", mode: "domain", deck: { main: [], extra: [MAGIA], side: [] } });
    expect(decks.update(saved.id, "g", 1, { ...saved, deck: { ...saved.deck, extra: [MAGIA, FAIRY] } }).deck.extra)
      .toEqual([MAGIA, FAIRY]);
    expect(db.prepare("select count(*) as n from card_catalog").get()).toEqual({ n: 0 });
  });
  it("keeps an engine alternate artwork and resolves its base identity", () => {
    const cards = loadArtworkIdentityCatalog();
    expect(canonicalCardCode(1546124, cards)).toBe(1546123);
    expect(() => assertExtraDeckCards({ extra: [1546124] }, createDeckTypeLookup(db).snapshot())).not.toThrow();
  });
  it("accepts a retained pre-release Fusion from the merged engine database", () => {
    expect(() => assertExtraDeckCards({ extra: [PRE_RELEASE] }, createDeckTypeLookup(db).snapshot())).not.toThrow();
  });
  it("uses the engine base type for a catalog artwork with a stale catalog type", () => {
    db.prepare("insert into card_catalog(ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at) values (?, 'Dragon Master Magia', '', 'fusion', '', '', '[]', 'test')").run(MAGIA);
    db.exec("insert into card_catalog(ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at) values (999, 'Dragon Master Magia', '', 'fusion', '', '', '[]', 'test')");
    db.prepare("insert into card_artworks(card_id,artwork_id,image_url,image_url_small,is_main) values (?,999,'','',0)").run(MAGIA);
    vi.stubEnv("DUEL_DATA_DIR", engineDirectory);
    expect(() => assertExtraDeckCards({ extra: [999] }, createDeckTypeLookup(db).snapshot())).not.toThrow();
  });
  it("resolves an approved old pre-release passcode through the bundle remaps", () => {
    const bytes = JSON.stringify({ version: 1, remaps: { 100000001: MAGIA } });
    writeFileSync(join(engineDirectory, "card-remaps.json"), bytes);
    writeFileSync(join(engineDirectory, "manifest.json"), JSON.stringify({
      sources: { databaseFormat: "official-releases-prerelease-v4" },
      integrity: { cardRemaps: createHash("sha256").update(bytes).digest("hex") },
    }));
    vi.stubEnv("DUEL_DATA_DIR", engineDirectory);
    expect(() => assertExtraDeckCards({ extra: [100000001] }, createDeckTypeLookup(db).snapshot())).not.toThrow();
  });
  it("names an engine-only card when its type is rejected", () => {
    expect(() => assertExtraDeckCards({ extra: [55144522] }, createDeckTypeLookup(db).snapshot())).toThrow("Move Pot of Greed");
  });
  it("uses catalog text when an engine type has no name row", () => {
    const engine = new Database(join(engineDirectory, "cards.cdb"));
    engine.exec("insert into datas values (777,0,2)");
    engine.close();
    db.exec("insert into card_catalog(ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at) values (777, 'Known Spell', '', 'spell', '', '', '[]', 'test')");
    expect(() => assertExtraDeckCards({ extra: [777] }, createDeckTypeLookup(db).snapshot())).toThrow("Move Known Spell");
    expect(createDeckTypeLookup(db)(777)?.type).toBe(2);
  });
  it("names a remapped card and an artwork from the resolved base catalog row", () => {
    const engine = new Database(join(engineDirectory, "cards.cdb"));
    engine.exec("insert into datas values (777,0,2),(779,777,2)");
    engine.close();
    db.exec("insert into card_catalog(ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at) values (777, 'Known base Spell', '', 'spell', '', '', '[]', 'test'), (778, '', '', 'spell', '', '', '[]', 'test'); insert into card_artworks(card_id,artwork_id,image_url,image_url_small,is_main) values (777,778,'','',0)");
    const bytes = JSON.stringify({ version: 1, remaps: { 100000002: 777 } });
    writeFileSync(join(engineDirectory, "card-remaps.json"), bytes);
    writeFileSync(join(engineDirectory, "manifest.json"), JSON.stringify({
      integrity: { cardRemaps: createHash("sha256").update(bytes).digest("hex") },
    }));
    const find = createDeckTypeLookup(db).snapshot();
    for (const code of [100000002, 778, 779]) {
      expect(() => assertExtraDeckCards({ extra: [code] }, find)).toThrow("Move Known base Spell");
    }
  });
});
