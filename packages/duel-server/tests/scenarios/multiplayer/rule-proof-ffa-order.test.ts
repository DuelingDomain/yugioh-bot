import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { FFA_ORDER_PROOF_SCENARIOS, FIRST_DRAW_CONTROL_SCENARIOS } from "./rule-proof-ffa-order.js";
describeWithCores("live FFA turn order rule proof", [liveNseat, ...needs.domainMulti(), needs.standard(), needs.domain()], () => {
  runScenarios("multiplayer/rule-proof-ffa-order", FFA_ORDER_PROOF_SCENARIOS);
  runScenarios("multiplayer/first-draw-controls", FIRST_DRAW_CONTROL_SCENARIOS);
});
