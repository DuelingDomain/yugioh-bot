import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { FFA_LP_PROOF_SCENARIOS } from "./rule-proof-ffa-lp.js";
describeWithCores("live FFA LP rule proof", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("multiplayer/rule-proof-ffa-lp", FFA_LP_PROOF_SCENARIOS);
});
