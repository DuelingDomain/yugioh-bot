import { it } from "vitest";
import { createLegacyEngineGame } from "../../src/legacy/index.js";
import { runChainActivatorScenario, runQueuedChainActivatorScenario } from "../helpers/chain-activator.js";
import { mausoleumActivatorScenario } from "../scenarios/multiplayer/chain-activator.js";
import { describeWithCores, needs } from "../support/cores.js";

describeWithCores("live legacy chain activator", [needs.cards(), needs.scripts()], () => {
  it("credits the user of the opponent's Mausoleum, including on replay", () =>
    runChainActivatorScenario(mausoleumActivatorScenario("1v1"), createLegacyEngineGame));
  it.each([false, true])("credits queued forced links when both seats choose=%s", (bothSeatsChoose) =>
    runQueuedChainActivatorScenario(createLegacyEngineGame, bothSeatsChoose));
});
