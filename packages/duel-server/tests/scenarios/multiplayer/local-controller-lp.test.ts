import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { LOCAL_CONTROLLER_LP_SCENARIOS } from "./local-controller-lp.js";
describeWithCores("live local controller LP outcomes",liveNseat,()=>{runScenarios("multiplayer/local-controller-lp",LOCAL_CONTROLLER_LP_SCENARIOS);});

// The partner control runs in a real Domain Tag duel with a master at each seat.
import { domainVariant } from "./domain-variants.js";
describeWithCores("Domain Tag Blazing Mirror Force partner controls", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("multiplayer/local-controller-lp-domain-partner", LOCAL_CONTROLLER_LP_SCENARIOS
    .filter(scenario => scenario.setup.format === "tag" && scenario.tags.includes("card:75249652"))
    .map(domainVariant));
});
