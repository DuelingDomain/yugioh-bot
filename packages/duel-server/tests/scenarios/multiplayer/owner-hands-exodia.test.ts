import { expect } from "vitest";
import { createEngineGame } from "../../../src/engine.js";
import { compileBoard } from "../../support/board.js";
import { engineDataDirectory } from "../../engine-data-dir.js";
import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { Session, nseatWasmBinary, domainNseatWasmBinary } from "../../support/session.js";
import { OWNER_HANDS_EXODIA_SCENARIOS } from "./owner-hands-exodia.js";
import type { Scenario } from "../../support/dsl.js";
import { fileURLToPath } from "node:url";
// Load the UI source at runtime. Its separate TypeScript project uses browser module resolution.
const { placings } = await import(fileURLToPath(new URL("../../../../web/src/components/duel/table/seat-state.ts", import.meta.url)));

async function run(scenario: Scenario): Promise<void> {
  const game = await createEngineGame({ ...compileBoard(scenario.setup).options, dataDirectory: engineDataDirectory,
    multiWasmBinary: scenario.setup.mode === "domain" ? domainNseatWasmBinary() : nseatWasmBinary(), seed: ["1", "2", "3", "4"] });
  try {
    const session = new Session(scenario, game);
    session.reachMainPhase();
    session.startRecording();
    scenario.steps.forEach((step, i) => {
      session.run(step, i + 1);
      if (scenario.tags.includes("prior-loss") && step.op === "expectEliminated" && !game.view(null).result) {
        expect(game.view(null).eliminationOrder).toEqual([[1]]);
      }
    });
    const view = game.view(null);
    if (scenario.id.startsWith("owner-exodia-") && !scenario.id.startsWith("owner-exodia-split-")) {
      expect(view.result).toMatchObject({ victory: "exodia" });
      expect(view.eliminationOrder).toEqual([]);
      expect(placings(view, [[0], [1], [2], [3]])).toEqual([]);
      for (const seat of view.seats) {
        expect(game.view(seat.seat).result).toEqual(view.result);
        expect(game.view(seat.seat).prompt).toBeNull();
      }
    } else expect(view.result).toBeNull();
  } finally { game.close(); }
}

describeWithCores("owner 2026-10-18: Standard hand and Exodia rules", liveNseat, () => {
  runScenarios("multiplayer/owner-hands-exodia", OWNER_HANDS_EXODIA_SCENARIOS.filter(s => s.setup.mode !== "domain"), run);
});
describeWithCores("owner 2026-10-18: Domain hand and Exodia rules", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("multiplayer/owner-hands-exodia-domain", OWNER_HANDS_EXODIA_SCENARIOS.filter(s => s.setup.mode === "domain"), run);
});
