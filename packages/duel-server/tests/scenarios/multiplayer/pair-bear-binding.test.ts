import { expect } from "vitest";
import { createEngineGame } from "../../../src/engine.js";
import { compileBoard } from "../../../src/presets/board.js";
import { engineDataDirectory } from "../../engine-data-dir.js";
import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { nseatWasmBinary, Session } from "../../support/session.js";
import { PAIR_BEAR_BINDING_SCENARIOS } from "./pair-bear-binding.js";

describeWithCores("live Pair Bear opponent binding", liveNseat, () => {
  runScenarios("multiplayer/pair-bear-binding", PAIR_BEAR_BINDING_SCENARIOS, async (scenario) => {
    const compiled = compileBoard(scenario.setup);
    const game = await createEngineGame({ ...compiled.options, dataDirectory: engineDataDirectory, seed: ["1", "2", "3", "4"], multiWasmBinary: nseatWasmBinary() });
    try {
      const session = new Session(scenario, game);
      session.reachMainPhase();
      session.startRecording();
      for (const [index, step] of scenario.steps.entries()) {
        // A later holder can respond during the preceding turn's End Phase and its own Draw Phase.
        if (index === 1 && scenario.id.endsWith("-p1")) {
          for (let count = 0; count < 12; count++) {
            const open = game.view(1).prompt;
            if (!open || open.context?.type !== "chain") break;
            expect(open.cancelable).toBe(true);
            expect(open.context.forced).toBeFalsy();
            game.answer(1, open.id, { cancel: true });
          }
          expect(game.view(1).turnSeat).toBe(1);
          expect(game.view(1).phase).toBe("main1");
        }
        session.run(step, index + 1);
      }
      expect(game.diagnostics().filter(entry => /NFOLD [UcW] |YGO_N_TRAP/.test(entry.detail))).toEqual([]);
    } finally { game.close(); }
  });
});
