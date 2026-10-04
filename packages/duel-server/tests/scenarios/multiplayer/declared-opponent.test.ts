import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { DECLARED_OPPONENT_SCENARIOS } from "./declared-opponent.js";
import { domainProof } from "./proof-domain.js";
const domain = DECLARED_OPPONENT_SCENARIOS.map(s => domainProof(s, "Mystical Elf"));
describeWithCores("declared-opponent on both cores", [liveNseat, ...needs.domainMulti()], () => runScenarios("multiplayer/declared-opponent", [...DECLARED_OPPONENT_SCENARIOS, ...domain]));
