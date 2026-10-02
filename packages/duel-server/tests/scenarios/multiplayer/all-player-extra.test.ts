import { createEngineGame } from "../../../src/engine.js";
import { engineDataDirectory } from "../../engine-data-dir.js";
import { compileBoard } from "../../support/board.js";
import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { Session, nseatWasmBinary } from "../../support/session.js";
import { ALL_PLAYER_EXTRA_SCENARIOS } from "./all-player-extra.js";

describeWithCores("live all-player Extra Deck and Deck top actions", liveNseat, () => {
  runScenarios("multiplayer/all-player-extra", ALL_PLAYER_EXTRA_SCENARIOS, async (scenario) => {
    const compiled = compileBoard(scenario.setup);
    if (scenario.tags.includes("card:19491080")) {
      const count = scenario.setup.format === "1v1" ? 2 : scenario.setup.format === "ffa3" ? 3 : 4;
      // Debug setup only places the face-up Pendulum cards. The Tribute Summon and trigger use real actions.
      compiled.options.startupScripts![0].content += "\n" + Array.from({ length: count }, (_, seat) =>
        `Debug.AddCard(20409757,${seat},${seat},LOCATION_EXTRA,0,POS_FACEUP,true)`).join("\n");
    }
    const game = await createEngineGame({
      ...compiled.options, seed: ["1", "2", "3", "4"], dataDirectory: engineDataDirectory, multiWasmBinary: nseatWasmBinary(),
    });
    try {
      const session = new Session(scenario, game);
      session.reachMainPhase();
      session.startRecording();
      scenario.steps.forEach((step, index) => session.run(step, index + 1));
    } finally { game.close(); }
  });
});
