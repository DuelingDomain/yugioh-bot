import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { LOCK_CONTROL_REAL_CARD_SCENARIOS } from "./lock-control-real-card.js";

describeWithCores("Real card lock control change", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("multiplayer/lock-control-real-card", LOCK_CONTROL_REAL_CARD_SCENARIOS);
});
