import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { DOMAIN_NSEAT_STRESS_TARGETS } from "./domain-nseat-stress-targets.js";

describeWithCores("Domain zone masters are not attack targets", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("multiplayer/domain-nseat-stress-targets", DOMAIN_NSEAT_STRESS_TARGETS);
});
