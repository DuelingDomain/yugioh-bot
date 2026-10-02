import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { DOMAIN_NSEAT_STRESS } from "./domain-nseat-stress.js";

describeWithCores("Domain n-seat stress on the live core", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("multiplayer/domain-nseat-stress", DOMAIN_NSEAT_STRESS);
});
