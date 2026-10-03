import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { LASTING_TRAP_PROOF_SCENARIOS } from "./lasting-trap-proof.js";
import { domainProof } from "./proof-domain.js";
const domain = LASTING_TRAP_PROOF_SCENARIOS.map(s => domainProof(s, "Mystical Elf"));
describeWithCores("lasting-trap-proof on both cores", [liveNseat, ...needs.domainMulti()], () => runScenarios("multiplayer/lasting-trap-proof", [...LASTING_TRAP_PROOF_SCENARIOS, ...domain]));
