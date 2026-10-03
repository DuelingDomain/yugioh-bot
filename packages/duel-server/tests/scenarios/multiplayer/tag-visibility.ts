import { defineScenario, endTurn, expectPrivateCards, setCard, type Scenario, type Step } from "../../support/dsl.js";
import { domainVariant } from "./domain-variants.js";
import { everySeat, PARTNER, SEATS, type Seat } from "./seat-kit.js";
import { SOURCE } from "./nseat-scenarios.js";

const hands = ["Battle Ox", "Axe Raider", "Silver Fang", "Beaver Warrior"];
const monsters = ["Mystical Elf", "Giant Soldier of Stone", "Celtic Guardian", "Hitotsu-Me Giant"];
const spells = ["Dark Hole", "Raigeki", "Fissure", "Hammer Shot"];
const setup: Scenario["setup"] = { format: "tag" };
const steps: Step[] = [];
for (const [index, seat] of SEATS.tag.entries()) {
  setup[seat] = { hand: [hands[index], monsters[index], spells[index]] };
  steps.push(setCard(monsters[index], seat), setCard(spells[index], seat));
  if (seat !== "p3") steps.push(endTurn(seat));
}
steps.push(everySeat("tag", Object.fromEntries(SEATS.tag.map((seat, index) => [seat, {
  hand: [hands[index], ...(seat === "p0" ? [] : ["Mystical Elf"])],
  monsters: [monsters[index]], spells: [spells[index]],
  zones: { m0: { card: monsters[index], pos: "set" }, s0: { card: spells[index], pos: "set" } },
}]))));
steps.push(expectPrivateCards(SEATS.tag.flatMap((seat, index) => {
  const visibleTo: Seat[] = [seat, PARTNER[seat]];
  return [
    { owner: seat, from: "hand" as const, seq: 0, card: hands[index], visibleTo },
    { owner: seat, from: "mzone" as const, seq: 0, card: monsters[index], visibleTo },
    { owner: seat, from: "szone" as const, seq: 0, card: spells[index], visibleTo },
    ...(seat === "p0" ? [] : [{ owner: seat, from: "hand" as const, seq: 1, card: "Mystical Elf", visibleTo }]),
  ];
})));
const standard = defineScenario({
  id: "tag-visibility-all-four-seats-after-live-sets", title: "Tag: every seat sees its partner hand and Set cards, and all opponents see only hidden cards",
  source: `${SOURCE} [R-TAG-VISIBILITY]`, rules: ["R-TAG-VISIBILITY"], tags: ["multiplayer", "tag", "privacy"], setup, steps,
});
export const TAG_VISIBILITY_SCENARIOS: Scenario[] = [standard, domainVariant(standard)];
