import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { DIRECT_RESPONSE_PROOF_SCENARIOS } from "./direct-response-proof.js";
import { domainProof } from "./proof-domain.js";
const domain = DIRECT_RESPONSE_PROOF_SCENARIOS.map(s => domainProof(s, "Dark Hole"));
describeWithCores("direct-response-proof on both cores", [liveNseat, ...needs.domainMulti()], () => runScenarios("multiplayer/direct-response-proof", [...DIRECT_RESPONSE_PROOF_SCENARIOS, ...domain]));
