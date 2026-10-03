import { activate, changePhase, endTurn, expectNotOffered, expectOffered, pickOpponent, type Scenario, type Step } from "../../support/dsl.js";
import { defineScenarioWithFfaFirstDraw as defineScenario } from "./ffa-first-draw.js";
import { domainVariant } from "./domain-variants.js";
import { everySeat, SEATS } from "./seat-kit.js";
import { SOURCE } from "./nseat-scenarios.js";

const ELF = "Mystical Elf";
const SWORDS = "Swords of Revealing Light";
const setup: Scenario["setup"] = { format: "ffa4", attackFirstTurn: true };
for (const seat of SEATS.ffa4) setup[seat] = { monsters: [ELF], ...(seat === "p0" ? { hand: [SWORDS] } : {}) };
// R-COMMON-OPP-ONE: the activation declares one opponent; the initial continuous attack lock stays global.
const steps: Step[] = [activate(SWORDS, "p0"), pickOpponent("p1", "p0"), changePhase("battle", "p0"), expectOffered("attack", ELF, "p0"), endTurn("p0")];
for (const [index, seat] of SEATS.ffa4.slice(1).entries()) {
  steps.push(changePhase("battle", seat), expectNotOffered("attack", ELF, seat), everySeat("ffa4",
    Object.fromEntries(SEATS.ffa4.map((owner, i) => [owner, { monsters: [ELF],
      hand: i > 0 && i <= index + 1 ? [ELF] : [], spells: owner === "p0" ? [SWORDS] : [] }]))), endTurn(seat));
}
steps.push(everySeat("ffa4", Object.fromEntries(SEATS.ffa4.map((seat) => [seat, {
  monsters: [ELF], hand: [ELF], grave: seat === "p0" ? [SWORDS] : [],
}]))));
const standard = defineScenario({
  id: "rule-proof-ongoing-ffa4-three-opponents", title: "FFA4: Swords stops each of the three opponents for its full three-turn count",
  source: `${SOURCE} [R-COMMON-ONGOING]`, rules: ["R-COMMON-ONGOING"], tags: ["multiplayer", "ffa4", "card:72302403"], setup, steps,
});
export const ONGOING_PROOF_SCENARIOS = [standard, domainVariant(standard)];
