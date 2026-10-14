import { describe, expect, it } from "vitest";
import { resolveCard } from "../../src/presets/catalog.js";
import { gameFor, variants, waiting } from "./helpers.js";

// An Extra Deck monster as Deck Master has no Normal Summon or Set. Its own summon mechanic (or a Fusion Spell) is the way out.
const CASES = [
  { name: "Synchro", master: "Stardust Dragon", board: { monsters: ["Flamvell Guard", "Dark Magician"] }, offered: "spsummon:" },
  { name: "Xyz", master: "Number 39: Utopia", board: { monsters: ["Mystical Elf", "Mystical Elf"] }, offered: "spsummon:" },
  { name: "Link", master: "Link Spider", board: { monsters: ["Mystical Elf"] }, offered: "spsummon:" },
  { name: "Fusion", master: "Flame Swordsman", board: { hand: ["Polymerization"], monsters: ["Flame Manipulator", "Masaki the Legendary Swordsman"] }, offered: "activate:" },
];

for (const variant of variants) describe(`Domain Extra Deck Master offers (${variant.name})`, () => {
  for (const test of CASES) it(`${test.name} Deck Master: no Normal Summon or Set, only its own mechanic`, async () => {
    const game = await gameFor(variant, { masterRule: variant.format === "1v1" ? 4 : 5, p0: { deckMaster: test.master, ...test.board } });
    const options = waiting(game).options;
    const master = resolveCard(test.master);
    const offered = (prefix: string, code = master) => options.some(option => option.id.startsWith(prefix) && option.card?.code === code);
    expect(offered("summon:")).toBe(false);
    expect(offered("mset:")).toBe(false);
    expect(offered("set:")).toBe(false);
    if (test.offered === "spsummon:") expect(offered("spsummon:")).toBe(true);
    else {
      expect(offered("spsummon:")).toBe(false);
      expect(offered("activate:", resolveCard("Polymerization"))).toBe(true);
    }
    expect(game.view(0).seats[0].deckMaster?.inZone).toBe(true);
  });
});
