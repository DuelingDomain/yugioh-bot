import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { DF_FIRST_BATTLE_PHASE_SCENARIOS } from "./df-first-battle-phase.js";

describeWithCores("live first Battle Phase", [liveNseat, ...needs.domainMulti(), needs.standard(), needs.domain()], () => {
  runScenarios("multiplayer/df-first-battle-phase", DF_FIRST_BATTLE_PHASE_SCENARIOS);
});
