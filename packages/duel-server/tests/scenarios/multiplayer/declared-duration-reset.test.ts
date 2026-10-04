import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { DECLARED_DURATION_RESET_SCENARIOS } from "./declared-duration-reset.js";
import { domainVariant } from "./domain-variants.js";

describeWithCores("Declared duration reset", liveNseat, () => {
  runScenarios("multiplayer/declared-duration-reset", DECLARED_DURATION_RESET_SCENARIOS);
});

describeWithCores("Domain declared duration reset", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("multiplayer/declared-duration-reset-domain", DECLARED_DURATION_RESET_SCENARIOS.map(domainVariant));
});
