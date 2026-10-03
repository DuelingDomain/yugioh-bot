import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { DOMAIN_NSEAT_STRESS_CONTROL } from "./domain-nseat-stress-control.js";

describeWithCores("Domain control, count, and Deck loss at all seats", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("multiplayer/domain-nseat-stress-control", DOMAIN_NSEAT_STRESS_CONTROL);
});
