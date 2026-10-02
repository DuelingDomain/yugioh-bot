import { copyFileSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterAll, describe, expect, it } from "vitest";
import { defaultDuelSettings, normalizeDuelSettings, NO_BANLIST_ID, type DuelDeck } from "@yugidraft/shared/duels";
import { MULTIPLAYER_FORBIDDEN } from "../src/banlists/multiplayer.js";
import { inspectDeck, validateDeck } from "../src/deck-legality.js";
import { engineDataDirectory as DATA } from "./engine-data-dir.js";

const ELF = 15025844;
const DARK_MAGICIAN = 46986414;
const CYBER_DRAGON = 70095154;
const AXE_RAIDER = 48305365;
const POT_OF_GREED = 55144522;
const OBELISK = 10000000;
const GAGAGIGO = 49003308;
const UMI = 22702055;
const LEGENDARY_OCEAN = 295517;
const HARPIE_LADY = 76812113;
const HARPIE_LADY_1 = 91932350;
const TYPE_EXTRA = 0x40 | 0x2000 | 0x800000 | 0x4000000;
const settings = defaultDuelSettings("domain");
const forbidden = new Set(MULTIPLAYER_FORBIDDEN.map(({ code }) => code));

function fillers(count: number, excluded: number[] = []): number[] {
  const db = new Database(join(DATA, "cards.cdb"), { readonly: true, fileMustExist: true });
  try {
    const rows = db.prepare(`SELECT datas.id FROM datas JOIN texts USING(id)
      WHERE type & 2 != 0 AND type & 1 = 0 AND alias = 0 AND (ot & 3) != 0
        AND desc NOT LIKE '%always treated as%' ORDER BY datas.id`).all() as { id: number }[];
    const cards = rows.map(({ id }) => id).filter(id => !forbidden.has(id) && !excluded.includes(id)).slice(0, count);
    expect(cards).toHaveLength(count);
    return cards;
  } finally { db.close(); }
}

function deck(main: number[] = [], extra: number[] = [], master = ELF): DuelDeck {
  return { main: [...main, ...fillers(60 - main.length, main)], extra, side: [], deckMaster: master };
}

function lightExtras(): number[] {
  const db = new Database(join(DATA, "cards.cdb"), { readonly: true, fileMustExist: true });
  try {
    const rows = db.prepare(`SELECT id FROM datas WHERE type & 1 != 0 AND type & ? != 0
      AND attribute = 16 AND alias = 0 AND (ot & 3) != 0 ORDER BY id`).all(TYPE_EXTRA) as { id: number }[];
    const cards = rows.map(({ id }) => id).filter(id => !forbidden.has(id)).slice(0, 16);
    expect(cards).toHaveLength(16);
    return cards;
  } finally { db.close(); }
}

const divineData: Partial<Record<"attribute" | "beast", string>> = {};

function divineFixture(kind: "attribute" | "beast"): string {
  const cached = divineData[kind];
  if (cached) return cached;
  const fixture = mkdtempSync(join(tmpdir(), `domain-divine-${kind}-`));
  divineData[kind] = fixture;
  copyFileSync(join(DATA, "cards.cdb"), join(fixture, "cards.cdb"));
  symlinkSync(join(DATA, "strings.conf"), join(fixture, "strings.conf"));
  symlinkSync(join(DATA, "card-scripts"), join(fixture, "card-scripts"), "dir");
  const db = new Database(join(fixture, "cards.cdb"));
  try {
    // Private WATER / Divine-Beast and Divine / Dragon copies isolate each rule.
    // None of the three test Deck Masters has WATER Attribute or Dragon Type.
    const update = kind === "beast"
      ? "UPDATE datas SET attribute = 2 WHERE id = ?"
      : "UPDATE datas SET attribute = 64, race = 8192 WHERE id = ?";
    expect(db.prepare(update).run(OBELISK).changes).toBe(1);
  } finally {
    db.close();
  }
  return fixture;
}

afterAll(() => {
  for (const fixture of Object.values(divineData)) rmSync(fixture, { recursive: true, force: true });
});

for (const table of ["1v1", "ffa3", "ffa4", "tag"] as const) {
  describe(`Domain deck rules at ${table}`, () => {
    it.each([59, 61])("refuses %i Main cards and accepts exactly 60 plus a separate Deck Master", count => {
      const valid = deck();
      expect(inspectDeck("domain", valid, DATA, settings, { table }).issues).toEqual([]);
      expect(() => validateDeck("domain", valid, DATA, settings, { table })).not.toThrow();
      const invalid = { ...valid, main: fillers(count) };
      expect(inspectDeck("domain", invalid, DATA, settings, { table }).issues.map(issue => issue.message))
        .toEqual(["Main Deck must have exactly 60 cards"]);
    });

    it("accepts 0 and 15 Extra cards and refuses 16", () => {
      const extras = lightExtras();
      for (const size of [0, 15]) {
        expect(inspectDeck("domain", deck([], extras.slice(0, size)), DATA, settings, { table }).issues).toEqual([]);
      }
      expect(inspectDeck("domain", deck([], extras), DATA, settings, { table }).issues.map(issue => issue.message))
        .toEqual(["Extra Deck must have 15 or fewer cards"]);
    });

    it.each([1, 15, 16])("refuses a Side Deck with %i cards", count => {
      const valid = deck();
      const invalid = { ...valid, side: fillers(count, valid.main) };
      const issues = inspectDeck("domain", invalid, DATA, settings, { table }).issues;
      expect(issues.map(issue => issue.message)).toEqual([
        ...(count > 15 ? ["Side Deck must have 15 or fewer cards"] : []),
        "Domain Format does not use a Side Deck; put the Deck Master in deckMaster",
      ]);
      expect(issues.at(-1)?.cards).toEqual(invalid.side.map((code, index) =>
        expect.objectContaining({ section: "side", index, code })));
      expect(() => validateDeck("domain", invalid, DATA, settings, { table })).toThrow();
    });

    it("keeps the 15-card Side limit when competitive checks are off", () => {
      const valid = deck();
      const side = fillers(16, valid.main);
      const casual = { ...settings, validateDeck: false };
      expect(inspectDeck("domain", { ...valid, side: side.slice(0, 15) }, DATA, casual, { table }).issues).toEqual([]);
      expect(inspectDeck("domain", { ...valid, side }, DATA, casual, { table }).issues.map(issue => issue.message))
        .toEqual(["Side Deck must have 15 or fewer cards"]);
    });

    it.each([DARK_MAGICIAN, 46986415])("refuses Deck Master identity %i in Main", code => {
      const invalid = deck([code], [], DARK_MAGICIAN);
      expect(inspectDeck("domain", invalid, DATA, settings, { table }).issues).toEqual([
        { message: expect.stringContaining("cannot appear"), cards: [expect.objectContaining({ section: "main", index: 0, code })] },
      ]);
      expect(() => validateDeck("domain", invalid, DATA, settings, { table })).toThrow(/cannot appear/);
    });

    it("refuses the Deck Master in Extra", () => {
      const master = lightExtras()[0]!;
      const invalid = deck([], [master], master);
      expect(inspectDeck("domain", invalid, DATA, settings, { table }).issues).toEqual([
        { message: expect.stringContaining("cannot appear"), cards: [expect.objectContaining({ section: "extra", index: 0, code: master })] },
      ]);
      expect(() => validateDeck("domain", invalid, DATA, settings, { table })).toThrow(/cannot appear/);
    });

    it("refuses a treated-as Deck Master name in Main", () => {
      const invalid = deck([HARPIE_LADY_1], [], HARPIE_LADY);
      expect(inspectDeck("domain", invalid, DATA, settings, { table }).issues).toEqual([
        { message: expect.stringContaining("cannot appear"), cards: [expect.objectContaining({ section: "main", index: 0, code: HARPIE_LADY_1 })] },
      ]);
      expect(() => validateDeck("domain", invalid, DATA, settings, { table })).toThrow(/cannot appear/);
    });

    it("refuses the Deck Master in Side", () => {
      const invalid = { ...deck(), side: [ELF] };
      expect(inspectDeck("domain", invalid, DATA, settings, { table }).issues).toEqual([
        { message: expect.stringContaining("does not use a Side Deck"), cards: [expect.objectContaining({ section: "side", index: 0, code: ELF })] },
      ]);
      expect(() => validateDeck("domain", invalid, DATA, settings, { table })).toThrow(/does not use a Side Deck/);
    });

    it("refuses duplicate Main and Extra cards, including alternate art and treated-as names", () => {
      const extra = lightExtras()[0]!;
      for (const invalid of [deck([POT_OF_GREED, POT_OF_GREED]), deck([DARK_MAGICIAN, 46986415]), deck([UMI, LEGENDARY_OCEAN]), deck([], [extra, extra])]) {
        expect(inspectDeck("domain", invalid, DATA, settings, { table }).issues.some(issue => /Duplicate card/.test(issue.message))).toBe(true);
      }
    });

    it("uses no banlist by default and accepts a TCG forbidden Spell", () => {
      expect(settings.banlist).toBe(NO_BANLIST_ID);
      const valid = deck([POT_OF_GREED]);
      expect(inspectDeck("domain", valid, DATA, settings, { table }).issues).toEqual([]);
      const listed = inspectDeck("domain", valid, DATA, { ...settings, banlist: "tcg-2026-09" }, { table });
      expect(listed.issues.some(issue => issue.cards.some(card => card.code === POT_OF_GREED) && /forbidden/.test(issue.message))).toBe(true);
    });

    it.each([undefined, null, {}])("uses no banlist after settings normalization of %j", input => {
      const normalized = normalizeDuelSettings("domain", input);
      expect(normalized.banlist).toBe(NO_BANLIST_ID);
      expect(inspectDeck("domain", deck([POT_OF_GREED]), DATA, normalized, { table }).issues).toEqual([]);
    });

    it.each([DARK_MAGICIAN, AXE_RAIDER, CYBER_DRAGON])("admits Divine and Divine-Beast cards with unrelated Deck Master %i", master => {
      const valid = deck([10000000, 10000010, 10000020], [], master);
      expect(inspectDeck("domain", valid, DATA, settings, { table }).issues).toEqual([]);
    });

    it.each([DARK_MAGICIAN, AXE_RAIDER, CYBER_DRAGON])("admits Divine-Beast alone with unrelated Deck Master %i", master => {
      const fixture = divineFixture("beast");
      const valid = deck([OBELISK], [], master);
      expect(inspectDeck("domain", valid, fixture, settings, { table }).issues).toEqual([]);
      expect(() => validateDeck("domain", valid, fixture, settings, { table })).not.toThrow();
      expect(inspectDeck("domain", deck([GAGAGIGO], [], master), fixture, settings, { table }).issues).toEqual([
        { message: expect.stringContaining("outside the Deck Master's Domain"), cards: [expect.objectContaining({ section: "main", index: 0, code: GAGAGIGO })] },
      ]);
    });

    it.each([DARK_MAGICIAN, AXE_RAIDER, CYBER_DRAGON])("admits Divine Attribute alone with unrelated Deck Master %i", master => {
      const fixture = divineFixture("attribute");
      const valid = deck([OBELISK], [], master);
      expect(inspectDeck("domain", valid, fixture, settings, { table }).issues).toEqual([]);
      expect(() => validateDeck("domain", valid, fixture, settings, { table })).not.toThrow();
      expect(inspectDeck("domain", deck([GAGAGIGO], [], master), fixture, settings, { table }).issues).toEqual([
        { message: expect.stringContaining("outside the Deck Master's Domain"), cards: [expect.objectContaining({ section: "main", index: 0, code: GAGAGIGO })] },
      ]);
    });
  });
}

describe("Domain membership from card text", () => {
  it.each([
    ["own Attribute", ELF, CYBER_DRAGON, AXE_RAIDER],
    ["own Monster Type", ELF, DARK_MAGICIAN, AXE_RAIDER],
    ["own archetype", 36577931, 45883110, AXE_RAIDER], // Despian Tragedy -> LIGHT Spellcaster Guiding Quem
    ["mentioned Attribute", 72989439, DARK_MAGICIAN, AXE_RAIDER], // LIGHT Warrior BLS mentions DARK
    ["mentioned Monster Type", 78193831, 89631139, AXE_RAIDER], // EARTH Warrior Buster Blader mentions Dragon
    ["mentioned archetype", 40237839, 50304345, AXE_RAIDER], // LIGHT Fairy Winged Kuriboh Sabatiel mentions HERO
    ["named card", 98502113, 78193831, ELF], // Dark Paladin names Buster Blader
    ["archetype of a named card", 98502113, 3428069, ELF], // Buster Blader, the Destruction Swordmaster
  ] as const)("admits a monster through its %s", (_kind, master, monster, controlMaster) => {
    const valid = deck([monster], [], master);
    expect(inspectDeck("domain", valid, DATA, settings).issues).toEqual([]);
    expect(inspectDeck("domain", deck([monster], [], controlMaster), DATA, settings).issues
      .some(issue => issue.message.includes("outside the Deck Master's Domain"))).toBe(true);
  });

  it("admits a Divine Attribute monster whose Type is not Divine-Beast", () => {
    // Holactie is Divine / Creator-God. It is forbidden by the separate multiplayer safety list,
    // so use 1v1 to pin Domain membership without that independent refusal.
    expect(inspectDeck("domain", deck([10000040]), DATA, settings).issues).toEqual([]);
  });

  it("allows Spell and Trap Cards without a Domain match", () => {
    expect(inspectDeck("domain", deck([POT_OF_GREED, 41420027], [], AXE_RAIDER), DATA, settings).issues).toEqual([]);
  });
});
