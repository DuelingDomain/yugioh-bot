import { describe, expect, it } from "vitest";
import { OcgLocation, OcgMessageType, type OcgMessage } from "ocgcore-wasm";
import type { CardDatabase } from "../src/cards.js";
import { LOCATION_DECKMASTER } from "../src/domain-core.js";
import { mapPrompt, resolveAnswer } from "../src/prompts.js";
import { mapPrompt as legacyMapPrompt, resolveAnswer as legacyResolveAnswer } from "../src/legacy/prompts.js";

const CODE = 48305365;
const cards: CardDatabase = {
  search: () => [], deckCard: () => undefined, all: () => [], setnames: () => new Map(),
  get: code => ({ code, name: `Card ${code}`, description: "", type: 1, attack: 1000, defense: 1000, level: 4, attribute: 1, race: "warrior" }),
  cardData: () => null, resolveLabel: () => "", system: () => undefined,
  victory: () => undefined, counter: () => undefined, readScript: () => null, close() {},
};
function message(player = 0): Extract<OcgMessage, { type: OcgMessageType.SELECT_IDLECMD }> {
  // The multi protocol extends the wrapper's stock two-seat controller type.
  const master = { code: CODE, controller: player as 0 | 1, location: 0 as OcgLocation, sequence: 0 };
  return { type: OcgMessageType.SELECT_IDLECMD, player, summons: [master], special_summons: [master],
    monster_sets: [master], activates: [{ ...master, description: 0n, client_mode: 0 }], pos_changes: [], spell_sets: [],
    to_bp: false, to_ep: true, shuffle: false };
}
for (const [name, map, answer] of [["pinned and multi", mapPrompt, resolveAnswer], ["legacy", legacyMapPrompt, legacyResolveAnswer]] as const) {
  describe(`Deck Master action cost copy (${name})`, () => {
    it.each([0, 500, 1000])("shows %i LP on each DMZ action and keeps native response indices", cost => {
      const native = message();
      const pending = map(native, cards, "idle", undefined, { domain: [{ code: CODE, inZone: true, returns: cost / 500, nextCost: cost }] });
      for (const [prefix, action] of [["summon", 0], ["spsummon", 1], ["mset", 3], ["activate", 5]] as const) {
        const option = pending.prompt.options.find(option => option.id === `${prefix}:0`)!;
        expect(option.label).toContain(`costs ${cost} LP`);
        expect(option.location).toBe(LOCATION_DECKMASTER);
        expect(answer(pending, 0, "idle", { choice: option.id }, cards)).toMatchObject({ action, index: 0 });
      }
      expect(native.summons[0].location).toBe(0);
      expect(pending.prompt.options.find(option => option.id === "to_ep")?.label).toBe("End Phase");
    });

    it("uses the acting seat's public cost for seats 2 and 3", () => {
      for (const seat of [2, 3]) {
        const domain = Array.from({ length: 4 }, (_, index) => ({ code: CODE, inZone: true, returns: index, nextCost: index * 500 }));
        const pending = map(message(seat), cards, "idle", undefined, { domain });
        expect(pending.prompt.options[0].label).toContain(`costs ${seat * 500} LP`);
      }
    });

    it("keeps ordinary actions and cards outside the DMZ free of DMZ cost text", () => {
      const native = message();
      const master = native.summons[0];
      native.summons = [{ ...master, location: OcgLocation.HAND }, { ...master, code: 123 }, { ...master, sequence: 1 }];
      const domain = [{ code: CODE, inZone: true, returns: 2, nextCost: 1000 }];
      const pending = map(native, cards, "idle", undefined, { domain });
      expect(pending.prompt.options.filter(option => option.id.startsWith("summon:")).every(option => !option.label.includes("costs"))).toBe(true);
      domain[0].inZone = false;
      expect(map(message(), cards, "left", undefined, { domain }).prompt.options.every(option => !option.label.includes("costs"))).toBe(true);
      expect(map(message(), cards, "standard").prompt.options.every(option => !option.label.includes("costs"))).toBe(true);
    });

    it("names both summon and activation costs in the recall description", () => {
      const card = cards.get(CODE)!;
      const prompt = map({ type: OcgMessageType.SELECT_YESNO, player: 0, description: 1n }, cards, "recall", undefined,
        { recall: { card, returns: 1, nextCost: 1000 } }).prompt;
      expect(prompt.context).toMatchObject({ type: "deck-master-recall", returns: 1, nextCost: 1000 });
      expect(prompt.description).toBe("Next summon or activation from the Deck Master Zone costs 1000 LP.");
    });
  });
}
