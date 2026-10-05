import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createEngineGame } from "../../../src/engine.js";
import { compileBoard } from "../../support/board.js";
import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { domainNseatWasmBinary, nseatWasmBinary, Session } from "../../support/session.js";
import { engineDataDirectory } from "../../engine-data-dir.js";
import { runScenarios } from "../../support/runner.js";
import { LEAVE_CHAIN_PROOFS } from "./leave-chains.js";
import { OVERLAY_DIRECTORY, readManifest } from "../../../scripts/generate-multi-scripts.js";

for (const mode of ["normal", "domain"] as const) {
  describeWithCores(`leave chain topology (${mode})`, [liveNseat, ...(mode === "domain" ? needs.domainMulti() : [])], () => {
    it.each(["ffa3", "ffa4", "tag"] as const)("parses all removal suffixes with the real %s Lua interpreter", async (format) => {
      const setup = { format, mode, p0: {}, p1: {}, p2: {}, ...(format === "ffa3" ? {} : { p3: {} }) };
      if (mode === "domain") for (const [index, master] of ["Axe Raider", "Celtic Guardian", "Battle Ox", ...(format === "ffa3" ? [] : ["Giant Soldier of Stone"])].entries()) {
        setup[`p${index}` as "p0"] = { deckMaster: master };
      }
      const compiled = compileBoard(setup);
      const cards = readManifest().cards.filter((card) => card.classes.includes("LEAVE") || [18861006, 64325438, 76636978, 4807253, 45141013].includes(card.code));
      const checks = cards.map((card) => {
        const script = readFileSync(join(engineDataDirectory, "card-scripts/official", card.file), "utf8") + "\n" + readFileSync(join(OVERLAY_DIRECTORY, card.file), "utf8");
        return `assert(load([========[${script}]========], "@${card.file}"))`;
      }).join("\n");
      const game = await createEngineGame({ ...compiled.options, dataDirectory: engineDataDirectory,
        multiWasmBinary: mode === "domain" ? domainNseatWasmBinary() : nseatWasmBinary(), seed: ["1", "2", "3", "4"],
        startupScripts: [...compiled.options.startupScripts!, { name: "leave-script-syntax.lua", content: checks }],
      });
      game.close();
    });
    runScenarios("rulebook chain topology", LEAVE_CHAIN_PROOFS, async (scenario) => {
      const setup = { ...scenario.setup, mode };
      if (mode === "domain") for (const [index, master] of ["Axe Raider", "Celtic Guardian", "Battle Ox", ...(setup.format === "ffa4" ? ["Giant Soldier of Stone"] : [])].entries()) {
        const seat = `p${index}` as "p0";
        setup[seat] = { ...setup[seat], deckMaster: master };
      }
      const compiled = compileBoard(setup);
      const game = await createEngineGame({ ...compiled.options, dataDirectory: engineDataDirectory,
        multiWasmBinary: mode === "domain" ? domainNseatWasmBinary() : nseatWasmBinary(), seed: ["1", "2", "3", "4"],
        startupScripts: [...compiled.options.startupScripts!, { name: "leave-chains.lua", content: LEAVE_CHAIN_PROOFS.find((proof) => proof.id === scenario.id)!.fixture ?? "" }],
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
