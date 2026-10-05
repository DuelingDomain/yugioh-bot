import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { CHAIN_ORDER_CONTROL_SCENARIOS, FFA_CHAIN_PROOF_SCENARIOS } from "./rule-proof-ffa-chain.js";
describeWithCores("live FFA chain rule proof", [liveNseat, ...needs.domainMulti(), needs.standard(), needs.domain()], () => {
  runScenarios("multiplayer/rule-proof-ffa-chain", FFA_CHAIN_PROOF_SCENARIOS);
  runScenarios("multiplayer/chain-order-controls", CHAIN_ORDER_CONTROL_SCENARIOS);
});
