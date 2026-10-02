import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { FFA_WINNER_PROOF_SCENARIOS } from "./rule-proof-ffa-winner.js";
describeWithCores("live FFA winner rule proof", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("multiplayer/rule-proof-ffa-winner", FFA_WINNER_PROOF_SCENARIOS);
});
