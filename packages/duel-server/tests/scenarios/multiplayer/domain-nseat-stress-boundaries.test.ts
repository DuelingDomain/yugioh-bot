import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { DOMAIN_NSEAT_STRESS_BOUNDARIES } from "./domain-nseat-stress-boundaries.js";

describeWithCores("Domain summon filter and partner material limits", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("multiplayer/domain-nseat-stress-boundaries", DOMAIN_NSEAT_STRESS_BOUNDARIES);
});
