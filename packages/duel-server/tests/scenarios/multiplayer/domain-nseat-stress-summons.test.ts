import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { DOMAIN_NSEAT_STRESS_SUMMONS } from "./domain-nseat-stress-summons.js";

describeWithCores("Domain summon methods at late seats", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("multiplayer/domain-nseat-stress-summons", DOMAIN_NSEAT_STRESS_SUMMONS);
});
