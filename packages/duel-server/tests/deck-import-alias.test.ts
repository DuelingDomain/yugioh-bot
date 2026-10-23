import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
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
        (5405694, 3, 0, 129), (10000100, 3, 5405694, 17),
        (27204311, 3, 0, 33), (27204312, 3, 0, 16401), (53855409, 3, 0, 33), (53855410, 3, 0, 16401);
      insert into texts values (81480460, 'Barrel Dragon'), (81480461, 'Barrel Dragon'), (42, 'Another card'),
        (5405694, 'Black Luster Soldier'), (10000100, 'Black Luster Soldier'),
        (27204311, 'Nibiru, the Primal Being'), (27204312, 'Primal Being Token'),
        (53855409, 'Doppelwarrior'), (53855410, 'Doppel Token');
    `);
    cdb.close();
    const db = new Database(":memory:");
    try {
      expect(await normalizeCardCodes([81480460, 81480461, 42, 10000100], dir, db))
        .toEqual(new Map([[81480460, 81480460], [81480461, 81480460], [42, 42], [10000100, 10000100]]));
      expect(await normalizeImportedDeck({ main: [81480461, 42, 10000100], extra: [81480461], side: [81480461], deckMaster: 81480461 }, dir, db))
        .toEqual({ main: [81480461, 42, 10000100], extra: [81480461], side: [81480461], deckMaster: 81480461 });
      expect(await normalizeImportedDeck({ main: [27204312, 53855410], extra: [], side: [] }, dir, db))
        .toEqual({ main: [27204311, 53855409], extra: [], side: [] });
      for (const preserveArtwork of [false, true]) {
        expect(await normalizeCardCodes([27204312, 53855410], dir, db, { preserveArtwork }))
          .toEqual(new Map([[27204312, 27204311], [53855410, 53855409]]));
      }
    } finally { db.close(); }
  });
});

describe("Dueling Book static-data refresh integration", () => {
  it("verifies names/playability against SQLite and preserves both files on an unavailable or invalid feed", async () => {
    const { refreshDuelingBookPasscodes } = await import("../scripts/update-duelingbook-passcodes.js");
    const dir = mkdtempSync(join(tmpdir(), "duelingbook-refresh-"));
    dirs.push(dir);
    const cdb = new Database(join(dir, "cards.cdb"));
    cdb.exec(`
      create table datas (id integer primary key, ot integer, alias integer, type integer);
      create table texts (id integer primary key, name text);
      insert into datas values (10, 3, 0, 33), (11, 3, 10, 33), (20, 3, 0, 2),
        (30, 32, 0, 33), (40, 3, 0, 16401), (41, 3, 0, 16401), (42, 3, 0, 134217728),
        (50, 515, 0, 33), (60, 3, 0, 33), (99, 0, 0, 0);
      insert into texts values (10, 'Blue-Eyes White Dragon'), (11, 'Blue-Eyes White Dragon'), (20, 'Premature Burial'),
        (30, 'Custom'), (40, 'Token'), (41, 'Blue-Eyes White Dragon'), (42, 'Skill'), (50, 'Rush'), (60, 'Different card');
    `);
    cdb.close();
    const tablePath = join(dir, "passcodes.json"), namesPath = join(dir, "names.json");
    const cards = [
      { n: "BLUE EYES WHITE DRAGON!", s: 10, s2: "101" },
      { name: "Premature Burial", serial_number: "20", alt_passcode: 102 },
      { n: "Blue-Eyes White Dragon", s: 10, s2: 11 },
      { n: "Blue-Eyes White Dragon", s: 10, s2: 99 },
      { n: "Premature Burial", s: 20, s2: 40 },
      { n: "Blue-Eyes White Dragon", s: 10, s2: 41 },
      { n: "Blue-Eyes White Dragon", s: 10, s2: 42 },
      { n: "Missing", s: 999, s2: 103 }, { n: "Custom", s: 30, s2: 104 },
      { n: "Token", s: 40, s2: 105 }, { n: "Rush", s: 50, s2: 106 },
      { n: "Wrong card", s: 60, s2: 107 }, { n: "Blue-Eyes White Dragon", s: 11, s2: 108 },
      { n: "Blue-Eyes White Dragon", s: 10, s2: "109oops" },
      { n: "Blue-Eyes White Dragon", s: 10, s2: 110 }, { n: "Premature Burial", s: 20, s2: 110 },
    ];
    const request = vi.fn(async () => Response.json({ cards }));
    const options = { dataDirectory: dir, tablePath, namesPath, request };
    const report = await refreshDuelingBookPasscodes(options);
    expect(request).toHaveBeenCalledExactlyOnceWith("https://static.duelingbook.com/cards.json", expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(report).toMatchObject({ mapped: 4, alternateRows: 16, skipped: {
      engineKnown: 3, missingTarget: 1, unplayableTarget: 4, nameMismatch: 1, invalidPasscode: 1, ambiguous: 2,
    } });
    expect(JSON.parse(readFileSync(tablePath, "utf8"))).toEqual({ 40: 20, 42: 10, 101: 10, 102: 20 });
    expect(JSON.parse(readFileSync(namesPath, "utf8"))).toEqual({ 10: "Blue-Eyes White Dragon", 20: "Premature Burial" });
    const table = readFileSync(tablePath, "utf8"), names = readFileSync(namesPath, "utf8");
    await refreshDuelingBookPasscodes({ ...options, request: async () => Response.json(cards.slice().reverse()) });
    expect(readFileSync(tablePath, "utf8")).toBe(table);
    expect(readFileSync(namesPath, "utf8")).toBe(names);
    writeFileSync(tablePath, "{}\n"); writeFileSync(namesPath, "{}\n");
    writeFileSync(join(dir, "update.json"), JSON.stringify({ changed: false, files: [], next: {}, matchingPrHead: "stale" }));
    const pins = { scripts: "a".repeat(40), database: "b".repeat(40), strings: "c".repeat(40) };
    writeFileSync(join(dir, "manifest.json"), JSON.stringify({ sources: pins }));
    await refreshDuelingBookPasscodes({ ...options, artifactDirectory: dir });
    expect(JSON.parse(readFileSync(join(dir, "update.json"), "utf8"))).toMatchObject({ changed: true, next: pins,
      files: ["packages/duel-server/duelingbook-alt-passcodes.json", "packages/duel-server/duelingbook-alt-passcode-names.json"] });
    expect(JSON.parse(readFileSync(join(dir, "update.json"), "utf8"))).not.toHaveProperty("matchingPrHead");
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      for (const request of [async () => { throw new Error("offline"); }, async () => new Response("blocked", { status: 403 }),
        async () => Response.json({ unexpected: cards }), async () => Response.json({ cards: [{ n: "No alternates", s: 10 }] })]) {
        expect(await refreshDuelingBookPasscodes({ ...options, request })).toBeNull();
        expect(readFileSync(tablePath, "utf8")).toBe(table);
        expect(readFileSync(namesPath, "utf8")).toBe(names);
      }
      expect(warning).toHaveBeenCalledTimes(4);
    } finally { warning.mockRestore(); }
  });
});
