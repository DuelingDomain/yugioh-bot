import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { migrate } from "../../src/db/index.js";
import { createDeckTypeLookup } from "../../src/services/deck-sections.js";
import { assertExtraDeckCards } from "../../src/duels/extra-deck.js";

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
