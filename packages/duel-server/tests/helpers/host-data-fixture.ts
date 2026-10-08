import Database from "better-sqlite3";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface FixtureCard {
  code: number;
  name: string;
  type?: number;
  alias?: number;
}

/** Host admission/recovery tests inject workers, so they need metadata but no engine bundle. */
export function createHostDataFixture(cards: FixtureCard[]) {
  const directory = mkdtempSync(join(tmpdir(), "host-data-fixture-"));
  try {
    writeFileSync(join(directory, "manifest.json"), JSON.stringify({ bundleVersion: "fixture" }));
    writeFileSync(join(directory, "strings.conf"), "");
    mkdirSync(join(directory, "card-scripts"));
    // Satisfy installed-file guards. These placeholders must never be loaded as cores.
    for (const file of ["ocgcore.multi.wasm", "ocgcore.multi-domain.wasm"]) {
      writeFileSync(join(directory, file), "fixture");
    }
    const db = new Database(join(directory, "cards.cdb"));
    try {
      db.exec(`CREATE TABLE datas (id INTEGER PRIMARY KEY, ot INTEGER, alias INTEGER, setcode INTEGER,
        type INTEGER, atk INTEGER, def INTEGER, level INTEGER, race INTEGER, attribute INTEGER);
        CREATE TABLE texts (id INTEGER PRIMARY KEY, name TEXT, desc TEXT);`);
      const data = db.prepare("INSERT INTO datas VALUES (?,3,?,0,?,1000,1000,4,1,1)");
      const text = db.prepare("INSERT INTO texts VALUES (?,?,'')");
      for (const card of cards) {
        data.run(card.code, card.alias ?? 0, card.type ?? 17);
        text.run(card.code, card.name);
        writeFileSync(join(directory, "card-scripts", `c${card.code}.lua`), "-- fixture card script\n");
      }
    } finally { db.close(); }
    return directory;
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}
