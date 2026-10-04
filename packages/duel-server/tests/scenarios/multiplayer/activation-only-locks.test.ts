import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { ACTIVATION_ONLY_LOCK_SCENARIOS } from "./activation-only-locks.js";
import { createEngineGame } from "../../../src/engine.js";
import { compileBoard } from "../../support/board.js";
import { Session, nseatWasmBinary, domainNseatWasmBinary } from "../../support/session.js";
import { engineDataDirectory } from "../../engine-data-dir.js";
import type { Scenario } from "../../support/dsl.js";

async function runWithFinalChains(scenario: Scenario): Promise<void> {
  const compiled = compileBoard(scenario.setup);
  const game = await createEngineGame({ ...compiled.options, dataDirectory: engineDataDirectory,
    multiWasmBinary: scenario.setup.mode === "domain" ? domainNseatWasmBinary() : nseatWasmBinary(), seed: ["1", "2", "3", "4"] });
  try {
    const session = new Session(scenario, game);
    session.reachMainPhase(); session.startRecording();
    scenario.steps.forEach((step, index) => {
      // After the explicit attack response proof, decline the routine damage-step
      // windows. The activation pick and the spared-seat prompts were asserted above.
      if (step.op === "expectPrompt" && scenario.steps[index + 1]?.op === "expectBoard") {
        for (let guard = 0; guard < 40; guard++) {
          const open = Array.from({ length: compiled.options.decks.length }, (_, seat) =>
            ({ seat, prompt: game.view(seat).prompt })).find(row => row.prompt);
          if (!open?.prompt || open.prompt.context?.type !== "chain" || open.prompt.context.forced) break;
          game.answer(open.seat, open.prompt.id, { cancel: true });
        }
      }
      session.run(step, index + 1);
    });
  } finally { game.close(); }
}
describeWithCores("activated locks without opponent reads", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("multiplayer/activation-only-locks", ACTIVATION_ONLY_LOCK_SCENARIOS, runWithFinalChains);
});
