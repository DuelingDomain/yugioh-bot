import Database from "better-sqlite3";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { normalizeDuelSettings } from "@yugidraft/shared/duels";
import { inspectDeck } from "../src/deck-legality.js";
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "art-legality-")); dirs.push(dir);
  writeFileSync(join(dir, "strings.conf"), ""); mkdirSync(join(dir, "card-scripts"));
  writeFileSync(join(dir, "card-scripts/c10.lua"), "-- original script");
  const db = new Database(join(dir, "cards.cdb"));
  db.exec(`create table datas (id integer primary key, ot integer, alias integer, setcode integer, type integer, race integer, attribute integer);
    create table texts (id integer primary key, name text, desc text);
    insert into datas values (10,3,0,0,17,1,1),(11,3,10,0,17,1,1),(12,3,11,0,17,1,1),
      (55144522,3,0,0,2,0,0),(55144523,3,55144522,0,2,0,0);
    insert into texts values (10,'Dragon',''),(11,'Dragon',''),(12,'Dragon',''),(55144522,'Pot of Greed',''),(55144523,'Pot of Greed','');`);
  db.close(); return dir;
}
it("checks both draft pool directions and forced allowances across chained arts", () => {
  const dir = fixture();
  const settings = normalizeDuelSettings("normal", { banlist: "none", cardPool: "both", startingHand: 1, validateDeck: false });
  const inspect = (main: number[], pool: Map<number, number>, forcedCopies = new Map<number, number>()) =>
    inspectDeck("normal", { main, extra: [], side: [] }, dir, settings, { draftPool: { counts: pool, forcedCopies } });
  expect(inspect([12], new Map([[10, 1]])).issues).toEqual([]);
  expect(inspect([10], new Map([[12, 1]])).issues).toEqual([]);
  expect(inspect([10, 11], new Map([[12, 1]])).issues.some(i => /draft picks/.test(i.message))).toBe(true);
  expect(inspect([10, 11, 12, 12], new Map([[10, 4]]), new Map([[12, 1]])).issues).toEqual([]);
});
it("applies ordinary copy limits and the original banlist to mixed artworks", () => {
  const dir = fixture();
  const inspect = (main: number[], banlist = "none") => inspectDeck("normal", { main, extra: [], side: [] }, dir,
    normalizeDuelSettings("normal", { banlist, cardPool: "both", startingHand: 1 }));
  expect(inspect([10, 11, 12, 12]).issues.some(i => /3 copies/.test(i.message))).toBe(true);
  expect(inspect([55144523], "tcg-2026-09").issues.some(i => /forbidden|0 copies/i.test(i.message))).toBe(true);
});

it("keeps Deck Master listed-name and listed-series domains identical for alternate art", () => {
  const dir = fixture();
  writeFileSync(join(dir, "strings.conf"), "!setname 0x123 Test Clan");
  writeFileSync(join(dir, "card-scripts/c10.lua"), "local s,id=GetID()\ns.listed_names={20}\ns.listed_series={0x123}");
  const db = new Database(join(dir, "cards.cdb"));
  db.exec(`insert into datas values (20,3,0,0,17,2,2),(21,3,0,291,17,4,4);
    insert into texts values (20,'Named Friend',''),(21,'Clan Friend','');`); db.close();
  const inspect = (deckMaster: number) => inspectDeck("domain", { main: [20,21], extra: [], side: [], deckMaster }, dir);
  const mainIssues = inspect(10).issues.map(issue => issue.message);
  expect(mainIssues.some(message => /outside/.test(message))).toBe(false);
  for (const art of [11,12]) expect(inspect(art).issues.map(issue => issue.message)).toEqual(mainIssues);
});

it("resolves effect-card script availability through a complete artwork alias chain", () => {
  const dir = fixture();
  const db = new Database(join(dir, "cards.cdb")); db.exec("update datas set type = 33 where id in (10,11,12)"); db.close();
  const result = inspectDeck("normal", { main: [12], extra: [], side: [] }, dir,
    normalizeDuelSettings("normal", { validateDeck: false, startingHand: 1, banlist: "none" }));
  expect(result.issues).toEqual([]);
});
