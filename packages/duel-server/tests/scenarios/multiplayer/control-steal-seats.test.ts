import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { CONTROL_STEAL_SEAT_SCENARIOS } from "./control-steal-seats.js";

describeWithCores("Control changes at every seat", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("multiplayer/control-steal-seats", CONTROL_STEAL_SEAT_SCENARIOS);
});
