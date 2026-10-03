import { attack, changePhase, defineScenario, endTurn, expectPrompt, expectTurn, type Scenario, type Step } from "../../support/dsl.js";
import { domainVariant } from "./domain-variants.js";
import { everySeat, SEATS } from "./seat-kit.js";
import { SOURCE } from "./nseat-scenarios.js";

const ELF = "Mystical Elf";
const steps: Step[] = [];
for (const [index, actor] of SEATS.tag.entries()) {
  steps.push(expectTurn(actor, index + 1), expectPrompt({ by: actor,
    ...(index === 3 ? { offers: ["to_bp"] } : { notOffers: ["to_bp"] }) }),
  everySeat("tag", Object.fromEntries(SEATS.tag.map((seat, i) => [seat, {
    hand: i > 0 && i <= index ? [ELF] : [], deckCount: i > 0 && i <= index ? 19 : 20, monsters: [ELF],
  }]))));
  if (index < 3) steps.push(endTurn(actor));
}
steps.push(changePhase("battle", "p3"), attack(ELF, { card: ELF, owner: "p0" }, "p3"),
  everySeat("tag", Object.fromEntries(SEATS.tag.map((seat, i) => [seat, {
    hand: i ? [ELF] : [], deckCount: i ? 19 : 20,
    monsters: seat === "p0" || seat === "p3" ? [] : [ELF], grave: seat === "p0" || seat === "p3" ? [ELF] : [],
  }]))));
const standard: Scenario = defineScenario({ id: "rule-proof-tag-clockwise-order-draw-and-first-battle",
  title: "Tag: all four members take turns, only the first skips the draw, and p3 plays the first battle",
  source: `${SOURCE} [R-TAG-ORDER]`, rules: ["R-TAG-ORDER"], tags: ["multiplayer", "tag", "turn-order", "battle"],
  setup: { format: "tag", p0: { monsters: [ELF] }, p1: { monsters: [ELF] }, p2: { monsters: [ELF] }, p3: { monsters: [ELF] } }, steps });
export const TAG_ORDER_PROOF_SCENARIOS = [standard, domainVariant(standard)];
