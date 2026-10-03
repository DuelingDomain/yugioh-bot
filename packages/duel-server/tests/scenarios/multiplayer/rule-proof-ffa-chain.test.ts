import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { FFA_CHAIN_PROOF_SCENARIOS } from "./rule-proof-ffa-chain.js";
describeWithCores("live FFA chain rule proof", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("multiplayer/rule-proof-ffa-chain", FFA_CHAIN_PROOF_SCENARIOS);
});
