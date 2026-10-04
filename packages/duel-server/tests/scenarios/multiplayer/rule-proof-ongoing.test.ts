import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { ONGOING_PROOF_SCENARIOS } from "./rule-proof-ongoing.js";

describeWithCores("Standard live FFA4 ongoing rule proof", liveNseat, () => {
  runScenarios("multiplayer/rule-proof-ongoing", ONGOING_PROOF_SCENARIOS.filter((scenario) => scenario.setup.mode !== "domain"));
});
describeWithCores("Domain live FFA4 ongoing rule proof", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("multiplayer/rule-proof-ongoing-domain", ONGOING_PROOF_SCENARIOS.filter((scenario) => scenario.setup.mode === "domain"));
});
