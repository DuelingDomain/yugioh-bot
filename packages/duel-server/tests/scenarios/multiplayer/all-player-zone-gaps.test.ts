import { expect, it } from "vitest";
import { createEngineGame } from "../../../src/engine.js";
import { engineDataDirectory } from "../../engine-data-dir.js";
import { compileBoard } from "../../support/board.js";
import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { Session, nseatWasmBinary } from "../../support/session.js";
import { ALL_PLAYER_ZONE_GAPS_SCENARIOS } from "./all-player-zone-gaps.js";

describeWithCores("live remaining all-player zone actions", liveNseat, () => {
  for (const scenario of ALL_PLAYER_ZONE_GAPS_SCENARIOS) {
    it(scenario.id, async () => {
      const game = await createEngineGame({
        ...compileBoard(scenario.setup).options, seed: ["1", "2", "3", "4"],
        dataDirectory: engineDataDirectory, multiWasmBinary: nseatWasmBinary(),
      });
      try {
        const session = new Session(scenario, game);
        session.reachMainPhase();
        session.startRecording();
        scenario.steps.forEach((step, index) => session.run(step, index + 1));
        if (scenario.id.includes("-gnomes-")) {
          const count = scenario.setup.format === "1v1" ? 2 : scenario.setup.format === "ffa3" ? 3 : 4;
          const levels = Array.from({ length: count }, (_, seat) => game.view(seat).seats[seat].hand[0].level);
          expect(levels).toEqual([3, 3, 3, 2].slice(0, count));
        }
      } finally {
        game.close();
      }
    });
  }
});
