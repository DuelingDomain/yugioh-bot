import { createEngineGame } from "../../../src/engine.js";
import { engineDataDirectory } from "../../engine-data-dir.js";
import { compileBoard } from "../../support/board.js";
import { describeWithCores, needs } from "../../support/cores.js";
import { runScenarios } from "../../support/runner.js";
import { Session } from "../../support/session.js";
import { GIANT_BALLPARK_SCENARIOS } from "./giant-ballpark.js";

describeWithCores("Giant Ballpark protects every player in Auto", [needs.cards(), needs.installedMulti()], () => {
  runScenarios("multiplayer/giant-ballpark", GIANT_BALLPARK_SCENARIOS, async scenario => {
    const compiled = compileBoard(scenario.setup);
    const game = await createEngineGame({ ...compiled.options, dataDirectory: engineDataDirectory,
      seed: ["1", "2", "3", "4"], settings: { ...compiled.options.settings!, stopAtEveryWindow: false } });
    try {
      const session = new Session(scenario, game);
      session.reachMainPhase(); session.startRecording();
      scenario.steps.forEach((step, index) => session.run(step, index + 1));
    } finally { game.close(); }
  });
});
