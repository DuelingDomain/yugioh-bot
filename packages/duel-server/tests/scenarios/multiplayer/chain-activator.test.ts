import { createEngineGame } from "../../../src/engine.js";
import { it } from "vitest";
import { runChainActivatorScenario, runQueuedChainActivatorScenario } from "../../helpers/chain-activator.js";
import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { nseatWasmBinary } from "../../support/session.js";
import { CHAIN_ACTIVATOR_SCENARIOS } from "./chain-activator.js";

describeWithCores("live FFA chain activator", [liveNseat, needs.cards(), needs.scripts()], () => {
  runScenarios("multiplayer/chain-activator", CHAIN_ACTIVATOR_SCENARIOS,
    (scenario) => runChainActivatorScenario(scenario, createEngineGame, nseatWasmBinary()));
});

describeWithCores("live queued chain activators", [needs.standard(), needs.cards(), needs.scripts()], () => {
  it.each([false, true])("credits queued forced links when both seats choose=%s", (bothSeatsChoose) =>
    runQueuedChainActivatorScenario(createEngineGame, bothSeatsChoose));
});
