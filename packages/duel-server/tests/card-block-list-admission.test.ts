import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { emptyCardQuery, normalizeDuelSettings, type DuelMode } from "@yugidraft/shared/duels";
import { inspectDeck, validateDeck, type MultiplayerTable } from "../src/deck-legality.js";
import { queryCards } from "../src/card-search.js";
import { loadCardDatabase } from "../src/cards.js";

// Supply a repository policy without modifying the real, deliberately empty list.
vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs")>();
  return {
    ...fs,
    readFileSync: (path: Parameters<typeof fs.readFileSync>[0], ...args: unknown[]) => {
      if (String(path).endsWith("/card-block-list.json")) return JSON.stringify([
        { code: 400000012, reason: "Repeated script failure under investigation" },
        { code: 90, reason: "Broken summon script" },
      ]);
      return (fs.readFileSync as (...args: unknown[]) => unknown)(path, ...args);
    },
  };
});

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "card-block-admission-"));
  writeFileSync(join(dir, "strings.conf"), "");
  mkdirSync(join(dir, "card-scripts"));
  const db = new Database(join(dir, "cards.cdb"));
  db.exec(`CREATE TABLE datas (id INTEGER PRIMARY KEY, ot INTEGER, alias INTEGER, setcode INTEGER,
    type INTEGER, atk INTEGER, def INTEGER, level INTEGER, race INTEGER, attribute INTEGER);
    CREATE TABLE texts (id INTEGER PRIMARY KEY, name TEXT, desc TEXT);
    INSERT INTO datas VALUES
      (10,3,0,0,17,1000,1000,4,1,1),(11,3,10,0,17,1000,1000,4,1,1),
      (12,3,11,0,17,1000,1000,4,1,1),(20,3,10,0,17,1000,1000,4,1,1),
      (30,3,0,0,17,1000,1000,4,1,1),(90,3,0,0,65,1000,1000,4,1,1);
    INSERT INTO texts VALUES (10,'Blocked Dragon',''),(11,'Blocked Dragon',''),
      (12,'Blocked Dragon',''),(20,'Alias Dragon',''),(30,'Allowed Dragon',''),(90,'Blocked Fusion','');`);
  db.close();
  // The policy keeps its prerelease code after the card graduates to passcode 12.
  const remaps = JSON.stringify({ version: 1, remaps: { 400000012: 12 } });
  writeFileSync(join(dir, "card-remaps.json"), remaps);
  writeFileSync(join(dir, "manifest.json"), JSON.stringify({ integrity: { cardRemaps: createHash("sha256").update(remaps).digest("hex") } }));
});
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

const reason = "Repeated script failure under investigation";
const modes: DuelMode[] = ["normal", "domain"];
const tables: MultiplayerTable[] = ["1v1", "tag", "ffa3", "ffa4"];
const cases = modes.flatMap(mode => tables.flatMap(table =>
  ["none", "tcg-2026-09", "ocg-2026-07"].flatMap(banlist => [true, false].map(validateDeck =>
    ({ mode, table, banlist, validateDeck })))));

describe("repository card blocks at deck admission", () => {
  it.each(cases)("rejects $mode/$table with $banlist and validateDeck=$validateDeck", ({ mode, table, banlist, validateDeck: competitive }) => {
    const settings = normalizeDuelSettings(mode, { banlist, validateDeck: competitive, startingHand: 1 });
    const deck = { main: [10, ...Array.from({ length: mode === "domain" ? 59 : 39 }, () => 30)], extra: [], side: [],
      ...(mode === "domain" ? { deckMaster: 30 } : {}) };
    const report = inspectDeck(mode, deck, dir, settings, { table });
    expect(report.issues).toContainEqual({
      message: `Blocked Dragon is unavailable: ${reason}`,
      cards: [{ section: "main", index: 0, code: 10, name: "Blocked Dragon" }],
    });
    expect(() => validateDeck(mode, deck, dir, settings, { table })).toThrow(`Blocked Dragon is unavailable: ${reason}`);
  });

  it("highlights every original, chained artwork, distinct-name alias and Deck Master", () => {
    const deck = { main: [10, 11, 12], extra: [90], side: [20], deckMaster: 10 };
    const report = inspectDeck("domain", deck, dir,
      normalizeDuelSettings("domain", { validateDeck: false, banlist: "none", startingHand: 1 }));
    const blocked = report.issues.filter(issue => issue.message.includes("is unavailable:"));
    expect(blocked.flatMap(issue => issue.cards)).toEqual([
      { section: "main", index: 0, code: 10, name: "Blocked Dragon" },
      { section: "main", index: 1, code: 11, name: "Blocked Dragon" },
      { section: "main", index: 2, code: 12, name: "Blocked Dragon" },
      { section: "side", index: 0, code: 20, name: "Alias Dragon" },
      { section: "deckMaster", index: 0, code: 10, name: "Blocked Dragon" },
      { section: "extra", index: 0, code: 90, name: "Blocked Fusion" },
    ]);
  });

  it("still applies when settings are omitted or a draft pool grants the blocked copy", () => {
    const deck = { main: [12], extra: [], side: [] };
    expect(inspectDeck("normal", deck, dir).issues.some(issue => issue.message.includes(reason))).toBe(true);
    expect(() => validateDeck("normal", deck, dir,
      normalizeDuelSettings("normal", { validateDeck: false, startingHand: 1 }),
      { draftPool: { counts: new Map([[12, 1]]), forcedCopies: new Map() } })).toThrow(reason);
  });

  it("allows an unrelated card with competitive checks off", () => {
    expect(inspectDeck("normal", { main: [30], extra: [], side: [] }, dir,
      normalizeDuelSettings("normal", { validateDeck: false, startingHand: 1 })).issues).toEqual([]);
  });
});

describe("repository card blocks in deck-builder search", () => {
  it("applies changing automatic policy to deck checks and cached search results", () => {
    const cards = loadCardDatabase(dir);
    const auto = [{ code: 30, reason: "Its effect script is being investigated" }];
    const deck = { main: [30], extra: [], side: [] };
    const settings = normalizeDuelSettings("normal", { validateDeck: false, startingHand: 1 });
    expect(inspectDeck("normal", deck, dir, settings, { cardBlocks: auto }).issues[0]?.message).toContain("is unavailable");
    expect(queryCards(cards, { ...emptyCardQuery(), text: "30" }, auto).cards[0]?.unavailableReason).toBe(auto[0]!.reason);
    expect(queryCards(cards, { ...emptyCardQuery(), text: "30" }, []).cards[0]).not.toHaveProperty("unavailableReason");
  });
  it("retains name matches with an unavailable reason, including a distinct-name alias", () => {
    const result = queryCards(loadCardDatabase(dir), { ...emptyCardQuery(), text: "Dragon" });
    expect(result.cards.find(card => card.code === 10)).toMatchObject({ unavailableReason: reason });
    expect(result.cards.find(card => card.code === 20)).toMatchObject({ unavailableReason: reason });
    expect(result.cards.find(card => card.code === 30)).not.toHaveProperty("unavailableReason");
  });

  it.each([10, 11, 12, 20])("marks exact passcode %i unavailable even without a banlist", (code) => {
    const result = queryCards(loadCardDatabase(dir), { ...emptyCardQuery(), text: String(code), banlist: "none" });
    expect(result.cards[0]).toMatchObject({ code, unavailableReason: reason });
  });
});

it("automatic script entries block near aliases and leave far aliases selectable in deck checks and search", () => {
  const automatic = [{ code: 10, reason: "Auto reason", exactCodes: [10, 11, 400000010] }];
  const settings = normalizeDuelSettings("normal", { validateDeck: false, startingHand: 1 });
  const deck = { main: [10, 11, 20], extra: [], side: [] };
  const report = inspectDeck("normal", deck, dir, settings, { cardBlocks: automatic });
  expect(report.issues.filter(issue => issue.message.includes("is unavailable")).flatMap(issue => issue.cards.map(card => card.code))).toEqual([10, 11]);
  const result = queryCards(loadCardDatabase(dir), { ...emptyCardQuery(), text: "Dragon" }, automatic);
  expect(result.cards.find(card => card.code === 10)?.unavailableReason).toBe("Auto reason");
  expect(queryCards(loadCardDatabase(dir), { ...emptyCardQuery(), text: "11" }, automatic).cards[0]?.unavailableReason).toBe("Auto reason");
  expect(result.cards.find(card => card.code === 20)).not.toHaveProperty("unavailableReason");
});
