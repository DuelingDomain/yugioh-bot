import { activate, attack, endTurn, expectEliminated, expectNotOffered, expectPickOptions, expectPrompt, select, zone, type Scenario } from "../../support/dsl.js";
import { defineScenarioWithFfaFirstDraw as defineScenario } from "./ffa-first-draw.js";
import { baseSetup, everySeat } from "./seat-kit.js";
const SHALLOW = "The Shallow Grave", ENKINDLING = "The Grave of Enkindling";
const shallowEmpty = defineScenario({
  id: "leftover-shallow-tag-partner-only-grave-not-legal",
  title: "Tag: The Shallow Grave needs a target in the activator's own Graveyard",
  source: "docs/adr/0002-multiplayer-duel-rules.md [R-COMMON-EACH-PLAYER]", rules: ["R-COMMON-EACH-PLAYER"],
  tags: ["multiplayer", "tag", "card:43434803"],
  setup: baseSetup("tag", { p0: { hand: [SHALLOW] }, p1: { grave: ["Battle Ox"] }, p2: { grave: ["Silver Fang"] } }),
  steps: [expectPrompt({ by: "p0", context: "action" }), expectNotOffered("activate", SHALLOW, "p0"),
    everySeat("tag", { p0: { hand: [SHALLOW] }, p1: { grave: ["Battle Ox"] }, p2: { grave: ["Silver Fang"] } })],
});
const shallowDead = defineScenario({
  id: "leftover-shallow-ffa4-skips-eliminated-positive-lp-seat",
  title: "FFA4: The Shallow Grave asks only living duelists after p2 surrenders",
  source: "docs/adr/0002-multiplayer-duel-rules.md [R-COMMON-EACH-PLAYER] [R-FFA-ELIMINATION]", rules: ["R-COMMON-EACH-PLAYER", "R-FFA-ELIMINATION"],
  tags: ["multiplayer", "ffa4", "card:43434803"],
  setup: baseSetup("ffa4", { p0: { grave: ["Celtic Guardian", "Beaver Warrior"] }, p1: { hand: [SHALLOW], grave: ["Battle Ox", "Axe Raider"] }, p2: { grave: ["Silver Fang"] }, p3: { grave: ["Mystical Elf", "Neo the Magic Swordsman"] } }),
  steps: [{ op: "surrender", seat: "p2" }, endTurn("p0"), expectEliminated("p2"), activate(SHALLOW, "p1"), zone("p1", "s0", "p1"),
    expectPickOptions([{ seat: "p1", card: "Battle Ox" }, { seat: "p1", card: "Axe Raider" }], "p1"), select("Battle Ox"),
    expectPickOptions([{ seat: "p3", card: "Mystical Elf" }, { seat: "p3", card: "Neo the Magic Swordsman" }], "p3"), select("Mystical Elf"),
    expectPickOptions([{ seat: "p0", card: "Celtic Guardian" }, { seat: "p0", card: "Beaver Warrior" }], "p0"), select("Celtic Guardian"),
    expectPrompt({ by: "p1", context: "action" }), everySeat("ffa4", { p0: { monsters: ["Celtic Guardian"], grave: ["Beaver Warrior"] }, p1: { monsters: ["Battle Ox"], grave: ["Axe Raider", SHALLOW], hand: ["Mystical Elf"] }, p2: { deckCount: 0 }, p3: { monsters: ["Mystical Elf"], grave: ["Neo the Magic Swordsman"] } })],
});
const enkindlingEmpty = defineScenario({
  id: "leftover-enkindling-tag-partner-only-grave-not-legal",
  title: "Tag: Grave of Enkindling has no legal own target after a stolen monster dies",
  source: "docs/adr/0002-multiplayer-duel-rules.md [R-COMMON-EACH-PLAYER] [R-COMMON-SEP-FIELDS]", rules: ["R-COMMON-EACH-PLAYER", "R-COMMON-SEP-FIELDS"],
  tags: ["multiplayer", "tag", "card:84136000"],
  setup: baseSetup("tag", { p0: { hand: ["Snatch Steal"], spells: [{ card: ENKINDLING, pos: "set" }] }, p1: { monsters: ["Skull Servant", "Luster Dragon"] }, p2: { grave: ["Silver Fang"] }, p3: { grave: ["Battle Ox"] } }),
  steps: [activate("Snatch Steal", "p0"), select({ card: "Skull Servant", owner: "p1" }), endTurn("p0"),
    attack("Luster Dragon", { card: "Skull Servant", owner: "p0" }, "p1"), expectPrompt({ by: "p1", context: "action" }),
    everySeat("tag", { p0: { lp: 14400, spells: [ENKINDLING], grave: ["Snatch Steal"] }, p1: { lp: 17000, monsters: ["Luster Dragon"], grave: ["Skull Servant"] }, p2: { grave: ["Silver Fang"] }, p3: { grave: ["Battle Ox"] } })],
});
export const LEFTOVER_REVIVAL_ELIGIBILITY_SCENARIOS: Scenario[] = [shallowEmpty, shallowDead, enkindlingEmpty];
