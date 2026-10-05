import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterAll, describe, expect, it } from "vitest";
import { inspectDeck } from "../src/deck-legality.js";

const fixtures: string[] = [];

// A private catalog isolates text membership from the master's own Attribute,
// Type, archetypes and listed_names, without changing the engine database.
function membership(desc: string, attribute = 0x2, race = 0x40, type = 0x21, setnames = "") {
  const directory = mkdtempSync(join(tmpdir(), "domain-text-"));
  fixtures.push(directory);
  writeFileSync(join(directory, "strings.conf"), setnames);
  const db = new Database(join(directory, "cards.cdb"));
  try {
    db.exec(`CREATE TABLE datas (id INTEGER PRIMARY KEY, ot INTEGER, alias INTEGER,
      setcode INTEGER, type INTEGER, race INTEGER, attribute INTEGER);
      CREATE TABLE texts (id INTEGER PRIMARY KEY, name TEXT, desc TEXT);
      BEGIN;`);
    const data = db.prepare("INSERT INTO datas VALUES (?, 3, 0, 0, ?, ?, ?)");
    const text = db.prepare("INSERT INTO texts VALUES (?, ?, ?)");
    for (let id = 1; id <= 59; id++) {
      data.run(id, 0x2, 0, 0);
      text.run(id, `Filler ${id}`, "");
    }
    data.run(100, type, 0x200000, 0x40);
    text.run(100, "Test Master", desc);
    data.run(101, 0x11, race, attribute);
    text.run(101, "Test Monster", "");
    db.exec("COMMIT");
  } finally {
    db.close();
  }
  return inspectDeck("domain", {
    main: [101, ...Array.from({ length: 59 }, (_, i) => i + 1)],
    extra: [], side: [], deckMaster: 100,
  }, directory).issues;
}

afterAll(() => {
  for (const directory of fixtures) rmSync(directory, { recursive: true, force: true });
});

describe("Normal Pendulum Deck Master effect boxes", () => {
  it.each(["[ Flavor Text ]", "[ Monster Effect ]", "[Flavor Text]", "[Monster Effect]"])(
    "counts Pendulum mentions and ignores the %s box", (flavorHeader) => {
      const desc = `[ Pendulum Effect ]\nSpecial Summon 1 Sea Serpent/WATER monster.\n` +
        `----------------------------------------\n${flavorHeader}\nA FIRE Dragon that lives in darkness.`;
      const type = 0x1000011;
      expect(membership(desc, 0x2, 0x40, type)).toEqual([]);
      expect(membership(desc, 0x10, 0x40000, type)).toEqual([]);
      expect(membership(desc, 0x4, 0x40, type)[0]?.message)
        .toContain("outside the Deck Master's Domain");
      expect(membership(desc, 0x10, 0x2000, type)[0]?.message)
        .toContain("outside the Deck Master's Domain");
      expect(membership(desc, 0x20, 0x40, type)[0]?.message)
        .toContain("outside the Deck Master's Domain");
    },
  );

  it("ignores flavor text when the Normal Pendulum monster has no Pendulum Effect box", () => {
    expect(membership("A WATER Sea Serpent.", 0x2, 0x40000, 0x1000011)[0]?.message)
      .toContain("outside the Deck Master's Domain");
  });

  it("still ignores ordinary Normal Monster flavor text", () => {
    expect(membership('A DARK Dragon that commands "Warriors".', 0x20, 0x2000, 0x11)[0]?.message)
      .toContain("outside the Deck Master's Domain");
  });

  it("counts a compact Pendulum Effect header without a following flavor box", () => {
    expect(membership("[Pendulum Effect]\nSpecial Summon 1 WATER monster.", 0x2, 0x40, 0x1000011))
      .toEqual([]);
  });
});

describe("Domain Attribute and Type mentions", () => {
  it.each([
    ["darkness", 0x20, 0x40],
    ["lightning", 0x10, 0x40],
    ["delight", 0x10, 0x40],
    ["flight", 0x10, 0x40],
    ["window", 0x8, 0x40],
    ["unearth", 0x1, 0x40],
    ["waterfall", 0x2, 0x40],
    ["fireworks", 0x4, 0x40],
    ["selfish", 0x2, 0x20000],
    ["rocket", 0x2, 0x100],
    ["implant", 0x2, 0x400],
    ["aquarium", 0x2, 0x40],
    ["machinery", 0x2, 0x20],
    ["dragonfly", 0x2, 0x2000],
    ["illusionist", 0x2, 0x2000000],
    ["pyrotechnics", 0x2, 0x80],
    ["thunderstorm", 0x2, 0x1000],
    ["Thundercrash", 0x2, 0x1000],
    ["Dragonic Counter", 0x2, 0x2000],
  ])("does not infer membership from %s", (word, attribute, race) => {
    expect(membership(`This effect mentions ${word}.`, attribute, race)).toEqual([
      { message: "Test Monster is outside the Deck Master's Domain",
        cards: [{ section: "main", index: 0, code: 101, name: "Test Monster" }] },
    ]);
  });

  it.each([
    ["EARTH", 0x1], ["WATER", 0x2], ["FIRE", 0x4],
    ["WIND", 0x8], ["LIGHT", 0x10], ["DARK", 0x20],
  ])("admits an Attribute mentioned as %s", (attribute, bit) => {
    expect(membership(`Special Summon 1 ${attribute} monster.`, bit)).toEqual([]);
    expect(membership(`Declare "${attribute}".`, bit)).toEqual([]);
  });

  it.each([
    ["Warrior-Type", 0x1], ["Spellcaster", 0x2], ["Fairy", 0x4],
    ["Fairies", 0x4], ["Fiends", 0x8], ["Zombies", 0x10], ["Machines", 0x20],
    ["Aqua", 0x40], ["Pyro", 0x80], ["Rocks", 0x100],
    ["Winged Beast", 0x200], ["Winged Beasts", 0x200], ["Winged-Beast", 0x200],
    ["Plants", 0x400], ["Insects", 0x800], ["Thunder", 0x1000],
    ["Dragons", 0x2000], ["Beasts", 0x4000], ["Beast-Warriors", 0x8000],
    ["Dinosaurs", 0x10000], ["Fish", 0x20000], ["Fishes", 0x20000],
    ["Sea Serpent", 0x40000], ["Sea Serpents", 0x40000], ["Sea-Serpent", 0x40000],
    ["Reptiles", 0x80000], ["Psychic", 0x100000], ["Wyrms", 0x800000],
    ["Cyberse", 0x1000000], ["Illusion", 0x2000000],
  ])("admits a Type mentioned as %s", (race, bit) => {
    expect(membership(`Special Summon 1 ${race} monster.`, 0x2, bit)).toEqual([]);
  });

  it("includes Attribute and Type mentions inside token definitions", () => {
    const effect = 'Special Summon 1 "Test Token" (Winged Beast/WIND/Level 1/ATK 0/DEF 0).';
    expect(membership(effect, 0x8, 0x40)).toEqual([]);
    expect(membership(effect, 0x2, 0x200)).toEqual([]);
  });

  it.each([
    ["Beast-Warrior", 0x1], ["Beast-Warrior", 0x4000],
    ["Winged Beast", 0x4000], ["Divine-Beast", 0x4000],
  ])("does not split the compound Type %s into %i", (mention, race) => {
    expect(membership(`Target 1 ${mention} monster.`, 0x2, race)[0]?.message)
      .toContain("outside the Deck Master's Domain");
  });

  it("does not derive an Attribute or Type from a quoted card name", () => {
    expect(membership('Add 1 "DARK Dragon" card to your hand.', 0x20, 0x2000)[0]?.message)
      .toContain("outside the Deck Master's Domain");
  });

  it("does not treat the quoted Warrior archetype as the Warrior Type", () => {
    expect(membership('Add 1 "Warrior" monster to your hand.', 0x2, 0x1, 0x21,
      "!setname 0x66 Warrior\n")[0]?.message).toContain("outside the Deck Master's Domain");
  });
});
