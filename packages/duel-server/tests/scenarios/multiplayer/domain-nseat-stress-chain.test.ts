import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { DOMAIN_NSEAT_STRESS_CHAIN } from "./domain-nseat-stress-chain.js";

describeWithCores("Domain pending loss during a chain", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("multiplayer/domain-nseat-stress-chain", DOMAIN_NSEAT_STRESS_CHAIN);
});
