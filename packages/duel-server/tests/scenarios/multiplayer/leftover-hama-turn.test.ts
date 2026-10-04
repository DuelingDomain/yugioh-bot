import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { domainVariant } from "./domain-variants.js";
import { LEFTOVER_HAMA_TURN_SCENARIOS } from "./leftover-hama-turn.js";
describeWithCores("leftover Hama Standard", liveNseat, () => runScenarios("leftover/hama", LEFTOVER_HAMA_TURN_SCENARIOS));
describeWithCores("leftover Hama Domain", [liveNseat, ...needs.domainMulti()], () => runScenarios("leftover/hama-domain", LEFTOVER_HAMA_TURN_SCENARIOS.map(domainVariant)));
