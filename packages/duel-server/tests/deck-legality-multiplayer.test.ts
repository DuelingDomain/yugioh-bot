import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import type { DuelDeck, DuelSettings } from "@yugidraft/shared/duels";
import { MULTIPLAYER_FORBIDDEN, multiplayerForbiddenFor, type MultiplayerTable } from "../src/banlists/multiplayer.js";
import { TCG_2026_10_19_LIMITS } from "../src/banlists/compiled.js";
import { inspectDeck, validateDeck } from "../src/deck-legality.js";
import { engineDataDirectory as DATA } from "./engine-data-dir.js";

const EXODIA = 33396948;
const EXODIA_ALT = 33396949;
const FINAL_COUNTDOWN = 95308449;
const CARD_DESTRUCTION = 72892473;
const NIBIRU = 27204311;
const NIBIRU_ALT = 27204313;
const HAND_DESTRUCTION = 74519184;
const CREATURE_SWAP = 31036355;
const RAIGEKI = 12580477;
const DARK_MAGICIAN = 46986414;
const RING_OF_DESTRUCTION = 83555666;
const CONVULSION_OF_NATURE = 62966332;

const TYPE_SPELL = 0x2;
const TYPE_MONSTER = 0x1;
const TYPE_TOKEN = 0x4000;

const settings: DuelSettings = {
  visibility: "public",
  banlist: "none",
  cardPool: "both",
  turnSeconds: 240,
  startingLP: 8000,
  startingHand: 5,
  drawPerTurn: 1,
  timeout: "loss",
  validateDeck: true,
  shuffleDeck: true,
};

function fillers(count: number): number[] {
  const db = new Database(join(DATA, "cards.cdb"), { readonly: true, fileMustExist: true });
  try {
    const skip = new Set([...MULTIPLAYER_FORBIDDEN.map((entry) => entry.code), ...Object.keys(TCG_2026_10_19_LIMITS).map(Number)]);
    const rows = db
      .prepare(
        `SELECT datas.id FROM datas JOIN texts USING (id)
         WHERE type & ? != 0 AND type & ? = 0 AND type & ? = 0
           AND (ot & 3) != 0 AND alias = 0
           AND desc NOT LIKE '%always treated as%'
         ORDER BY datas.id`,
      )
      .all(TYPE_SPELL, TYPE_MONSTER, TYPE_TOKEN) as Array<{ id: number }>;
    const ids = rows.map((row) => row.id).filter((id) => !skip.has(id));
    return ids.slice(0, count);
  } finally {
    db.close();
  }
}

function deckWith(...cards: number[]): DuelDeck {
  const base = fillers(40);
  return { main: [...cards, ...base.slice(0, 40 - cards.length)], extra: [], side: [] };
}

const FFA_TABLES: MultiplayerTable[] = ["ffa3", "ffa4"];

describe("multiplayer forbidden list in deck validation", () => {
  it.each([
    [100200298, 'Counter Spell "Negate Attack"'],
    [101402094, "Angelechy Opposition"],
  ] as const)("allows proved preview %s at every multiplayer table", (code, name) => {
    for (const mode of ["normal", "domain"] as const) {
      const deck = mode === "normal" ? deckWith(code) : {
        main: [code, ...fillers(59)], extra: [], side: [], deckMaster: DARK_MAGICIAN,
      };
      for (const table of ["ffa3", "ffa4", "tag"] as const) {
        const issues = inspectDeck(mode, deck, DATA, settings, { table }).issues;
        expect(issues.some(issue => issue.message.startsWith(`${name} is forbidden in `)), `${mode} ${table}`).toBe(false);
      }
      expect(inspectDeck(mode, deck, DATA, settings, { table: "1v1" }).issues, mode).toEqual([]);
    }
  });

  it("does not change the default table", () => {
    const deck = deckWith(EXODIA, HAND_DESTRUCTION, CREATURE_SWAP, NIBIRU);
    expect(inspectDeck("normal", deck, DATA, settings)).toEqual(inspectDeck("normal", deck, DATA, settings, { table: "1v1" }));
    expect(inspectDeck("normal", deck, DATA, settings).issues).toEqual([]);
    expect(() => validateDeck("normal", deck, DATA, settings, {})).not.toThrow();
  });

  it("allows the three owner 2026-10-18 cards at every multiplayer table", () => {
    const deck = deckWith(EXODIA, EXODIA_ALT, HAND_DESTRUCTION, CARD_DESTRUCTION);
    for (const table of ["ffa3", "ffa4", "tag"] as const) {
      expect(inspectDeck("normal", deck, DATA, settings, { table }).issues, table).toEqual([]);
    }
  });

  it("allows the owner 2026-10-18 cards at every table", () => {
    const deck = deckWith(101402094, 82301904, RING_OF_DESTRUCTION, 57728570, NIBIRU);
    for (const table of ["1v1", "ffa3", "ffa4", "tag"] as const) {
      expect(inspectDeck("normal", deck, DATA, settings, { table }).issues, table).toEqual([]);
      expect(() => validateDeck("normal", deck, DATA, settings, { table }), table).not.toThrow();
    }
  });

  it("flags an all-format card in Tag too", () => {
    const deck = deckWith(FINAL_COUNTDOWN);
    for (const banlist of ["none", "tcg-2026-10-19"]) {
      const rules = { ...settings, banlist };
      expect(inspectDeck("normal", deck, DATA, rules, { table: "1v1" }).issues).toEqual([]);
      for (const table of ["ffa3", "ffa4", "tag"] as const) {
        const issues = inspectDeck("normal", deck, DATA, rules, { table }).issues;
        expect(issues.length, `${banlist} ${table}`).toBe(1);
        expect(issues[0]?.message).toMatch(/Final Countdown is forbidden in/);
      }
    }
  });

  it.each(["ffa3", "ffa4", "tag"] as const)("allows proved Convulsion of Nature in %s with deck validation on or off", (table) => {
    const deck: DuelDeck = { ...deckWith(CONVULSION_OF_NATURE), side: [CONVULSION_OF_NATURE] };
    for (const validate of [true, false]) {
      const rules = { ...settings, validateDeck: validate };
      expect(inspectDeck("normal", deck, DATA, rules, { table }).issues).toEqual([]);
      expect(() => validateDeck("normal", deck, DATA, rules, { table })).not.toThrow();
    }
  });

  it("keeps Convulsion of Nature legal in 1v1", () => {
    const deck = deckWith(CONVULSION_OF_NATURE);
    expect(inspectDeck("normal", deck, DATA, settings, { table: "1v1" }).issues).toEqual([]);
    expect(() => validateDeck("normal", deck, DATA, settings, { table: "1v1" })).not.toThrow();
  });

  it("uses the documented message format", () => {
    const issue = inspectDeck("normal", deckWith(FINAL_COUNTDOWN), DATA, settings, { table: "ffa4" }).issues[0]!;
    expect(issue.message).toMatch(/^Final Countdown is forbidden in 4-player free-for-all: .+/);
    const three = inspectDeck("normal", deckWith(FINAL_COUNTDOWN), DATA, settings, { table: "ffa3" }).issues[0]!;
    expect(three.message).toContain("in 3-player free-for-all:");
    const tag = inspectDeck("normal", deckWith(FINAL_COUNTDOWN), DATA, settings, { table: "tag" }).issues[0]!;
    expect(tag.message).toContain("in 2v2 Tag Duel:");
    expect(() => validateDeck("normal", deckWith(FINAL_COUNTDOWN), DATA, settings, { table: "ffa4" })).toThrow(
      /forbidden in 4-player free-for-all/,
    );
  });

  it("allows Exodia alternate-art passcodes through the alias column", () => {
    expect(multiplayerForbiddenFor("ffa4", EXODIA_ALT, EXODIA)).toBeUndefined();
    const issues = inspectDeck("normal", deckWith(EXODIA, EXODIA_ALT), DATA, settings, { table: "ffa4" }).issues;
    expect(issues.filter((issue) => issue.message.includes("is forbidden"))).toEqual([]);
  });

  it("allows Nibiru and its alternate art after live proof", () => {
    expect(multiplayerForbiddenFor("ffa4", NIBIRU_ALT, NIBIRU)).toBeUndefined();
    const issues = inspectDeck("normal", deckWith(NIBIRU, NIBIRU_ALT), DATA, settings, { table: "ffa3" }).issues;
    expect(issues.filter((issue) => issue.message.includes("is forbidden"))).toEqual([]);
  });

  it("flags each table list and only its own formats", () => {
    const tables: Array<"ffa3" | "ffa4" | "tag"> = ["ffa3", "ffa4", "tag"];
    for (const table of tables) {
      const expected = MULTIPLAYER_FORBIDDEN.filter((entry) => entry.formats.includes(table));
      expect(expected.length, table).toBeGreaterThan(0);
      for (const entry of expected) {
        const issues = inspectDeck("normal", deckWith(entry.code), DATA, settings, { table }).issues;
        expect(issues.some((issue) => issue.message.startsWith(`${entry.name} is forbidden in `)), `${table} ${entry.name}`).toBe(true);
      }
      for (const entry of MULTIPLAYER_FORBIDDEN.filter((item) => !item.formats.includes(table))) {
        const issues = inspectDeck("normal", deckWith(entry.code), DATA, settings, { table }).issues;
        expect(issues.some((issue) => issue.message.includes(" is forbidden in ")), `${table} ${entry.name}`).toBe(false);
      }
    }
  });

  it("keeps an ordinary 1v1 deck legal at every table", () => {
    const deck = deckWith(RAIGEKI);
    for (const table of ["1v1", "tag", "ffa3", "ffa4"] as const) {
      expect(inspectDeck("normal", deck, DATA, settings, { table }).issues, table).toEqual([]);
    }
  });

  it("still flags forbidden cards when deck validation is off (the engine cannot play them)", () => {
    const off = { ...settings, validateDeck: false };
    const issues = inspectDeck("normal", deckWith(FINAL_COUNTDOWN), DATA, off, { table: "ffa4" }).issues;
    expect(issues.map((issue) => issue.message)).toEqual([expect.stringMatching(/^Final Countdown is forbidden in 4-player/)]);
    expect(inspectDeck("normal", deckWith(FINAL_COUNTDOWN), DATA, off).issues).toEqual([]);
  });

  it("flags a forbidden Deck Master in Domain Format", () => {
    const base = fillers(60);
    const deck: DuelDeck = { main: base, extra: [], side: [], deckMaster: DARK_MAGICIAN };
    const plain = inspectDeck("domain", deck, DATA, settings, { table: "ffa4" }).issues;
    expect(plain.some((issue) => issue.message.includes(" is forbidden in "))).toBe(false);
    const forbiddenMaster: DuelDeck = { ...deck, deckMaster: 37984331 };
    const issues = inspectDeck("domain", forbiddenMaster, DATA, settings, { table: "ffa4" }).issues;
    expect(issues.some((issue) => issue.message.startsWith("True Exodia is forbidden in 4-player"))).toBe(true);
    const oneVsOne = inspectDeck("domain", forbiddenMaster, DATA, settings).issues;
    expect(oneVsOne.some((issue) => issue.message.includes(" is forbidden in "))).toBe(false);
  });

  it("has no duplicate passcodes in the list", () => {
    const codes = MULTIPLAYER_FORBIDDEN.map((entry) => entry.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});
