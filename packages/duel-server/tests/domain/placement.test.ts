import assert from "node:assert/strict";
import { describe, expect, it } from "vitest";
import type { DuelMasterRule } from "@yugidraft/shared/duels";
import type { EngineGame } from "../../src/engine.js";
import { resolveCard } from "../../src/presets/catalog.js";
import { defaultAnswer, gameFor, idle, respond, settle, variants, waiting } from "./helpers.js";

function places(game: EngineGame, code: number, prefix = "activate:"): number[] {
  const prompt = waiting(game);
  const option = prompt.options.find(option => option.card?.code === code && option.id.startsWith(prefix));
  assert(option, `Missing ${prefix}${code}: ${JSON.stringify(prompt)}`);
  respond(game, { choice: option.id });
  for (let step = 0; step < 40; step++) {
    const prompt = waiting(game);
    if (prompt.kind === "places" && prompt.options.every(option => option.location === 4)) return prompt.options.map(option => option.sequence!).sort((a, b) => a - b);
    assert(!idle(prompt), `Summon ended without placement: ${JSON.stringify(prompt)}`);
    respond(game, defaultAnswer(prompt));
  }
  throw new Error("Did not reach placement");
}
function putIn(game: EngineGame, sequence: number): void {
  const place = waiting(game).options.find(option => option.sequence === sequence);
  assert(place, `Zone ${sequence} was not offered`);
  respond(game, { selected: [place.id] });
  settle(game);
}
for (const variant of variants) describe(`Domain Extra DM placement (${variant.name})`, () => {
  const rules: DuelMasterRule[] = variant.format === "1v1" ? [1, 2, 3, 4, 5] : [5];
  for (const masterRule of rules) {
    it(`MR${masterRule}: a non-Link DM can use every available MMZ and EMZ`, async () => {
      const game = await gameFor(variant, { masterRule, p0: { deckMaster: "Flame Swordsman", hand: ["Instant Fusion"] } });
      expect(places(game, resolveCard("Instant Fusion"))).toEqual(masterRule >= 4 ? [0, 1, 2, 3, 4, 5, 6] : [0, 1, 2, 3, 4]);
      putIn(game, 2);
      expect(game.view(0).seats[0].monsters[2]?.code).toBe(resolveCard("Flame Swordsman"));
    });
    if (masterRule < 4) it(`MR${masterRule}: a Link DM cannot summon without a pointed-to Main Monster Zone`, async () => {
      const game = await gameFor(variant, { masterRule, p0: { deckMaster: "Link Spider", monsters: ["Mystical Elf"] } });
      expect(waiting(game).options.some(option => option.id.startsWith("spsummon:") && option.card?.code === resolveCard("Link Spider"))).toBe(false);
    });
    if (masterRule === 3) it("MR3: a Link DM cannot use arrows from its consumed material", async () => {
      const game = await gameFor(variant, { masterRule, p0: { deckMaster: "LANphorhynchus", monsters: ["Mystical Elf", null, "Proxy Dragon"] } });
      expect(waiting(game).options.some(option => option.id.startsWith("spsummon:") && option.card?.code === resolveCard("LANphorhynchus"))).toBe(false);
    });
    it(`MR${masterRule}: a Link DM requires an EMZ or a MMZ pointed to by a Link Monster`, async () => {
      const game = await gameFor(variant, { masterRule, p0: { deckMaster: "Link Spider", monsters: ["Mystical Elf", null, "Proxy Dragon"] } });
      expect(places(game, resolveCard("Link Spider"), "spsummon:")).toEqual(masterRule >= 4 ? [1, 3, 5, 6] : [1, 3]);
      putIn(game, 1);
      expect(game.view(0).seats[0].monsters[1]?.code).toBe(resolveCard("Link Spider"));
    });
  }
  if (variant.format === "1v1") it("MR4: an ordinary Extra Deck Fusion still requires an EMZ or linked MMZ", async () => {
    const game = await gameFor(variant, { masterRule: 4, p0: { extra: ["Flame Swordsman"], hand: ["Instant Fusion"] } });
    expect(places(game, resolveCard("Instant Fusion"))).toEqual([5, 6]);
  });
});

for (const variant of variants) describe(`Domain other Extra DM mechanics (${variant.name})`, () => {
  for (const masterRule of (variant.format === "1v1" ? [4, 5] : [5]) as DuelMasterRule[]) {
    for (const [master, materials] of [
      ["Stardust Dragon", ["Flamvell Guard", "Dark Magician"]],
      ["Number 39: Utopia", ["Mystical Elf", "Mystical Elf"]],
    ] as const) it(`MR${masterRule}: ${master} can use any Main Monster Zone`, async () => {
      const game = await gameFor(variant, { masterRule, p0: { deckMaster: master, monsters: [...materials] } });
      expect(places(game, resolveCard(master), "spsummon:")).toEqual([0, 1, 2, 3, 4, 5, 6]);
      putIn(game, 2);
      expect(game.view(0).seats[0].monsters[2]?.code).toBe(resolveCard(master));
    });
  }
});
