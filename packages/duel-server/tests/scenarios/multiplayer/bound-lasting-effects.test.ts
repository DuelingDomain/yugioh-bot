import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { BOUND_LASTING_SCENARIOS } from "./bound-lasting-effects.js";
import { domainProof } from "./proof-domain.js";
const domain = BOUND_LASTING_SCENARIOS.map(s => domainProof(s, "Mystical Elf"));
describeWithCores("bound-lasting-effects on both cores", [liveNseat, ...needs.domainMulti()], () => runScenarios("multiplayer/bound-lasting-effects", [...BOUND_LASTING_SCENARIOS, ...domain]));
