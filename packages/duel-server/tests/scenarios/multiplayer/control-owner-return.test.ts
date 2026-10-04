import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { CONTROL_OWNER_RETURN_SCENARIOS } from "./control-owner-return.js";

describeWithCores("Stock owner control returns", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("multiplayer/control-owner-return", CONTROL_OWNER_RETURN_SCENARIOS);
});
