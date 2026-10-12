import Database from "better-sqlite3";
import { expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "../../src/db/index.js";
import { createDeckTypeLookup } from "../../src/services/deck-sections.js";
import { assertExtraDeckCards } from "../../src/duels/extra-deck.js";

it("refreshes default engine types after the card database changes", () => {
  const directory = mkdtempSync(join(tmpdir(), "deck-type-refresh-"));
  const path = join(directory, "cards.cdb");
  const engine = new Database(path);
  const db = new Database(":memory:");
  vi.stubEnv("DUEL_DATA_DIR", directory);
  try {
    engine.exec("create table datas (id integer, alias integer, type integer); create table texts (id integer, name text); insert into datas values (901,0,65); insert into texts values (901,'Fixture card')");
    migrate(db);
    const find = createDeckTypeLookup(db);
    expect(find(901)?.type).toBe(65);
    engine.exec("update datas set type=2 where id=901");
    const changed = new Date(Date.now() + 2000);
    utimesSync(path, changed, changed);
    expect(find(901)?.type).toBe(2);
  } finally {
    engine.close(); db.close(); vi.unstubAllEnvs(); rmSync(directory, { recursive: true, force: true });
  }
});

it("validates engine-only passcodes and gives engine bits priority over stale catalog fields", () => {
  const db = new Database(":memory:");
  try {
    migrate(db);
    db.prepare("insert into card_catalog(ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at) values (901,'Stale Fusion','Fusion Monster','fusion','','','[]','test')").run();
    const find = createDeckTypeLookup(db, new Map([[901, { name: "Test Spell", type: 0x2 }], [903, { name: "Test Fusion", type: 0x41 }]]));
    expect(() => assertExtraDeckCards({ extra: [903] }, find)).not.toThrow();
    expect(() => assertExtraDeckCards({ extra: [901] }, find)).toThrow(expect.objectContaining({ code: "INVALID_EXTRA_DECK_CARD" }));
    expect(() => assertExtraDeckCards({ extra: [999] }, find)).toThrow(expect.objectContaining({ code: "INVALID_EXTRA_DECK_CARD" }));
  } finally { db.close(); }
});
