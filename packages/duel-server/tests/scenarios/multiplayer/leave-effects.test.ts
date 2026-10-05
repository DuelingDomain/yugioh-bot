import { expect } from "vitest";
import { createEngineGame } from "../../../src/engine.js";
import { compileBoard } from "../../support/board.js";
import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { domainNseatWasmBinary, nseatWasmBinary, Session } from "../../support/session.js";
import { engineDataDirectory } from "../../engine-data-dir.js";
import { runScenarios } from "../../support/runner.js";
import { LEAVE_EFFECT_PROOFS } from "./leave-effects.js";

for (const mode of ["normal", "domain"] as const) {
  describeWithCores(`lasting leave effects (${mode})`, [liveNseat, ...(mode === "domain" ? needs.domainMulti() : [])], () => {
    runScenarios("rulebook lasting effects", LEAVE_EFFECT_PROOFS, async (scenario) => {
      const setup = { ...scenario.setup, mode };
      if (mode === "domain") for (const [index, master] of ["Axe Raider", "Celtic Guardian", "Battle Ox", ...(setup.format === "ffa4" ? ["Giant Soldier of Stone"] : [])].entries()) {
        const seat = `p${index}` as "p0";
        setup[seat] = { ...setup[seat], deckMaster: master };
      }
      const compiled = compileBoard(setup);
      const game = await createEngineGame({ ...compiled.options, dataDirectory: engineDataDirectory,
        multiWasmBinary: mode === "domain" ? domainNseatWasmBinary() : nseatWasmBinary(), seed: ["1", "2", "3", "4"],
        startupScripts: [...compiled.options.startupScripts!, { name: "leave-effects.lua", content: LEAVE_EFFECT_PROOFS.find((proof) => proof.id === scenario.id)!.fixture ?? "" }],
      });
      try {
        const session = new Session({ ...scenario, setup }, game);
        session.reachMainPhase(); session.startRecording();
        scenario.steps.forEach((step, index) => session.run(step, index + 1));
        expect(game.diagnostics().filter((d) => d.kind === "stderr")).toEqual([]);
      } finally { game.close(); }
    });
  });
}
