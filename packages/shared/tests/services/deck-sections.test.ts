import Database from "better-sqlite3";
import { expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "../../src/db/index.js";
import { createDeckTypeLookup } from "../../src/services/deck-sections.js";
import { assertExtraDeckCards } from "../../src/duels/extra-deck.js";
import * as artworks from "../../src/services/card-artworks.js";
import { createSavedDeckService } from "../../src/services/saved-decks.js";

it("loads engine data once for a whole library check and refreshes on the next read", () => {
  const db = new Database(":memory:");
  try {
    migrate(db);
    const insert = db.prepare("insert into saved_decks(guild_id,owner_user_id,name,mode,deck_json) values ('fixture','fixture','Fixture','normal',?)");
    for (let i = 0; i < 10; i++) insert.run(JSON.stringify({ main: [], extra: [901, 903, 901], side: [] }));
    const load = vi.spyOn(artworks, "loadArtworkIdentityCatalog").mockReturnValue(new Map([
      [901, { name: "Fixture Fusion", type: 65 }], [903, { name: "Fixture Xyz", type: 0x800001 }],
    ]));
    const decks = createSavedDeckService(db);
    load.mockClear();
    expect(decks.list("fixture", "fixture").every(row => row.deck.extra.length === 3)).toBe(true);
    expect(load).toHaveBeenCalledTimes(1);
    load.mockReturnValue(new Map([[901, { name: "Fixture Spell", type: 2 }], [903, { name: "Fixture Xyz", type: 0x800001 }]]));
    load.mockClear();
    expect(decks.list("fixture", "fixture").every(row => row.deck.extra.join() === "903" && row.deck.main.join() === "901,901")).toBe(true);
    expect(load).toHaveBeenCalledTimes(1);
  } finally { vi.restoreAllMocks(); db.close(); }
});

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
