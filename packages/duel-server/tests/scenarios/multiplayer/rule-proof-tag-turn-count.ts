import { domainVariant } from "./domain-variants.js";
import { TURN_COUNT_SCENARIOS } from "./turn-count.js";

// Both teams play Final Countdown through all 20 End Phases. Each original
// case checks the state of all four seats before and after the result.
// This proves the engine rule. The host forbidden-list proof rejects this card.
export const TAG_TURN_COUNT_DOMAIN_PROOF_SCENARIOS = TURN_COUNT_SCENARIOS
  .filter((scenario) => scenario.setup.format === "tag")
  .map((scenario) => domainVariant({ ...scenario, id: `rule-proof-${scenario.id}` }));
