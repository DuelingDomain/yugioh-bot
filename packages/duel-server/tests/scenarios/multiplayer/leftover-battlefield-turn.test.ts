import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { domainVariant } from "./domain-variants.js";
import { LEFTOVER_BATTLEFIELD_TURN_SCENARIOS } from "./leftover-battlefield-turn.js";
describeWithCores("leftover Battlefield Standard", liveNseat, () => runScenarios("leftover/battlefield", LEFTOVER_BATTLEFIELD_TURN_SCENARIOS));
describeWithCores("leftover Battlefield Domain", [liveNseat, ...needs.domainMulti()], () => runScenarios("leftover/battlefield-domain", LEFTOVER_BATTLEFIELD_TURN_SCENARIOS.map(domainVariant)));
