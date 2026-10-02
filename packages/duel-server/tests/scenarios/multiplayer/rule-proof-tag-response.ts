import { select } from "../../support/dsl.js";
import { domainVariant } from "./domain-variants.js";
import { TAG_RESPONSE_ORDER_SCENARIOS } from "./tag-response-order.js";

// Run the response and simultaneous trigger proof in actual Domain mode,
// with a separate Deck Master at every seat and the Domain engine.
export const TAG_RESPONSE_DOMAIN_PROOF_SCENARIOS = TAG_RESPONSE_ORDER_SCENARIOS
  .map((scenario) => {
    const domain = domainVariant({ ...scenario, id: `rule-proof-${scenario.id}` });
    // Domain's first draw leaves two fillers, so Magic Jammer's cost asks which to discard.
    domain.steps = domain.steps.flatMap((step) => step.op === "activate" && step.sel === "Magic Jammer" && step.by === "p0"
      ? [step, select({ card: "Mystical Elf", owner: "p0", nth: 0 })] : [step]);
    return domain;
  });
