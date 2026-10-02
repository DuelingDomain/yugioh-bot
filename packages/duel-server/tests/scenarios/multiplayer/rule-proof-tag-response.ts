import { domainVariant } from "./domain-variants.js";
import { TAG_RESPONSE_ORDER_SCENARIOS } from "./tag-response-order.js";

// Run the response and simultaneous trigger proof in actual Domain mode,
// with a separate Deck Master at every seat and the Domain engine.
export const TAG_RESPONSE_DOMAIN_PROOF_SCENARIOS = TAG_RESPONSE_ORDER_SCENARIOS
  .map((scenario) => domainVariant({ ...scenario, id: `rule-proof-${scenario.id}` }));
