import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { LOCAL_CONTROLLER_LP_SCENARIOS } from "./local-controller-lp.js";
describeWithCores("live local controller LP outcomes",liveNseat,()=>{runScenarios("multiplayer/local-controller-lp",LOCAL_CONTROLLER_LP_SCENARIOS);});
