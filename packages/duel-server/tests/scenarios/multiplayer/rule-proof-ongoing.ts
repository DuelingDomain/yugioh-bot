import {
  activate, changePhase, defineScenario, endTurn, expectNotOffered, expectOffered,
  expectPrompt, type Scenario, type Step,
} from "../../support/dsl.js";
import { domainVariant } from "./domain-variants.js";
import { everySeat, SEATS, type Seat } from "./seat-kit.js";
import { SOURCE } from "./nseat-scenarios.js";

const MONSTER = "Battle Ox";
const FILLER = "Mystical Elf";
const LOCK = "Gravity Bind";
const REMOVE = "Mystical Space Typhoon";
const setup: Scenario["setup"] = {
  format: "ffa4", attackFirstTurn: true,
  // The removal Spell is the next p0 draw. Domain adds its opening filler draw.
  // It opens no earlier optional window.
  p0: {
    monsters: [MONSTER], spells: [{ card: LOCK, pos: "set" }],
    deck: [REMOVE],
  },
};
for (const seat of SEATS.ffa4.slice(1)) setup[seat] = { monsters: [MONSTER] };
const drawn: Record<Seat, number> = { p0: 0, p1: 0, p2: 0, p3: 0 };
function board(locked: boolean): Step {
  return everySeat("ffa4", Object.fromEntries(SEATS.ffa4.map((seat) => [seat, {
    hand: Array<string>(drawn[seat] - (seat === "p0" && !locked ? 1 : 0)).fill(FILLER),
    deckCount: 20 - drawn[seat], monsters: [MONSTER],
    spells: seat === "p0" && locked ? [LOCK] : [],
    grave: seat === "p0" && !locked ? [REMOVE, LOCK] : [],
    banished: [], extra: [],
  }])));
}
const steps: Step[] = [];
// The continuous Level restriction applies to each seat, including the activator.
for (const seat of SEATS.ffa4) {
  if (seat !== "p0") drawn[seat]++;
  if (seat === "p0") steps.push(activate(LOCK, "p0"));
  steps.push(expectPrompt({ by: seat, context: "action" }), changePhase("battle", seat),
    expectNotOffered("attack", MONSTER, seat), board(true), endTurn(seat));
}
// A real Spell destroys the lock. Every formerly locked seat gets an attack offer.
for (const [index, seat] of SEATS.ffa4.entries()) {
  drawn[seat]++;
  if (seat === "p0") steps.push(activate(REMOVE, "p0"));
  steps.push(expectPrompt({ by: seat, context: "action" }), changePhase("battle", seat),
    expectOffered("attack", MONSTER, seat), board(false));
  if (index < SEATS.ffa4.length - 1) steps.push(endTurn(seat));
}
const standard = defineScenario({
  id: "rule-proof-ongoing-ffa4-three-opponents",
  title: "FFA4: Gravity Bind locks all four seats, and its destruction restores every attack offer",
  source: SOURCE + " [R-COMMON-ONGOING]", rules: ["R-COMMON-ONGOING"],
  tags: ["multiplayer", "ffa4", "card:85742772", "card:5318639"], setup, steps,
});
const domain = structuredClone(domainVariant(standard));
for (const step of domain.steps) {
  if (step.op !== "expectBoard") continue;
  for (const seat of SEATS.ffa4) {
    step.board[seat] = { ...step.board[seat], deckMaster: { inZone: true, returns: 0, nextCost: 0 } };
  }
}
export const ONGOING_PROOF_SCENARIOS = [standard, domain];
