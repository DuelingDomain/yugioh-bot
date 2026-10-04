import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { normalizeCardCodes, normalizeImportedDeck } from "../src/deck-import.js";

const dirs: string[] = [];
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

describe("engine artwork identity", () => {
  it("canonicalizes pool identities and preserves known artwork ids in imported decks", async () => {
    const dir = mkdtempSync(join(tmpdir(), "draft-alias-engine-"));
    dirs.push(dir);
    const cdb = new Database(join(dir, "cards.cdb"));
    cdb.exec(`
      create table datas (id integer primary key, ot integer, alias integer, type integer);
      create table texts (id integer primary key, name text);
      insert into datas values (81480460, 3, 0, 33), (81480461, 3, 81480460, 33), (42, 3, 81480460, 33),
        (5405694, 3, 0, 129), (10000100, 3, 5405694, 17);
      insert into texts values (81480460, 'Barrel Dragon'), (81480461, 'Barrel Dragon'), (42, 'Another card'),
        (5405694, 'Black Luster Soldier'), (10000100, 'Black Luster Soldier');
    `);
    cdb.close();
    const db = new Database(":memory:");
    try {
      expect(await normalizeCardCodes([81480460, 81480461, 42, 10000100], dir, db))
        .toEqual(new Map([[81480460, 81480460], [81480461, 81480460], [42, 42], [10000100, 10000100]]));
      expect(await normalizeImportedDeck({ main: [81480461, 42, 10000100], extra: [81480461], side: [81480461], deckMaster: 81480461 }, dir, db))
        .toEqual({ main: [81480461, 42, 10000100], extra: [81480461], side: [81480461], deckMaster: 81480461 });
    } finally { db.close(); }
  });
});
