import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { domainVariant } from "./domain-variants.js";
import { CONTROLLER_TURN_REVIEW_SCENARIOS } from "./controller-turn-review.js";
describeWithCores("live controller turn Standard", liveNseat, () => {
  runScenarios("multiplayer/controller-turn-review", CONTROLLER_TURN_REVIEW_SCENARIOS);
});
describeWithCores("live controller turn Domain", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("multiplayer/controller-turn-review-domain", CONTROLLER_TURN_REVIEW_SCENARIOS.map(scenario => {
    const variant = domainVariant(scenario);
    if (scenario.id.endsWith("exchanged-dark-snake")) variant.steps.splice(1, 0, { op: "select", sels: [{ card: "Mystical Elf", owner: "p0", nth: 0 }], by: "p1" });
    return variant;
  }));
});
